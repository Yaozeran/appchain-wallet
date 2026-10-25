package com.bitinns.wallet.moonpay;

import java.math.BigDecimal;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.assertj.core.api.Assertions.*;

class MoonPayServiceTests {
    static final String ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    static MoonPayProperties sandbox() {
        return new MoonPayProperties("sandbox", "pk_test_fixture", "sk_test_fixture", false, Set.of());
    }
    static Map<String, String> query(String url) {
        return java.util.Arrays.stream(URI.create(url).getRawQuery().split("&"))
                .map(part -> part.split("=", 2))
                .collect(Collectors.toMap(pair -> pair[0], pair -> URLDecoder.decode(pair[1], StandardCharsets.UTF_8)));
    }

    @Test void signsTheExactQueryWithAnIndependentHmacFixture() {
        var service = new MoonPayService(sandbox());
        String url = service.checkout(ADDRESS, "USD", new BigDecimal("50.00"), null).url();
        assertThat(URI.create(url).getHost()).isEqualTo("buy-sandbox.moonpay.com");
        var params = query(url);
        assertThat(params).containsEntry("walletAddress", ADDRESS).containsEntry("baseCurrencyCode", "usd")
                .containsEntry("baseCurrencyAmount", "50").containsEntry("currencyCode", "eth");
        assertThat(params.get("signature")).isEqualTo("knza7XMl5t/IxK1Cepcu0kNKx++fOM7OTxqR3xProdw=");
        assertThat(params).doesNotContainKey("allowedIpAddress");
        assertThat(url).doesNotContain("sk_test_fixture");
    }

    @Test void missingOrWrongModeKeysDisableCheckout() {
        for (var props : new MoonPayProperties[] {
                new MoonPayProperties("sandbox", "", "", false, Set.of()),
                new MoonPayProperties("production", "pk_test_fixture", "sk_test_fixture", false, Set.of()),
                new MoonPayProperties("sandbox", "pk_live_fixture", "sk_live_fixture", false, Set.of()) }) {
            var service = new MoonPayService(props);
            assertThat(service.configuration().available()).isFalse();
            assertThatThrownBy(() -> service.checkout(ADDRESS, "usd", BigDecimal.TEN, null))
                    .isInstanceOf(ResponseStatusException.class).hasMessageContaining("503");
        }
    }

    @Test void rejectsInvalidRecipientsAndFiatAmounts() {
        var service = new MoonPayService(sandbox());
        for (String address : new String[] {"", "0x123", "0x" + "0".repeat(40), "https://attacker.test", ADDRESS + "&currencyCode=btc"}) {
            assertThatThrownBy(() -> service.checkout(address, "usd", BigDecimal.TEN, null))
                    .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
        }
        for (BigDecimal amount : new BigDecimal[] {null, BigDecimal.ZERO, new BigDecimal("-1"), new BigDecimal("1.5"), new BigDecimal("100001")}) {
            assertThatThrownBy(() -> service.checkout(ADDRESS, "usd", amount, null))
                    .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
        }
        assertThatThrownBy(() -> service.checkout(ADDRESS, "xyz", BigDecimal.TEN, null))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
    }

    @Test void productionAlwaysBindsIpEvenWhenTheOptionalSandboxFlagIsFalse() {
        var service = new MoonPayService(new MoonPayProperties("production", "pk_live_fixture", "sk_live_fixture", false, Set.of()));
        assertThatThrownBy(() -> service.checkout(ADDRESS, "usd", BigDecimal.TEN, null))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("503");
        String first = service.checkout(ADDRESS, "usd", BigDecimal.TEN, "203.0.113.42").url();
        String second = service.checkout(ADDRESS, "usd", BigDecimal.TEN, "203.0.113.43").url();
        assertThat(URI.create(first).getHost()).isEqualTo("buy.moonpay.com");
        assertThat(query(first)).containsKey("allowedIpAddress");
        assertThat(query(first).get("signature")).isNotEqualTo(query(second).get("signature"));
        assertThat(query(first).get("allowedIpAddress")).isNotEqualTo(query(second).get("allowedIpAddress"));
        assertThat(first).doesNotContain("203.0.113.42");
    }

    @Test void invalidEnvironmentFailsInsteadOfFallingBackToLiveCheckout() {
        assertThatThrownBy(() -> new MoonPayService(new MoonPayProperties("prod", "", "", false, Set.of())))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test void propertiesDoNotExposeSecretsWhenRenderedAsAString() {
        assertThat(sandbox().toString()).doesNotContain("sk_test_fixture", "pk_test_fixture");
    }
}
