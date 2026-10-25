package com.bitinns.wallet.transak;

import com.bitinns.wallet.shared.JsonHttpClient;
import com.bitinns.wallet.shared.JsonHttpClient.UpstreamException;
import java.math.BigDecimal;
import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;

@Service
public class TransakService {
    private final TransakProperties properties;
    private final JsonHttpClient http;
    private String token;
    private long tokenExpiresAt;
    private static final List<String> FIAT = List.of("USD", "GBP", "EUR", "SGD");
    public TransakService(TransakProperties properties, JsonHttpClient http) {
        this.properties = properties; this.http = http;
        if (!List.of("staging", "production").contains(properties.environment())) throw new IllegalArgumentException("TRANSAK_ENVIRONMENT must be staging or production.");
        URI origin = URI.create(properties.referrerDomain());
        if (origin.getHost() == null || origin.getUserInfo() != null || origin.getQuery() != null || origin.getFragment() != null
                || (!origin.getPath().isEmpty() && !origin.getPath().equals("/"))
                || !(origin.getScheme().equals("https") || (!production() && origin.getScheme().equals("http")
                    && List.of("localhost", "127.0.0.1").contains(origin.getHost())))) {
            throw new IllegalArgumentException("TRANSAK_REFERRER_DOMAIN must be the frontend origin (HTTPS in production).");
        }
    }
    public boolean production() { return properties.environment().equals("production"); }
    public String origin() { return properties.referrerDomain().replaceAll("/$", ""); }
    public Config configuration() {
        boolean available = properties.apiKey() != null && !properties.apiKey().isBlank()
                && properties.apiSecret() != null && !properties.apiSecret().isBlank();
        return new Config(available, properties.environment(), FIAT, List.of("USDC", "ETH"),
                production() ? "Ethereum mainnet" : "Staging · Ethereum Sepolia test delivery",
                available ? "" : "Transak is not configured. Add staging API credentials to the backend.");
    }
    private synchronized String accessToken() {
        if (token != null && tokenExpiresAt > Instant.now().getEpochSecond() + 60) return token;
        String base = production() ? "https://api.transak.com" : "https://api-stg.transak.com";
        JsonNode result = http.post(base + "/partners/api/v2/refresh-token", Map.of(
                "x-api-key", properties.apiKey(), "api-secret", properties.apiSecret()), Map.of("apiKey", properties.apiKey()));
        JsonNode data = result.path("data");
        String next = data.path("accessToken").asText("");
        long expires = data.path("expiresAt").asLong(0);
        if (next.isBlank() || expires <= Instant.now().getEpochSecond() + 60) throw new UpstreamException(502);
        token = next; tokenExpiresAt = expires;
        return token;
    }
    public Checkout checkout(String address, String fiat, BigDecimal amount, String asset, String clientIp) {
        if (!configuration().available()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, configuration().message());
        String currency = fiat == null ? "" : fiat.toUpperCase(Locale.ROOT);
        if (address == null || !address.matches("0x[0-9a-fA-F]{40}") || address.matches("0x0{40}")
                || !FIAT.contains(currency) || !List.of("ETH", "USDC").contains(asset == null ? "" : asset)
                || amount == null || amount.compareTo(BigDecimal.ONE) < 0 || amount.compareTo(new BigDecimal("100000")) > 0
                || amount.stripTrailingZeros().scale() > 2) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose a valid Ethereum address, supported asset/currency, and amount from 1 to 100000 (up to 2 decimal places).");
        }
        if (clientIp == null) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "Transak requires the browser's public IP. Configure TRANSAK_SANDBOX_CLIENT_IP for local staging, or a trusted ingress for production.");
        boolean authenticating = true;
        try {
            String access = accessToken();
            authenticating = false;
            String base = production() ? "https://api-gateway.transak.com" : "https://api-gateway-stg.transak.com";
            var params = Map.of("apiKey", properties.apiKey(), "referrerDomain", origin(), "productsAvailed", "BUY",
                    "walletAddress", address, "disableWalletAddressForm", true, "cryptoCurrencyCode", asset,
                    "network", "ethereum", "fiatCurrency", currency, "fiatAmount", amount);
            JsonNode response = http.post(base + "/api/v2/auth/session", Map.of("x-api-key", properties.apiKey(),
                    "access-token", access, "x-user-ip", clientIp), Map.of("widgetParams", params));
            String url = response.path("data").path("widgetUrl").asText("");
            URI uri = URI.create(url);
            String host = production() ? "global.transak.com" : "global-stg.transak.com";
            if (!"https".equals(uri.getScheme()) || !host.equals(uri.getHost()) || uri.getUserInfo() != null
                    || uri.getPort() != -1 || uri.getFragment() != null
                    || !(uri.getPath().isEmpty() || uri.getPath().equals("/"))
                    || uri.getRawQuery() == null || !uri.getRawQuery().matches(".*(?:^|&)sessionId=[^&]+.*")) throw new UpstreamException(502);
            return new Checkout(url, properties.environment());
        } catch (UpstreamException exception) {
            if (exception.status == 401) { synchronized (this) { token = null; tokenExpiresAt = 0; } }
            String hint = authenticating && exception.status == 400
                    ? "Transak rejected partner authentication (HTTP 400). Check TRANSAK_API_KEY and TRANSAK_API_SECRET: both must belong to the configured "
                        + properties.environment() + " environment. Update .env and recreate the backend container."
                    : exception.status == 401 ? "Check the Transak staging/production credentials."
                    : exception.status == 403 ? "Check Transak's backend egress-IP whitelist and partner permissions."
                    : exception.status == 429 ? "Transak rate limited this request. Wait before retrying."
                    : "Transak could not create checkout. Check provider availability and partner configuration.";
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, hint);
        } catch (IllegalArgumentException exception) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Transak returned an invalid checkout response.");
        }
    }
    public record Config(boolean available, String environment, List<String> fiatCurrencies, List<String> assets,
                         String networkLabel, String message) {}
    public record Checkout(String url, String environment) {
        @Override public String toString() { return "TransakCheckout[url redacted]"; }
    }
}
