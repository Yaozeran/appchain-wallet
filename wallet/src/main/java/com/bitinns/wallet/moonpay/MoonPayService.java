package com.bitinns.wallet.moonpay;

import java.math.BigDecimal;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class MoonPayService {
    private static final List<String> FIAT_CURRENCIES = List.of("usd", "eur", "gbp");
    private final MoonPayProperties properties;

    public MoonPayService(MoonPayProperties properties) {
        this.properties = properties;
        if (!List.of("sandbox", "production").contains(properties.environment())) {
            throw new IllegalArgumentException("MOONPAY_ENVIRONMENT must be sandbox or production.");
        }
    }

    public boolean production() {
        return "production".equals(properties.environment());
    }

    public boolean ipMatchingRequired() {
        return production() || properties.ipMatching();
    }

    public boolean available() {
        String keyMode = production() ? "live" : "test";
        return properties.publishableKey() != null && properties.secretKey() != null
                && properties.publishableKey().matches("pk_" + keyMode + "_[A-Za-z0-9_-]+")
                && properties.secretKey().matches("sk_" + keyMode + "_[A-Za-z0-9_-]+");
    }

    public Config configuration() {
        return new Config(available(), properties.environment(), "eth", "Ethereum (ETH)",
                production() ? "Ethereum mainnet" : "MoonPay sandbox · test only", FIAT_CURRENCIES,
                available() ? "" : "MoonPay checkout is not configured. Add matching MoonPay keys to the server.");
    }

    public Checkout checkout(String address, String fiatCurrency, BigDecimal fiatAmount, String clientIp) {
        if (!available()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, configuration().message());
        }
        // Never accept arbitrary URLs, networks, redirect URLs, or extra parameters to sign.
        if (address == null || !address.matches("0x[0-9a-fA-F]{40}")
                || address.matches("0x0{40}")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Enter a valid, nonzero Ethereum wallet address.");
        }
        String fiat = fiatCurrency == null ? "" : fiatCurrency.toLowerCase(Locale.ROOT);
        if (!FIAT_CURRENCIES.contains(fiat) || fiatAmount == null
                || fiatAmount.compareTo(BigDecimal.ONE) < 0
                || fiatAmount.compareTo(new BigDecimal("100000")) > 0
                || fiatAmount.stripTrailingZeros().scale() > 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Choose USD, EUR, or GBP and a whole-number amount between 1 and 100000.");
        }
        Map<String, String> params = new LinkedHashMap<>();
        params.put("apiKey", properties.publishableKey());
        params.put("currencyCode", "eth");
        params.put("walletAddress", address);
        params.put("baseCurrencyCode", fiat);
        params.put("baseCurrencyAmount", fiatAmount.toBigIntegerExact().toString());
        if (ipMatchingRequired()) {
            if (clientIp == null) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                        production()
                                ? "Checkout needs a verified public client IP from the trusted ingress. Check the server proxy configuration."
                                : "Sandbox checkout needs IP matching. Set MOONPAY_SANDBOX_CLIENT_IP to this browser's public IP, then recreate the backend container.");
            }
            params.put("allowedIpAddress", hmac(clientIp));
        }
        String query = "?" + params.entrySet().stream()
                .map(entry -> encode(entry.getKey()) + "=" + encode(entry.getValue()))
                .collect(java.util.stream.Collectors.joining("&"));
        String host = production() ? "https://buy.moonpay.com" : "https://buy-sandbox.moonpay.com";
        return new Checkout(host + query + "&signature=" + encode(hmac(query)), properties.environment());
    }

    private String hmac(String message) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(properties.secretKey().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return Base64.getEncoder().encodeToString(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Unable to sign MoonPay checkout.");
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    public record Config(boolean available, String environment, String assetCode, String assetName,
                         String networkLabel, List<String> fiatCurrencies, String message) {}

    public record Checkout(String url, String environment) {
        @Override public String toString() { return "Checkout[url redacted]"; }
    }
}
