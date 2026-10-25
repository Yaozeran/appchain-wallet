package com.bitinns.wallet.moonpay;

import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import static org.assertj.core.api.Assertions.*;

class ClientIpResolverTests {
    @Test void canonicalizesIpv4AndIpv6WithoutResolvingHostnames() {
        assertThat(ClientIpResolver.canonicalPublicIp("203.0.113.42")).isEqualTo("203.0.113.42");
        assertThat(ClientIpResolver.canonicalPublicIp("2001:0DB8:0000:0000:0000:0000:0000:0001")).isEqualTo("2001:db8::1");
        assertThat(ClientIpResolver.canonicalPublicIp("::ffff:203.0.113.42")).isEqualTo("203.0.113.42");
        assertThat(ClientIpResolver.canonicalPublicIp("2001:db8:0:1:0:0:0:1")).isEqualTo("2001:db8:0:1::1");
        for (String invalid : new String[] {"localhost", "example.com", "1.2.3", "203.000.113.42", "999.1.1.1", "127.0.0.1", "192.168.1.1", "::1", "fc00::1", "fe80::1", "203.0.113.42, 1.1.1.1"}) {
            assertThat(ClientIpResolver.canonicalPublicIp(invalid)).as(invalid).isNull();
        }
    }

    @Test void ignoresSpoofedClientIpHeadersFromUntrustedSockets() {
        var resolver = new ClientIpResolver(new MoonPayProperties("production", "", "", true, Set.of("127.0.0.1")), "");
        var request = new MockHttpServletRequest();
        request.setRemoteAddr("203.0.113.1");
        request.addHeader("True-Client-IP", "203.0.113.42");
        assertThat(resolver.resolve(request)).isNull();
        request.setRemoteAddr("127.0.0.1");
        assertThat(resolver.resolve(request)).isEqualTo("203.0.113.42");
    }

    @Test void neverUsesUntrustedForwardedHeadersAsAFallback() {
        var resolver = new ClientIpResolver(new MoonPayProperties("production", "", "", true, Set.of("127.0.0.1")), "");
        var request = new MockHttpServletRequest();
        request.setRemoteAddr("127.0.0.1");
        request.addHeader("X-Forwarded-For", "203.0.113.42");
        assertThat(resolver.resolve(request)).isNull();
    }

    @Test void localSandboxOverrideProvidesIpWithoutTrustingVisitorHeaders() {
        var resolver = new ClientIpResolver(new MoonPayProperties("sandbox", "", "", true, Set.of()), "203.0.113.42");
        var request = new MockHttpServletRequest();
        request.setRemoteAddr("172.18.0.3");
        request.addHeader("True-Client-IP", "203.0.113.99");
        assertThat(resolver.resolve(request)).isEqualTo("203.0.113.42");
    }

    @Test void productionIgnoresSandboxOverride() {
        var resolver = new ClientIpResolver(new MoonPayProperties("production", "", "", true, Set.of()), "203.0.113.42");
        assertThat(resolver.resolve(new MockHttpServletRequest())).isNull();
    }

    @Test void sandboxRejectsInvalidOverrideInsteadOfSigningIt() {
        assertThatThrownBy(() -> new ClientIpResolver(new MoonPayProperties("sandbox", "", "", true, Set.of()), "127.0.0.1"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
