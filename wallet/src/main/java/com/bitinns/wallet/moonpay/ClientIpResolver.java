package com.bitinns.wallet.moonpay;

import jakarta.servlet.http.HttpServletRequest;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;

@Component
public class ClientIpResolver {
    private final Set<String> trustedProxies;
    private final String sandboxClientIp;

    public ClientIpResolver(MoonPayProperties properties,
                            @Value("${moonpay.sandbox-client-ip:}") String sandboxClientIp) {
        trustedProxies = properties.trustedProxies() == null ? Set.of() : properties.trustedProxies();
        // A local Docker proxy cannot discover the browser's public IP. This
        // explicit single-developer override is never used in production.
        this.sandboxClientIp = "sandbox".equals(properties.environment())
                ? canonicalPublicIp(sandboxClientIp) : null;
        if ("sandbox".equals(properties.environment()) && !sandboxClientIp.isBlank()
                && this.sandboxClientIp == null) {
            throw new IllegalArgumentException("MOONPAY_SANDBOX_CLIENT_IP must be a public IP literal.");
        }
    }

    public String resolve(HttpServletRequest request) {
        // True-Client-IP must be overwritten by our trusted ingress, never by a visitor.
        if (trustedProxies.contains(request.getRemoteAddr())) {
            String ip = canonicalPublicIp(request.getHeader("True-Client-IP"));
            if (ip != null) return ip;
        }
        return sandboxClientIp;
    }

    public static String canonicalPublicIp(String value) {
        if (value == null || value.length() > 45 || !value.matches("[0-9a-fA-F:.]+")) return null;
        // Restrict input to literal addresses before InetAddress parsing; never perform DNS.
        if (!value.contains(":")) {
            String[] parts = value.split("\\.", -1);
            if (parts.length != 4) return null;
            for (String part : parts) {
                if (!part.matches("0|[1-9][0-9]{0,2}") || Integer.parseInt(part) > 255) return null;
            }
        }
        try {
            InetAddress ip = InetAddress.getByName(value);
            if (ip.isAnyLocalAddress() || ip.isLoopbackAddress() || ip.isLinkLocalAddress()
                    || ip.isSiteLocalAddress() || ip.isMulticastAddress()) return null;
            byte[] bytes = ip.getAddress();
            if (bytes.length == 4) {
                int first = bytes[0] & 255;
                int second = bytes[1] & 255;
                if (first == 0 || first >= 224 || (first == 100 && second >= 64 && second <= 127)) return null;
                return ip.getHostAddress();
            }
            if ((bytes[0] & 0xfe) == 0xfc) return null; // IPv6 unique local.
            int[] words = new int[8];
            for (int i = 0; i < 8; i++) words[i] = ((bytes[i * 2] & 255) << 8) | (bytes[i * 2 + 1] & 255);
            int bestStart = -1, bestLength = 1;
            for (int i = 0; i < 8;) {
                if (words[i] != 0) { i++; continue; }
                int start = i;
                while (i < 8 && words[i] == 0) i++;
                if (i - start > bestLength) { bestStart = start; bestLength = i - start; }
            }
            StringBuilder result = new StringBuilder();
            for (int i = 0; i < 8; i++) {
                if (i == bestStart) {
                    result.append("::"); i += bestLength - 1;
                } else {
                    if (!result.isEmpty() && result.charAt(result.length() - 1) != ':') result.append(':');
                    result.append(Integer.toHexString(words[i]));
                }
            }
            return result.toString();
        } catch (UnknownHostException exception) {
            return null;
        }
    }
}
