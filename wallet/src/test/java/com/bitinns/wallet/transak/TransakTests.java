package com.bitinns.wallet.transak;

import com.bitinns.wallet.shared.FakeHttp;
import java.math.BigDecimal;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;

class TransakTests {
    static final String ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    static TransakProperties props() { return new TransakProperties("staging", "fixture-key", "fixture-secret", "http://localhost:3000", "203.0.113.42", Set.of()); }
    static final String TOKEN = "{\"data\":{\"accessToken\":\"fixture-token\",\"expiresAt\":4102444800}}";
    static final String SESSION = "{\"data\":{\"widgetUrl\":\"https://global-stg.transak.com?apiKey=fixture&sessionId=single-use\"}}";

    @Test void usesBackendCredentialsAndCachesOnlyThePartnerToken() {
        var http = new FakeHttp().add(TOKEN).add(SESSION).add(SESSION);
        var service = new TransakService(props(), http);
        service.checkout(ADDRESS, "gbp", BigDecimal.TEN, "USDC", "203.0.113.42");
        service.checkout(ADDRESS, "usd", BigDecimal.TEN, "ETH", "203.0.113.42");
        assertThat(http.calls).hasSize(3);
        assertThat(http.calls.getFirst().url()).isEqualTo("https://api-stg.transak.com/partners/api/v2/refresh-token");
        assertThat(http.calls.getFirst().headers()).containsEntry("api-secret", "fixture-secret");
        var call = http.calls.get(1);
        assertThat(call.url()).isEqualTo("https://api-gateway-stg.transak.com/api/v2/auth/session");
        assertThat(call.headers()).containsEntry("access-token", "fixture-token").containsEntry("x-user-ip", "203.0.113.42").containsEntry("x-api-key", "fixture-key");
        Map<?,?> params = (Map<?,?>)((Map<?,?>)call.body()).get("widgetParams");
        assertThat(params.get("walletAddress")).isEqualTo(ADDRESS);
        assertThat(params.get("disableWalletAddressForm")).isEqualTo(true);
        assertThat(params.get("cryptoCurrencyCode")).isEqualTo("USDC");
        assertThat(params.get("network")).isEqualTo("ethereum");
    }

    @Test void rejectsInputBeforeContactingTheProvider() {
        var http = new FakeHttp(); var service = new TransakService(props(), http);
        assertThatThrownBy(() -> service.checkout("bad", "GBP", BigDecimal.TEN, "USDC", "203.0.113.42")).isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
        assertThatThrownBy(() -> service.checkout(ADDRESS, "GBP", BigDecimal.TEN, "BTC", "203.0.113.42")).isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
        assertThatThrownBy(() -> service.checkout(ADDRESS, "GBP", new BigDecimal("1.123"), "ETH", "203.0.113.42")).isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
        assertThatThrownBy(() -> service.checkout(ADDRESS, "GBP", BigDecimal.TEN, "ETH", null)).isInstanceOf(ResponseStatusException.class).hasMessageContaining("503");
        assertThat(http.calls).isEmpty();
    }

    @Test void mapsProviderErrorsAndNeverLeaksKeysOrTokens() {
        var service = new TransakService(props(), new FakeHttp().fail(403));
        assertThatThrownBy(() -> service.checkout(ADDRESS,"USD",BigDecimal.TEN,"ETH","203.0.113.42"))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("whitelist");
        assertThat(props().toString()).doesNotContain("fixture-secret");
        assertThat(new TransakService.Checkout("secret-session", "staging").toString()).doesNotContain("secret-session");
    }

    @Test void authenticationRejectionExplainsEnvironmentAndContainerConfiguration() {
        var http = new FakeHttp().fail(400);
        assertThatThrownBy(() -> new TransakService(props(), http)
                .checkout(ADDRESS,"GBP",BigDecimal.TEN,"USDC","203.0.113.42"))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("partner authentication (HTTP 400)")
                .hasMessageContaining("staging environment")
                .hasMessageContaining("recreate the backend")
                .hasMessageNotContaining("fixture-key").hasMessageNotContaining("fixture-secret");
        assertThat(http.calls).hasSize(1);
    }

    @Test void sessionBadRequestIsNotMisreportedAsAuthenticationFailure() {
        var http = new FakeHttp().add(TOKEN).fail(400);
        assertThatThrownBy(() -> new TransakService(props(), http)
                .checkout(ADDRESS,"GBP",BigDecimal.TEN,"USDC","203.0.113.42"))
                .hasMessageContaining("could not create checkout")
                .hasMessageNotContaining("partner authentication");
    }

    @Test void rejectsProviderUrlsThatLeaveTheExpectedEnvironment() {
        for (String url : new String[] {"https://attacker.test?sessionId=x", "https://global.transak.com?sessionId=x", "https://global-stg.transak.com?apiKey=x"}) {
            var http = new FakeHttp().add(TOKEN).add("{\"data\":{\"widgetUrl\":\""+url+"\"}}");
            assertThatThrownBy(() -> new TransakService(props(),http).checkout(ADDRESS,"USD",BigDecimal.TEN,"ETH","203.0.113.42"))
                    .isInstanceOf(ResponseStatusException.class).hasMessageContaining("502");
        }
    }

    @Test void originProtectionBlocksCrossSiteSessionCreation() throws Exception {
        var http = new FakeHttp(); var service = new TransakService(props(), http);
        var api = MockMvcBuilders.standaloneSetup(new TransakController(service,props())).build();
        api.perform(post("/api/transak/checkout").header("Origin","https://attacker.test").contentType(MediaType.APPLICATION_JSON)
                .content("{\"walletAddress\":\""+ADDRESS+"\",\"fiatCurrency\":\"USD\",\"fiatAmount\":50,\"asset\":\"USDC\"}"))
                .andExpect(status().isForbidden());
        assertThat(http.calls).isEmpty();
        api.perform(get("/api/transak/config")).andExpect(status().isOk())
                .andExpect(content().string(not(containsString("fixture-secret"))));
    }

    @Test void realControllerCreatesSessionAndSendsNoStore() throws Exception {
        var http = new FakeHttp().add(TOKEN).add(SESSION);
        var api = MockMvcBuilders.standaloneSetup(new TransakController(new TransakService(props(),http),props())).build();
        api.perform(post("/api/transak/checkout").header("Origin","http://localhost:3000").contentType(MediaType.APPLICATION_JSON)
                .content("{\"walletAddress\":\""+ADDRESS+"\",\"fiatCurrency\":\"GBP\",\"fiatAmount\":50,\"asset\":\"USDC\"}"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store"))
                .andExpect(jsonPath("$.environment").value("staging"));
    }

    @Test void productionNeverUsesTheStagingIpOverride() throws Exception {
        var props = new TransakProperties("production","key","secret","https://wallet.example","203.0.113.42",Set.of());
        var http = new FakeHttp();
        var api = MockMvcBuilders.standaloneSetup(new TransakController(new TransakService(props,http),props)).build();
        api.perform(post("/api/transak/checkout").header("Origin","https://wallet.example").contentType(MediaType.APPLICATION_JSON)
                .content("{\"walletAddress\":\""+ADDRESS+"\",\"fiatCurrency\":\"GBP\",\"fiatAmount\":50,\"asset\":\"USDC\"}"))
                .andExpect(status().isServiceUnavailable());
        assertThat(http.calls).isEmpty();
    }

    @Test void unavailableCredentialsHaveNoExternalSideEffects() {
        var props = new TransakProperties("staging","","","http://localhost:3000","",Set.of());
        var http = new FakeHttp(); var service = new TransakService(props,http);
        assertThat(service.configuration().available()).isFalse();
        assertThatThrownBy(() -> service.checkout(ADDRESS,"GBP",BigDecimal.TEN,"USDC","203.0.113.42")).isInstanceOf(ResponseStatusException.class).hasMessageContaining("503");
        assertThat(http.calls).isEmpty();
    }
}
