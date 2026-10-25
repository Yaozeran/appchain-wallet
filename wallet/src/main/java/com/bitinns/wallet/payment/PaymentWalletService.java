package com.bitinns.wallet.payment;

import com.bitinns.wallet.custody.CustodyService;
import com.bitinns.wallet.shared.JsonHttpClient;
import java.math.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class PaymentWalletService {
    private final JdbcTemplate db;
    private final CustodyService custody;
    private final JsonHttpClient http;
    private final String engine;
    private final JsonMapper json=JsonMapper.builder().build();
    public static final long TEST_CHAIN_ID=420690001;
    public PaymentWalletService(JdbcTemplate db,CustodyService custody,JsonHttpClient http,
                               @Value("${payment.simulator-url:http://127.0.0.1:8090}") String engine) {
        this.db=db;this.custody=custody;this.http=http;this.engine=engine;
    }
    private void lock() { db.execute("SELECT pg_advisory_xact_lock(87129422)"); }
    private static ResponseStatusException bad(String reason) {return new ResponseStatusException(HttpStatus.BAD_REQUEST,reason);}
    private static ResponseStatusException conflict(String reason) {return new ResponseStatusException(HttpStatus.CONFLICT,reason);}
    private String address(UUID user) {
        var values=db.queryForList("SELECT address FROM payment_wallets WHERE user_id=?",String.class,user);
        if(values.isEmpty())throw conflict("Link and unlock your recovery-phrase wallet first.");
        return values.getFirst();
    }
    @Transactional(readOnly=true,isolation=org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public Map<String,Object> snapshot(UUID user) {
        var legacy=custody.snapshot(user);
        var linked=db.queryForList("SELECT address FROM payment_wallets WHERE user_id=?",String.class,user);
        Map<String,Object> result=new LinkedHashMap<>();
        result.put("email",legacy.email());result.put("card",legacy.card());result.put("usdPerEth",legacy.usdPerEth());
        result.put("linked",!linked.isEmpty());result.put("address",linked.isEmpty()?"":linked.getFirst());
        result.put("chainId",TEST_CHAIN_ID);result.put("gasPriceWei","1000000");result.put("gasLimit","21000");
        result.put("mode","test");result.put("normalEnabled",false);
        result.put("cryptoWei","0");result.put("nonce",0);
        if(!linked.isEmpty()){
            var state=db.queryForMap("SELECT balance,nonce FROM payment_test_accounts WHERE address=?",linked.getFirst());
            result.put("cryptoWei",((BigDecimal)state.get("balance")).toBigIntegerExact().toString());result.put("nonce",state.get("nonce"));
        }
        return result;
    }
    @Transactional
    public Map<String,String> challenge(UUID user) {
        UUID challenge=UUID.randomUUID();
        db.update("INSERT INTO payment_wallet_challenges VALUES (?,?,now()+interval '10 minutes') ON CONFLICT(user_id) DO UPDATE SET challenge=EXCLUDED.challenge,expires_at=EXCLUDED.expires_at",user,challenge);
        return Map.of("message",message(user,challenge));
    }
    private static String message(UUID user,UUID challenge) {return "Wallet account link\nUser: "+user+"\nChallenge: "+challenge+"\nPurpose: offline payment wallet ownership; no transaction authorization";}
    @Transactional
    public Map<String,Object> bind(UUID user,String rawAddress,String signature) {
        String address=rawAddress==null?"":rawAddress.toLowerCase(Locale.ROOT);
        if(!address.matches("0x[0-9a-f]{40}")||address.matches("0x0{40}")||signature==null||signature.length()>200)throw bad("Provide a wallet address and ownership signature.");
        lock();
        var challenges=db.queryForList("SELECT challenge FROM payment_wallet_challenges WHERE user_id=? AND expires_at>now() FOR UPDATE",UUID.class,user);
        if(challenges.isEmpty())throw conflict("Request a fresh wallet ownership challenge.");
        var proof=call("prove",Map.of("message",message(user,challenges.getFirst()),"address",address,"signature",signature));
        if(!proof.path("ok").asBoolean())throw bad("Wallet ownership signature is invalid.");
        var existing=db.queryForList("SELECT address FROM payment_wallets WHERE user_id=?",String.class,user);
        if(!existing.isEmpty()&&!existing.getFirst().equals(address))throw conflict("This account already has a different wallet. Restore its recovery phrase.");
        db.update("INSERT INTO payment_test_accounts(address) VALUES (?) ON CONFLICT DO NOTHING",address);
        try {db.update("INSERT INTO payment_wallets(user_id,address) VALUES (?,?) ON CONFLICT(user_id) DO NOTHING",user,address);}
        catch(DuplicateKeyException error){throw conflict("This wallet is already linked to another email account.");}
        db.update("DELETE FROM payment_wallet_challenges WHERE user_id=?",user);
        return snapshot(user);
    }
    public record Purchase(UUID requestKey,UUID cardId,String fiatAmount) {}
    @Transactional
    public Map<String,Object> buy(UUID user,Purchase input) {
        if(input.requestKey()==null)throw bad("A request key is required.");
        if(input.fiatAmount()==null||!input.fiatAmount().matches("[0-9]{1,4}(?:\\.[0-9]{1,2})?"))throw bad("Enter a positive USD amount, maximum $1,000.");
        BigInteger cents=new BigDecimal(input.fiatAmount()).movePointRight(2).toBigIntegerExact();
        if(cents.signum()<=0||cents.compareTo(BigInteger.valueOf(100000))>0)throw bad("Enter a positive USD amount, maximum $1,000.");
        db.execute("SELECT pg_advisory_xact_lock(87129421)");lock();
        String address=address(user),fingerprint=input.cardId()+":"+cents;
        var prior=db.queryForList("SELECT journal_id,fingerprint FROM payment_test_purchases WHERE user_id=? AND request_key=?",user,input.requestKey());
        if(!prior.isEmpty()){
            if(!fingerprint.equals(prior.getFirst().get("fingerprint")))throw conflict("Purchase key was used with different details.");
            return Map.of("id",prior.getFirst().get("journal_id").toString(),"replayed",true,"status","TEST_WALLET_CREDITED");
        }
        if(db.queryForObject("SELECT count(*) FROM custody_cards WHERE user_id=? AND id=?",Integer.class,user,input.cardId())!=1)throw bad("Choose your issued fake card.");
        String usd=user+":USD";
        if(db.queryForObject("SELECT balance FROM custody_accounts WHERE code=?",BigDecimal.class,usd).compareTo(new BigDecimal(cents))<0)throw bad("Insufficient fake card balance.");
        BigInteger wei=cents.multiply(BigInteger.TEN.pow(18)).divide(BigInteger.valueOf(250000));
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO custody_journals(id,user_id,kind,request_key,fingerprint,fiat_cents,crypto_wei,status) VALUES (?,?,'BUY',?,?,?,?, 'DEMO_CONVERTED')",id,user,input.requestKey(),"DIRECT_TEST_WALLET:"+fingerprint,new BigDecimal(cents),new BigDecimal(wei));
        db.update("UPDATE custody_accounts SET balance=balance-? WHERE code=?",new BigDecimal(cents),usd);
        db.update("UPDATE custody_accounts SET balance=balance+? WHERE code='system:fiat-settlement'",new BigDecimal(cents));
        db.update("INSERT INTO custody_entries(journal_id,account_code,delta) VALUES (?,?,?),(?,'system:fiat-settlement',?)",id,usd,new BigDecimal(cents.negate()),id,new BigDecimal(cents));
        db.update("UPDATE payment_test_accounts SET balance=balance+? WHERE address=?",new BigDecimal(wei),address);
        db.update("INSERT INTO payment_test_purchases(user_id,request_key,journal_id,address,crypto_wei,fingerprint) VALUES (?,?,?,?,?,?)",user,input.requestKey(),id,address,new BigDecimal(wei),fingerprint);
        return Map.of("id",id.toString(),"replayed",false,"status","TEST_WALLET_CREDITED");
    }
    public record Payment(UUID requestKey,List<String> rawTransactions,int blockCapacity) {
        @Override public String toString(){return "Payment[signed payload redacted]";}
    }
    @Transactional
    public JsonNode send(UUID user,Payment input) {
        if(input.requestKey()==null||input.rawTransactions()==null||input.rawTransactions().isEmpty()||input.rawTransactions().size()>200||input.blockCapacity()<1||input.blockCapacity()>100)throw bad("Submit 1–200 signed payments and a block capacity of 1–100.");
        for(String raw:input.rawTransactions())if(raw==null||raw.length()>1024)throw bad("Invalid signed transaction size.");
        lock();String address=address(user);
        String fingerprint=digest(json.writeValueAsString(List.of(input.rawTransactions(),input.blockCapacity())));
        var prior=db.queryForList("SELECT result,fingerprint FROM payment_test_runs WHERE user_id=? AND request_key=?",user,input.requestKey());
        if(!prior.isEmpty()){
            if(!fingerprint.equals(prior.getFirst().get("fingerprint")))throw conflict("Payment key was used with different details.");
            return json.readTree(prior.getFirst().get("result").toString());
        }
        var accounts=new LinkedHashMap<String,Object>();
        db.query("SELECT address,balance,nonce FROM payment_test_accounts",rs->{accounts.put(rs.getString(1),Map.of("balance",rs.getBigDecimal(2).toBigIntegerExact().toString(),"nonce",rs.getLong(3)));});
        var head=db.queryForMap("SELECT number,hash,timestamp FROM payment_test_head WHERE id=1");
        var result=call("execute",Map.of("sender",address,"rawTransactions",input.rawTransactions(),"blockCapacity",input.blockCapacity(),"accounts",accounts,"head",head));
        if(!result.path("ok").asBoolean()) {
            String reason=result.path("message").asText("Signed payment was rejected.");
            if(result.path("conflict").asBoolean())throw conflict(reason);
            throw bad(reason);
        }
        for(var entry:result.path("accounts").properties()) {
            var state=entry.getValue();
            db.update("INSERT INTO payment_test_accounts(address,balance,nonce) VALUES (?,?,?) ON CONFLICT(address) DO UPDATE SET balance=EXCLUDED.balance,nonce=EXCLUDED.nonce",entry.getKey(),new BigDecimal(state.path("balance").asText()),state.path("nonce").asLong());
        }
        var next=result.path("head");
        db.update("UPDATE payment_test_head SET number=?,hash=?,timestamp=? WHERE id=1",next.path("number").asLong(),next.path("hash").asText(),next.path("timestamp").asLong());
        UUID id=UUID.randomUUID();
        // Internal state is not part of the public result/history.
        var publicResult=result.deepCopy();
        ((tools.jackson.databind.node.ObjectNode)publicResult).remove("accounts");
        ((tools.jackson.databind.node.ObjectNode)publicResult).put("id",id.toString());
        db.update("INSERT INTO payment_test_runs(id,user_id,request_key,fingerprint,result) VALUES (?,?,?,?,?::jsonb)",id,user,input.requestKey(),fingerprint,json.writeValueAsString(publicResult));
        for(var receipt:result.path("receipts"))db.update("INSERT INTO payment_test_receipts VALUES (?,?,?,?,?::jsonb)",receipt.path("transactionHash").asText(),id,receipt.path("from").asText(),receipt.path("to").asText(),json.writeValueAsString(receipt));
        return publicResult;
    }
    @Transactional(readOnly=true)
    public Map<String,Object> history(UUID user) {
        String address=address(user);
        var runs=db.query("SELECT result FROM payment_test_runs WHERE user_id=? ORDER BY created_at DESC LIMIT 10",(rs,n)->json.readTree(rs.getString(1)),user);
        var receipts=db.query("SELECT receipt FROM payment_test_receipts WHERE sender=? OR recipient=? ORDER BY (receipt->>'blockNumber')::bigint DESC,(receipt->>'transactionIndex')::int DESC LIMIT 50",(rs,n)->json.readTree(rs.getString(1)),address,address);
        var purchases=db.queryForList("SELECT journal_id AS id,crypto_wei::text AS wei,created_at FROM payment_test_purchases WHERE user_id=? ORDER BY created_at DESC LIMIT 20",user);
        return Map.of("runs",runs,"receipts",receipts,"purchases",purchases);
    }
    private JsonNode call(String path,Object body) {
        try {return http.post(engine+"/"+path,Map.of(),body);}
        catch(JsonHttpClient.UpstreamException error){throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"Offline rollup engine unavailable. Retry with the same request key.");}
    }
    private static String digest(String value) {
        try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}
        catch(Exception error){throw new IllegalStateException("SHA-256 unavailable");}
    }
}
