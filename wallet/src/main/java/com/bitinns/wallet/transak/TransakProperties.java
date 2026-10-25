package com.bitinns.wallet.transak;

import java.util.Set;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("transak")
public record TransakProperties(String environment, String apiKey, String apiSecret,
        String referrerDomain, String sandboxClientIp, Set<String> trustedProxies) {
    @Override public String toString() { return "TransakProperties[credentials redacted]"; }
}
