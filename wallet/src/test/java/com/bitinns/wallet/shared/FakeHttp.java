package com.bitinns.wallet.shared;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

public class FakeHttp extends JsonHttpClient {
    public record Call(String url, Map<String,String> headers, Object body) {}
    public final List<Call> calls = new ArrayList<>();
    public final Deque<Object> results = new ArrayDeque<>();
    public FakeHttp add(String json) { results.add(JsonMapper.builder().build().readTree(json)); return this; }
    public FakeHttp fail(int status) { results.add(new UpstreamException(status)); return this; }
    @Override public JsonNode get(String url) { return next(new Call(url, Map.of(), null)); }
    @Override public JsonNode post(String url, Map<String,String> headers, Object body) { return next(new Call(url, headers, body)); }
    private JsonNode next(Call call) {
        calls.add(call);
        Object value = results.remove();
        if (value instanceof RuntimeException exception) throw exception;
        return (JsonNode) value;
    }
}
