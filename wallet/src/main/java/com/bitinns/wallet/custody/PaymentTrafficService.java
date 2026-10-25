package com.bitinns.wallet.custody;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.DeflaterOutputStream;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/** Measures the application ledger + zlib pipeline. Never represents OP execution. */
@Service
public class PaymentTrafficService {
    private final CustodyService custody;
    private final JdbcTemplate db;
    public PaymentTrafficService(CustodyService custody, JdbcTemplate db) { this.custody=custody; this.db=db; }
    public record Traffic(UUID requestKey,String recipientAddress,String ethAmount,int count) {}
    public record Result(String id,int payments,double processingMs,double processingTps,double averageProcessingMs,
                         int rawBytes,int compressedBytes,String scope,String l1Status,boolean replayed) {}

    @Transactional
    public Result run(UUID user, Traffic input) {
        if(input.requestKey()==null || input.count()<1 || input.count()>200)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Choose 1–200 test payments and supply a request key.");
        String fingerprint=JsonMapper.builder().build().writeValueAsString(List.of(
                Objects.toString(input.recipientAddress(),""),Objects.toString(input.ethAmount(),""),input.count()));
        // Same lock as single payments; prevents overspend and concurrent duplicate test runs.
        db.execute("SELECT pg_advisory_xact_lock(87129421)");
        var prior=db.queryForList("SELECT id,fingerprint FROM custody_test_batches WHERE user_id=? AND request_key=?",user,input.requestKey());
        if(!prior.isEmpty()) {
            if(!fingerprint.equals(prior.getFirst().get("fingerprint"))) throw new ResponseStatusException(HttpStatus.CONFLICT,"Test request key was used with different details.");
            return result(user,UUID.fromString(prior.getFirst().get("id").toString()),true);
        }
        UUID id=UUID.randomUUID();
        var receipts=new ArrayList<CustodyService.Receipt>();
        long start=System.nanoTime();
        for(int i=0;i<input.count();i++) {
            UUID key=UUID.nameUUIDFromBytes(("payment-traffic:"+input.requestKey()+":"+i).getBytes(StandardCharsets.UTF_8));
            receipts.add(custody.send(user,key,input.recipientAddress(),input.ethAmount()));
        }
        byte[] raw=JsonMapper.builder().build().writeValueAsBytes(Map.of("format","wallet-application-test-v1",
                "recipient",input.recipientAddress(),"ethAmount",input.ethAmount(),"receipts",receipts));
        byte[] compressed=compress(raw);
        double elapsed=Math.max((System.nanoTime()-start)/1_000_000.0,0.001);
        db.update("INSERT INTO custody_test_batches(id,user_id,request_key,fingerprint,payment_count,processing_ms,raw_bytes,compressed_payload) VALUES (?,?,?,?,?,?,?,?)",
                id,user,input.requestKey(),fingerprint,input.count(),elapsed,raw.length,compressed);
        for(var receipt:receipts) db.update("INSERT INTO custody_test_batch_payments(batch_id,journal_id) VALUES (?,?)",id,UUID.fromString(receipt.id()));
        return result(user,id,false);
    }
    public List<Result> history(UUID user) {
        return db.query("SELECT id FROM custody_test_batches WHERE user_id=? ORDER BY created_at DESC LIMIT 10",
                (rs,n)->UUID.fromString(rs.getString("id")),user).stream().map(id->result(user,id,false)).toList();
    }
    private Result result(UUID user,UUID id,boolean replayed) {
        return db.queryForObject("SELECT *,octet_length(compressed_payload) AS compressed_bytes FROM custody_test_batches WHERE user_id=? AND id=?",
            (rs,n)-> { int count=rs.getInt("payment_count"); double ms=rs.getDouble("processing_ms");
                return new Result(id.toString(),count,ms,count*1000.0/ms,ms/count,rs.getInt("raw_bytes"),rs.getInt("compressed_bytes"),
                    "APPLICATION_LEDGER_AND_ZLIB","NOT_SUBMITTED",replayed); },user,id);
    }
    static byte[] compress(byte[] raw) {
        try { var output=new ByteArrayOutputStream(); try(var stream=new DeflaterOutputStream(output)) { stream.write(raw); } return output.toByteArray(); }
        catch(java.io.IOException error) { throw new IllegalStateException("Test batch encoding failed."); }
    }
}
