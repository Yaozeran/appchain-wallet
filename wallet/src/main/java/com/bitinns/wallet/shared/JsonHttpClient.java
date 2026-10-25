package com.bitinns.wallet.shared;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Component
public class JsonHttpClient {
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER).build();
    private final JsonMapper mapper = JsonMapper.builder().build();

    public JsonNode get(String url) { return request("GET", url, Map.of(), null); }
    public JsonNode post(String url, Map<String, String> headers, Object body) { return request("POST", url, headers, body); }

    private JsonNode request(String method, String url, Map<String, String> headers, Object body) {
        try {
            var request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(15))
                    .header("Accept", "application/json");
            headers.forEach(request::header);
            if ("POST".equals(method)) request.header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
            else request.GET();
            var response = client.send(request.build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) throw new UpstreamException(response.statusCode());
            return mapper.readTree(response.body());
        } catch (UpstreamException exception) { throw exception; }
        catch (InterruptedException exception) {
            Thread.currentThread().interrupt(); throw new UpstreamException(0);
        } catch (Exception exception) { throw new UpstreamException(0); }
    }

    public static final class UpstreamException extends RuntimeException {
        public final int status;
        public UpstreamException(int status) { super("Upstream request failed (HTTP " + status + ")"); this.status = status; }
    }
}
