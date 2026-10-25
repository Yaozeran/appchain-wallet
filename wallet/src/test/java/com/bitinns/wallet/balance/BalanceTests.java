package com.bitinns.wallet.balance;

import com.bitinns.wallet.shared.FakeHttp;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.assertj.core.api.Assertions.*;

class BalanceTests {
    static final String ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    static BalanceService service(FakeHttp http) { return new BalanceService(http,"https://mainnet.test","https://sepolia.test","https://op.test","https://btc.test","http://op-reth:8545",java.math.BigInteger.valueOf(42069)); }
    static String rpc(String value) { return "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":\""+value+"\"}"; }

    @Test void readsSepoliaWithItsChainIdAndPreservesWeiPrecision() {
        var http = new FakeHttp().add(rpc("0xaa36a7")).add(rpc("0xde0b6b3a7640001"));
        var balance = service(http).read("sepolia",ADDRESS,"native");
        assertThat(balance.baseUnits()).isEqualTo("1000000000000000001");
        assertThat(balance.symbol()).isEqualTo("ETH");
        assertThat(http.calls.getFirst().url()).isEqualTo("https://sepolia.test");
        assertThat(((Map<?,?>)http.calls.get(1).body()).get("method")).isEqualTo("eth_getBalance");
    }

    @Test void refusesWrongRpcNetworkAndUpstreamErrorsInsteadOfReportingZero() {
        var http = new FakeHttp().add(rpc("0x1"));
        assertThatThrownBy(() -> service(http).read("sepolia",ADDRESS,"native")).isInstanceOf(ResponseStatusException.class).hasMessageContaining("wrong chain");
        assertThatThrownBy(() -> service(new FakeHttp().fail(429)).read("eth",ADDRESS,"native")).isInstanceOf(ResponseStatusException.class).hasMessageContaining("502");
        assertThatThrownBy(() -> service(new FakeHttp().add("{\"error\":{\"code\":-1}}")).read("eth",ADDRESS,"native")).isInstanceOf(ResponseStatusException.class);
    }

    @Test void bitcoinSeparatesConfirmedSatoshisFromPendingChange() {
        var http = new FakeHttp().add("{\"chain_stats\":{\"funded_txo_sum\":200000000,\"spent_txo_sum\":100000000},\"mempool_stats\":{\"funded_txo_sum\":1000,\"spent_txo_sum\":2000}}");
        var balance = service(http).read("btc","bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu","native");
        assertThat(balance.baseUnits()).isEqualTo("100000000");
        assertThat(balance.pendingBaseUnits()).isEqualTo("-1000");
        assertThat(balance.decimals()).isEqualTo(8);
    }

    @Test void tokenBalanceUsesThePublishedSepoliaContractAndOnchainDecimals() {
        var http = new FakeHttp().add(rpc("0xaa36a7")).add(rpc("0x3e8")).add(rpc("0x12"));
        var result = service(http).read("sepolia",ADDRESS,"trnsk");
        assertThat(result.symbol()).isEqualTo("TRNSK"); assertThat(result.baseUnits()).isEqualTo("1000");
        var params = (List<?>)((Map<?,?>)http.calls.get(1).body()).get("params");
        var call = (Map<?,?>)params.getFirst();
        assertThat(call.get("to")).isEqualTo(BalanceService.TRNSK);
        assertThat(call.get("data")).isEqualTo("0x70a08231"+"0".repeat(24)+ADDRESS.substring(2));
    }

    @Test void rejectsCrossChainAddressesAndUnknownChainsBeforeAnyRequest() {
        var http = new FakeHttp(); var service = service(http);
        assertThatThrownBy(() -> service.read("btc",ADDRESS,"native")).isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
        assertThatThrownBy(() -> service.read("sepolia","bc1qinvalid","native")).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.read("unknown",ADDRESS,"native")).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.read("eth",ADDRESS,"trnsk")).isInstanceOf(ResponseStatusException.class);
        assertThat(http.calls).isEmpty();
    }

    @Test void appchainIsDistinctFromOpMainnetAndHasNoInventedExplorer() {
        var http = new FakeHttp().add(rpc("0xa455")).add(rpc("0x1"));
        var balance = service(http).read("appchain",ADDRESS,"native");
        assertThat(balance.baseUnits()).isEqualTo("1");
        assertThat(balance.explorerUrl()).isEmpty();
        assertThat(http.calls.getFirst().url()).isEqualTo("http://op-reth:8545");
        assertThatThrownBy(() -> service(new FakeHttp().add(rpc("0xa"))).read("appchain",ADDRESS,"native"))
                .hasMessageContaining("wrong chain ID");
        assertThatThrownBy(() -> service(new FakeHttp().fail(0)).read("appchain",ADDRESS,"native"))
                .hasMessageContaining("optional OP Stack Docker setup");
    }
}
