package com.bitinns.wallet.custody;

import com.bitinns.wallet.shared.FakeHttp;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayInputStream;
import java.util.zip.InflaterInputStream;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class AppchainStatusTests {
    private AppchainStatusService service(FakeHttp http) { return new AppchainStatusService(http,"http://op-reth:8545",BigInteger.valueOf(42069)); }
    private String rpc(String result) { return "{\"result\":"+result+"}"; }
    @Test void offlineAndWrongChainNeverProduceFakeThroughput() {
        var offline=service(new FakeHttp().fail(0)).metrics();
        assertThat(offline.sequencerAvailable()).isFalse();
        assertThat(offline.inclusionTps()).isNull();
        assertThat(offline.batcherTps()).isNull();
        assertThat(service(new FakeHttp().add(rpc("\"0xa\""))).metrics().sequencerAvailable()).isFalse();
        assertThat(service(new FakeHttp()).capabilities().get("normalEnabled")).isEqualTo(false);
    }
    @Test void inclusionCountsOnlyNonDepositTransactionsOverMatchingBlockIntervals() {
        var http=new FakeHttp().add(rpc("\"0xa455\"")).add(rpc("\"0x2\""))
          .add(rpc("{\"hash\":\"anchor\",\"timestamp\":\"0x64\"}"))
          .add(rpc("{\"hash\":\"one\",\"parentHash\":\"anchor\",\"timestamp\":\"0x66\",\"transactions\":[{\"type\":\"0x7e\"},{\"type\":\"0x2\"}]}"))
          .add(rpc("{\"hash\":\"two\",\"parentHash\":\"one\",\"timestamp\":\"0x68\",\"transactions\":[{\"type\":\"0x2\"},{\"type\":\"0x2\"}]}"));
        var metrics=service(http).metrics();
        assertThat(metrics.sequencerAvailable()).isTrue();
        assertThat(metrics.transactions()).isEqualTo(3);
        assertThat(metrics.inclusionTps()).isEqualTo(0.75);
        assertThat(metrics.batcherTps()).isNull();
    }
    @Test void inconsistentBlockChainRejectsSample() {
        var http=new FakeHttp().add(rpc("\"0xa455\"")).add(rpc("\"0x1\""))
          .add(rpc("{\"hash\":\"anchor\",\"timestamp\":\"0x64\"}"))
          .add(rpc("{\"hash\":\"one\",\"parentHash\":\"different-fork\",\"timestamp\":\"0x66\",\"transactions\":[]}"));
        assertThat(service(http).metrics().inclusionTps()).isNull();
    }
    @Test void compressedApplicationBatchRoundTripsWithoutCorruptingReceipts() throws Exception {
        byte[] raw="receipt:1\nreceipt:2\nreceipt:3\n".repeat(20).getBytes(StandardCharsets.UTF_8);
        byte[] zipped=PaymentTrafficService.compress(raw);
        assertThat(zipped.length).isLessThan(raw.length);
        try(var stream=new InflaterInputStream(new ByteArrayInputStream(zipped))) { assertThat(stream.readAllBytes()).isEqualTo(raw); }
    }
}
