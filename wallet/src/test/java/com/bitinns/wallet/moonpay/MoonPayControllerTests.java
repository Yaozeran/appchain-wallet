package com.bitinns.wallet.moonpay;

import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.hamcrest.Matchers.*;

class MoonPayControllerTests {
    private MockMvc api(MoonPayProperties props) {
        return MockMvcBuilders.standaloneSetup(new MoonPayController(new MoonPayService(props), new ClientIpResolver(props, ""))).build();
    }

    @Test void configurationNeverReturnsCredentials() throws Exception {
        api(MoonPayServiceTests.sandbox()).perform(get("/api/moonpay/config"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.available").value(true)).andExpect(jsonPath("$.environment").value("sandbox"))
                .andExpect(content().string(not(containsString("pk_test_fixture"))))
                .andExpect(content().string(not(containsString("sk_test_fixture"))));
    }

    @Test void returnsSignedCheckoutWithNoStoreHeaders() throws Exception {
        api(MoonPayServiceTests.sandbox()).perform(post("/api/moonpay/checkout").contentType(MediaType.APPLICATION_JSON)
                .content("{\"walletAddress\":\"" + MoonPayServiceTests.ADDRESS + "\",\"fiatCurrency\":\"usd\",\"fiatAmount\":50}"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.url").value(startsWith("https://buy-sandbox.moonpay.com?")))
                .andExpect(content().string(not(containsString("sk_test_fixture"))));
    }

    @Test void rejectsMalformedAndInvalidRequestsWithoutEchoingTheBody() throws Exception {
        for (String body : new String[] {"not json", "{}", "{\"walletAddress\":\"secret input\",\"fiatCurrency\":\"usd\",\"fiatAmount\":50}"}) {
            api(MoonPayServiceTests.sandbox()).perform(post("/api/moonpay/checkout").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").isString())
                    .andExpect(content().string(not(containsString("secret input"))));
        }
    }

    @Test void missingCredentialsHaveAnExplicitUnavailableResponse() throws Exception {
        api(new MoonPayProperties("sandbox", "", "", false, Set.of()))
                .perform(post("/api/moonpay/checkout").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.message").isString());
    }
}
