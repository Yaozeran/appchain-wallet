package com.bitinns.wallet.balance;

import com.bitinns.wallet.shared.JsonHttpClient;
import java.math.BigInteger;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;

@Service
public class BalanceService {
    private final JsonHttpClient http;
    private final Map<String, String> rpcUrls;
    private final String bitcoinApi;
    private final Map<String, BigInteger> ids;
    public static final String TRNSK = "0x0c86a754a29714c4fe9c6f1359fa7099ed174c0b";
    public BalanceService(JsonHttpClient http,
            @Value("${balance.ethereum-rpc}") String ethereum,
            @Value("${balance.sepolia-rpc}") String sepolia,
            @Value("${balance.optimism-rpc}") String optimism,
            @Value("${balance.bitcoin-api}") String bitcoinApi,
            @Value("${balance.appchain-rpc}") String appchain,
            @Value("${balance.appchain-id}") BigInteger appchainId) {
        if (appchainId.signum() <= 0) throw new IllegalArgumentException("APPCHAIN_CHAIN_ID must be positive.");
        this.http = http; this.rpcUrls = Map.of("eth", ethereum, "sepolia", sepolia, "optimism", optimism, "appchain", appchain);
        this.ids = Map.of("eth", BigInteger.ONE, "sepolia", BigInteger.valueOf(11155111), "optimism", BigInteger.TEN, "appchain", appchainId);
        this.bitcoinApi = bitcoinApi.replaceAll("/$", "");
    }
    public Balance read(String chain, String address, String asset) {
        boolean token = "trnsk".equals(asset);
        if (!List.of("eth", "sepolia", "optimism", "btc", "appchain").contains(chain)
                || !List.of("native", "trnsk").contains(asset) || (token && !chain.equals("sepolia"))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unsupported chain or asset.");
        }
        if (address == null || (chain.equals("btc") ? !address.matches("bc1q[023456789acdefghjklmnpqrstuvwxyz]{38}") : !address.matches("0x[0-9a-fA-F]{40}"))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Address does not match the selected chain.");
        }
        try {
            if (chain.equals("btc")) {
                JsonNode data = http.get(bitcoinApi + "/address/" + address);
                BigInteger confirmed = satoshis(data.path("chain_stats"), "funded_txo_sum").subtract(satoshis(data.path("chain_stats"), "spent_txo_sum"));
                BigInteger pending = satoshis(data.path("mempool_stats"), "funded_txo_sum").subtract(satoshis(data.path("mempool_stats"), "spent_txo_sum"));
                if (confirmed.signum() < 0 || confirmed.add(pending).signum() < 0) throw new IllegalStateException();
                return new Balance(chain, address, "BTC", confirmed.toString(), pending.toString(), 8, Instant.now().toString(), "https://mempool.space/address/" + address);
            }
            if (!quantity(rpc(chain, "eth_chainId", List.of())).equals(ids.get(chain))) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "RPC returned the wrong chain ID. Check the server RPC configuration.");
            }
            BigInteger units;
            int decimals = 18;
            if (token) {
                String payload = "0x70a08231" + "0".repeat(24) + address.substring(2);
                units = quantity(rpc(chain, "eth_call", List.of(Map.of("to", TRNSK, "data", payload), "latest")));
                decimals = quantity(rpc(chain, "eth_call", List.of(Map.of("to", TRNSK, "data", "0x313ce567"), "latest"))).intValueExact();
                if (decimals < 0 || decimals > 36) throw new IllegalStateException();
            } else units = quantity(rpc(chain, "eth_getBalance", List.of(address, "latest")));
            String explorer = switch (chain) { case "sepolia" -> "https://sepolia.etherscan.io"; case "optimism" -> "https://optimistic.etherscan.io"; default -> "https://etherscan.io"; };
            return new Balance(chain, address, token ? "TRNSK" : "ETH", units.toString(), "0", decimals, Instant.now().toString(), chain.equals("appchain") ? "" : explorer + "/address/" + address);
        } catch (ResponseStatusException exception) { throw exception; }
        catch (Exception exception) {
            if (chain.equals("appchain")) throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Our appchain RPC is unavailable. Complete the optional OP Stack Docker setup and start its sequencer.");
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Unable to read this chain's balance. The provider may be unavailable or rate limited. Try again.");
        }
    }
    private String rpc(String chain, String method, List<?> params) {
        JsonNode result = http.post(rpcUrls.get(chain), Map.of(), Map.of("jsonrpc", "2.0", "id", 1, "method", method, "params", params));
        if (result.hasNonNull("error") || !result.path("result").isString()) throw new IllegalStateException();
        return result.path("result").asText();
    }
    static BigInteger quantity(String hex) {
        if (hex == null || !hex.matches("0x[0-9a-fA-F]{1,64}")) throw new IllegalArgumentException();
        return new BigInteger(hex.substring(2), 16);
    }
    private static BigInteger satoshis(JsonNode stats, String field) {
        String text = stats.path(field).asText("");
        if (!text.matches("[0-9]{1,19}")) throw new IllegalStateException();
        return new BigInteger(text);
    }
    public record Balance(String chain, String address, String symbol, String baseUnits, String pendingBaseUnits,
                          int decimals, String observedAt, String explorerUrl) {}
}
