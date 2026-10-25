package com.bitinns.wallet.moonpay;

import java.util.Set;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("moonpay")
public record MoonPayProperties(String environment, String publishableKey, String secretKey,
        boolean ipMatching, Set<String> trustedProxies) {
    @Override
    public String toString() {
        return "MoonPayProperties[credentials redacted]";
    }
}
