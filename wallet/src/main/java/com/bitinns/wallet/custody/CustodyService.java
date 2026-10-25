package com.bitinns.wallet.custody;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class CustodyService {
    private final JdbcTemplate db;
    private final SecureRandom random = new SecureRandom();
    private final String dummyHash = PasswordHash.hash("unused-dummy-password");
    private static final BigInteger WEI = BigInteger.TEN.pow(18);
    private static final BigInteger CENTS_PER_ETH = BigInteger.valueOf(250_000);
    public static final String DEMO_EMAIL = "demo@wallet.test";
    public static final String DEMO_PASSWORD = "DemoWallet!2026";

    public CustodyService(JdbcTemplate db) { this.db = db; }

    // Serialize this demo ledger's mutations across backend instances. Held until commit/rollback.
    // This deliberately favors correctness over throughput; production needs per-account locking.
    private void ledgerLock() { db.execute("SELECT pg_advisory_xact_lock(87129421)"); }
    private static ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
    private static String account(UUID user, String asset) { return user + ":" + asset; }

    @Transactional
    public UUID register(String email, String password) {
        String normalized = normalizeEmail(email);
        validatePassword(password);
        String hash = PasswordHash.hash(password);
        ledgerLock();
        UUID user = UUID.randomUUID();
        byte[] address = new byte[20]; random.nextBytes(address);
        try {
            db.update("INSERT INTO custody_users(id,email,password_hash,demo_address) VALUES (?,?,?,?)",
                    user, normalized, hash, "0x" + HexFormat.of().formatHex(address));
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This email already has a demo account. Sign in instead.");
        }
        db.update("INSERT INTO custody_cards(id,user_id) VALUES (?,?)", UUID.randomUUID(), user);
        db.update("INSERT INTO custody_accounts(code,user_id,asset) VALUES (?,?,'USD'),(?,?,'ETH')",
                account(user,"USD"), user, account(user,"ETH"), user);
        UUID journal = UUID.randomUUID();
        db.update("INSERT INTO custody_journals(id,user_id,kind,request_key,fingerprint,fiat_cents,status) VALUES (?,?,'FUND',?,'initial-demo-funding',100000,'DEMO_FUNDED')",
                journal, user, UUID.randomUUID());
        move(journal, "system:demo-funding", account(user,"USD"), BigInteger.valueOf(100_000));
        return user;
    }

    @Transactional
    public UUID demo() {
        ledgerLock();
        var users = db.queryForList("SELECT id FROM custody_users WHERE email=?", UUID.class, DEMO_EMAIL);
        if (users.isEmpty()) return register(DEMO_EMAIL, DEMO_PASSWORD);
        // The demo email is reserved so its known password cannot be changed by registration.
        return users.getFirst();
    }

    public UUID login(String email, String password) {
        String normalized = normalizeEmail(email);
        if (password == null || password.length() > 128) throw bad("Enter your password (up to 128 characters).");
        var users = db.query("SELECT id,password_hash FROM custody_users WHERE email=?",
                (rs,n) -> new Login(rs.getObject(1,UUID.class),rs.getString(2)), normalized);
        boolean valid = PasswordHash.matches(password, users.isEmpty() ? dummyHash : users.getFirst().hash());
        if (!valid || users.isEmpty()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Email or password is incorrect.");
        return users.getFirst().id();
    }

    private static String normalizeEmail(String email) {
        String value = email == null ? "" : email.strip().toLowerCase(Locale.ROOT);
        if (value.length() > 254 || !value.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) throw bad("Enter a valid demo email address.");
        return value;
    }
    private static void validatePassword(String password) {
        if (password == null || password.length() < 12 || password.length() > 128) throw bad("Use a password of 12 to 128 characters.");
    }

    @Transactional
    public String createSession(UUID user) {
        db.update("DELETE FROM custody_sessions WHERE expires_at < now()");
        byte[] bytes = new byte[32]; random.nextBytes(bytes);
        String token = HexFormat.of().formatHex(bytes);
        db.update("INSERT INTO custody_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)",
                digest(token), user, Timestamp.from(Instant.now().plusSeconds(28_800)));
        return token;
    }
    public UUID authenticate(String token) {
        if (token == null || !token.matches("[a-f0-9]{64}")) throw unauthorized();
        var users = db.queryForList("SELECT user_id FROM custody_sessions WHERE token_hash=? AND expires_at > now()", UUID.class, digest(token));
        if (users.isEmpty()) throw unauthorized();
        return users.getFirst();
    }
    public void logout(String token) { if (token != null) db.update("DELETE FROM custody_sessions WHERE token_hash=?",digest(token)); }
    private static ResponseStatusException unauthorized() { return new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Sign in to your demo account."); }
    private static String digest(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException exception) { throw new IllegalStateException("SHA-256 unavailable"); }
    }

    @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
    public Snapshot snapshot(UUID user) {
        var identity = db.queryForMap("SELECT email,demo_address FROM custody_users WHERE id=?",user);
        var card = db.queryForMap("SELECT id,label,last_four,expires FROM custody_cards WHERE user_id=?",user);
        return new Snapshot("simulation", identity.get("email").toString(), identity.get("demo_address").toString(),
                balance(account(user,"ETH")).toString(),
                new Card(card.get("id").toString(),card.get("label").toString(),card.get("last_four").toString(),
                        card.get("expires").toString(),balance(account(user,"USD")).toString()),
                "2500.00", history(user));
    }

    private List<Activity> history(UUID user) {
        return db.query("""
                SELECT id,kind,status,fiat_cents,crypto_wei,recipient_address,created_at,user_id,
                    (SELECT demo_address FROM custody_users WHERE id=j.user_id) AS sender_address
                FROM custody_journals j WHERE user_id=? OR recipient_user_id=? ORDER BY created_at DESC,id DESC LIMIT 50
                """, (rs,n) -> new Activity(rs.getObject("id").toString(),
                        rs.getString("kind").equals("SEND") && !user.equals(rs.getObject("user_id",UUID.class)) ? "RECEIVE" : rs.getString("kind"),
                        rs.getString("status"),rs.getBigDecimal("fiat_cents").toBigIntegerExact().toString(),
                        rs.getBigDecimal("crypto_wei").toBigIntegerExact().toString(),rs.getString("recipient_address"),
                        rs.getString("sender_address"),rs.getTimestamp("created_at").toInstant().toString()), user,user);
    }
    private BigInteger balance(String code) { return db.queryForObject("SELECT balance FROM custody_accounts WHERE code=?",BigDecimal.class,code).toBigIntegerExact(); }

    @Transactional
    public Receipt buy(UUID user, UUID requestKey, UUID cardId, String fiatAmount) {
        BigInteger cents = units(fiatAmount,2,"USD amount");
        if (cents.compareTo(BigInteger.valueOf(100_000)) > 0) throw bad("Maximum demo purchase is $1,000.");
        String fingerprint = "BUY:" + cardId + ":" + cents;
        ledgerLock();
        Receipt prior = previous(user,requestKey,fingerprint);
        if (prior != null) return prior;
        Integer matches = db.queryForObject("SELECT count(*) FROM custody_cards WHERE user_id=? AND id=?",Integer.class,user,cardId);
        if (matches == null || matches != 1) throw bad("Choose your issued demo card.");
        if (balance(account(user,"USD")).compareTo(cents) < 0) throw bad("Insufficient fake card balance.");
        BigInteger wei = cents.multiply(WEI).divide(CENTS_PER_ETH);
        UUID id = UUID.randomUUID();
        db.update("INSERT INTO custody_journals(id,user_id,kind,request_key,fingerprint,fiat_cents,crypto_wei,status) VALUES (?,?,'BUY',?,?,?,?,'DEMO_CONVERTED')",
                id,user,requestKey,fingerprint,new BigDecimal(cents),new BigDecimal(wei));
        move(id,account(user,"USD"),"system:fiat-settlement",cents);
        move(id,"system:crypto-inventory",account(user,"ETH"),wei);
        return new Receipt(id.toString(),"DEMO_CONVERTED",false);
    }

    @Transactional
    public Receipt send(UUID user, UUID requestKey, String recipient, String ethAmount) {
        BigInteger wei = units(ethAmount,18,"ETH amount");
        String address = recipient == null ? "" : recipient.strip().toLowerCase(Locale.ROOT);
        if (!address.matches("0x[0-9a-f]{40}") || address.matches("0x0{40}")) throw bad("Enter a nonzero Ethereum address.");
        String fingerprint = "SEND:" + address + ":" + wei;
        ledgerLock();
        Receipt prior = previous(user,requestKey,fingerprint);
        if (prior != null) return prior;
        var recipients = db.queryForList("SELECT id FROM custody_users WHERE demo_address=?",UUID.class,address);
        UUID recipientUser = recipients.isEmpty() ? null : recipients.getFirst();
        if (user.equals(recipientUser)) throw bad("Choose another account's address.");
        if (balance(account(user,"ETH")).compareTo(wei) < 0) throw bad("Insufficient demo ETH balance.");
        String status = recipientUser == null ? "EXTERNAL_SIMULATED" : "INTERNAL_COMPLETED";
        UUID id = UUID.randomUUID();
        db.update("INSERT INTO custody_journals(id,user_id,recipient_user_id,kind,request_key,fingerprint,crypto_wei,recipient_address,status) VALUES (?,?,?,'SEND',?,?,?,?,?)",
                id,user,recipientUser,requestKey,fingerprint,new BigDecimal(wei),address,status);
        move(id,account(user,"ETH"),recipientUser == null ? "system:external-payments" : account(recipientUser,"ETH"),wei);
        return new Receipt(id.toString(),status,false);
    }

    private static BigInteger units(String value, int decimals, String label) {
        if (value == null || value.length() > 50 || !value.matches("[0-9]+(?:\\.[0-9]{1," + decimals + "})?"))
            throw bad("Enter a positive " + label + " with up to " + decimals + " decimal places.");
        BigInteger units = new BigDecimal(value).movePointRight(decimals).toBigIntegerExact();
        if (units.signum() <= 0 || units.toString().length() > 60) throw bad("Enter a positive, supported " + label + ".");
        return units;
    }
    private Receipt previous(UUID user, UUID key, String fingerprint) {
        if (key == null) throw bad("An idempotency key is required.");
        var found = db.queryForList("SELECT id,status,fingerprint FROM custody_journals WHERE user_id=? AND request_key=?",user,key);
        if (found.isEmpty()) return null;
        var row = found.getFirst();
        if (!fingerprint.equals(row.get("fingerprint"))) throw new ResponseStatusException(HttpStatus.CONFLICT,"This request key was already used for different payment details.");
        return new Receipt(row.get("id").toString(),row.get("status").toString(),true);
    }
    private void move(UUID journal, String from, String to, BigInteger amount) {
        BigDecimal quantity = new BigDecimal(amount);
        db.update("UPDATE custody_accounts SET balance=balance-? WHERE code=?",quantity,from);
        db.update("UPDATE custody_accounts SET balance=balance+? WHERE code=?",quantity,to);
        db.update("INSERT INTO custody_entries(journal_id,account_code,delta) VALUES (?,?,?),(?,?,?)",
                journal,from,quantity.negate(),journal,to,quantity);
    }

    private record Login(UUID id, String hash) { @Override public String toString() { return "Login[redacted]"; } }
    public record Card(String id,String label,String lastFour,String expires,String fiatCents) {}
    public record Snapshot(String mode,String email,String address,String cryptoWei,Card card,String usdPerEth,List<Activity> activity) {}
    public record Activity(String id,String kind,String status,String fiatCents,String cryptoWei,String recipientAddress,String senderAddress,String createdAt) {}
    public record Receipt(String id,String status,boolean replayed) {}
}
