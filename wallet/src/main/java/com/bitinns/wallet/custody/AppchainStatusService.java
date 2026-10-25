package com.bitinns.wallet.custody;

import com.bitinns.wallet.shared.JsonHttpClient;
import java.math.BigInteger;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

@Service
public class AppchainStatusService {
    private final JsonHttpClient http;
    private final String url;
    private final BigInteger chainId;
    public AppchainStatusService(JsonHttpClient http,@Value("${balance.appchain-rpc}") String url,
                                 @Value("${balance.appchain-id}") BigInteger chainId) {
        this.http=http; this.url=url; this.chainId=chainId;
    }
    public Map<String,Object> capabilities() {
        return Map.of("mode","test","normalEnabled",false,"reason",
            "Normal mode requires a deployed OP Stack chain and a verified live payment flow. Test mode signs payments in your browser and executes an offline rollup model; no on-chain interaction.");
    }
    public record Metrics(boolean sequencerAvailable,String source,String reason,String chainId,
                          Long latestBlock,Integer sampledBlocks,Integer transactions,Double inclusionTps,Double batcherTps) {}
    public Metrics metrics() {
        try {
            if(!number(rpc("eth_chainId",List.of()).asText()).equals(chainId)) throw new IllegalStateException();
            long latest=number(rpc("eth_blockNumber",List.of()).asText()).longValueExact();
            long first=Math.max(0,latest-10);
            var anchor=rpc("eth_getBlockByNumber",List.of("0x"+Long.toHexString(first),false));
            String parent=anchor.path("hash").asText();
            long start=number(anchor.path("timestamp").asText()).longValueExact(), end=start;
            int transactions=0;
            for(long i=first+1;i<=latest;i++) {
                var block=rpc("eth_getBlockByNumber",List.of("0x"+Long.toHexString(i),true));
                if(!block.path("parentHash").asText().equals(parent)) throw new IllegalStateException();
                parent=block.path("hash").asText();
                long timestamp=number(block.path("timestamp").asText()).longValueExact();
                if(timestamp<=end || !block.path("transactions").isArray()) throw new IllegalStateException();
                end=timestamp;
                for(var tx:block.path("transactions")) if(!"0x7e".equals(tx.path("type").asText())) transactions++;
            }
            return new Metrics(true,"OP_STACK_RPC","Observed non-deposit inclusion over up to 10 block intervals; not maximum capacity. Batcher TPS is unavailable until publication is instrumented.",
                chainId.toString(),latest,(int)(latest-first),transactions,end>start?transactions/(double)(end-start):null,null);
        } catch(RuntimeException error) {
            return new Metrics(false,"OP_STACK_RPC","OP Stack RPC unavailable, wrong chain, or inconsistent blocks. Complete deployment, export genesis and start op-reth/op-node. No real OP TPS measured.",chainId.toString(),null,null,null,null,null);
        }
    }
    private JsonNode rpc(String method,List<?> params) {
        var response=http.post(url,Map.of(),Map.of("jsonrpc","2.0","id",1,"method",method,"params",params));
        if(response.hasNonNull("error") || !response.hasNonNull("result")) throw new IllegalStateException();
        return response.get("result");
    }
    private static BigInteger number(String value) {
        if(!value.matches("0x[0-9a-fA-F]+")) throw new IllegalArgumentException();
        return new BigInteger(value.substring(2),16);
    }
}
