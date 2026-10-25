package com.bitinns.wallet.custody;

import jakarta.servlet.http.HttpServletRequest;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/custody")
public class CustodyController {
    private static final String COOKIE = "wallet_demo_session";
    private final CustodyService service;
    private final JdbcTemplate db;
    private final String origin;
    private final boolean secure;
    private final PaymentTrafficService traffic;
    private final AppchainStatusService appchain;
    public CustodyController(CustodyService service, JdbcTemplate db,
            PaymentTrafficService traffic, AppchainStatusService appchain,
            @Value("${custody.frontend-origin}") String origin, @Value("${custody.secure-cookie}") boolean secure) {
        this.service=service; this.db=db; this.origin=origin; this.secure=secure;
        this.traffic=traffic; this.appchain=appchain;
    }

    @GetMapping("/capabilities") public ResponseEntity<?> capabilities() { return ok(appchain.capabilities()); }
    @GetMapping("/appchain-metrics") public ResponseEntity<?> metrics(@CookieValue(name=COOKIE,required=false) String token) {
        service.authenticate(token); return ok(appchain.metrics());
    }
    @GetMapping("/traffic") public ResponseEntity<?> trafficHistory(@CookieValue(name=COOKIE,required=false) String token) {
        return ok(traffic.history(service.authenticate(token)));
    }
    @PostMapping("/traffic") public ResponseEntity<?> traffic(@CookieValue(name=COOKIE,required=false) String token,
            @RequestBody PaymentTrafficService.Traffic body,HttpServletRequest request) {
        checkOrigin(request); checkMode(request);
        return ok(traffic.run(service.authenticate(token),body));
    }

    @GetMapping("/health") public ResponseEntity<?> health() {
        db.queryForObject("SELECT 1",Integer.class);
        return ok(Map.of("status","ok","mode","simulation"));
    }
    @GetMapping("/me") public ResponseEntity<?> me(@CookieValue(name=COOKIE,required=false) String token) {
        return ok(service.snapshot(service.authenticate(token)));
    }
    @PostMapping("/register") public ResponseEntity<?> register(@RequestBody Credentials body, HttpServletRequest request) {
        checkOrigin(request);
        if (body.email()!=null && body.email().strip().equalsIgnoreCase(CustodyService.DEMO_EMAIL))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Use the demo account button, or register a different email.");
        return signIn(service.register(body.email(),body.password()),request);
    }
    @PostMapping("/login") public ResponseEntity<?> login(@RequestBody Credentials body, HttpServletRequest request) {
        checkOrigin(request);
        return signIn(service.login(body.email(),body.password()),request);
    }
    @PostMapping("/demo") public ResponseEntity<?> demo(HttpServletRequest request) {
        checkOrigin(request);
        return signIn(service.demo(),request);
    }
    @PostMapping("/logout") public ResponseEntity<?> logout(@CookieValue(name=COOKIE,required=false) String token, HttpServletRequest request) {
        checkOrigin(request); service.logout(token);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header(HttpHeaders.SET_COOKIE,cookie("",Duration.ZERO))
                .body(Map.of("message","Signed out."));
    }
    @PostMapping("/buy") public ResponseEntity<?> buy(@CookieValue(name=COOKIE,required=false) String token,
            @RequestBody Purchase body, HttpServletRequest request) {
        checkOrigin(request); checkMode(request);
        return ok(service.buy(service.authenticate(token),body.requestKey(),body.cardId(),body.fiatAmount()));
    }
    @PostMapping("/send") public ResponseEntity<?> send(@CookieValue(name=COOKIE,required=false) String token,
            @RequestBody Payment body, HttpServletRequest request) {
        checkOrigin(request); checkMode(request);
        return ok(service.send(service.authenticate(token),body.requestKey(),body.recipientAddress(),body.ethAmount()));
    }
    private void checkMode(HttpServletRequest request) {
        String mode=request.getHeader("X-Wallet-Mode");
        if(mode!=null && !mode.equals("test")) throw new ResponseStatusException(HttpStatus.CONFLICT,
            "Normal payments are disabled. Use test mode; no on-chain payment implementation is available yet.");
    }
    private ResponseEntity<?> signIn(UUID user, HttpServletRequest request) {
        // Rotate this browser's old session on login, without invalidating sessions on other devices.
        if (request.getCookies()!=null) for (var cookie:request.getCookies())
            if (COOKIE.equals(cookie.getName())) service.logout(cookie.getValue());
        String token=service.createSession(user);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .header(HttpHeaders.SET_COOKIE,cookie(token,Duration.ofHours(8))).body(service.snapshot(user));
    }
    private String cookie(String token,Duration duration) {
        return ResponseCookie.from(COOKIE,token).httpOnly(true).secure(secure).sameSite("Strict")
                .path("/api/custody").maxAge(duration).build().toString();
    }
    private void checkOrigin(HttpServletRequest request) {
        if (!origin.equals(request.getHeader("Origin"))) throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Use the configured wallet frontend origin.");
    }
    private static ResponseEntity<?> ok(Object body) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body); }
    @ExceptionHandler(ResponseStatusException.class) ResponseEntity<?> error(ResponseStatusException exception) {
        return ResponseEntity.status(exception.getStatusCode()).cacheControl(CacheControl.noStore())
                .body(Map.of("message",exception.getReason()==null ? "Request failed." : exception.getReason()));
    }
    @ExceptionHandler(HttpMessageNotReadableException.class) ResponseEntity<?> invalid() {
        return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).body(Map.of("message","Send valid demo account or payment details."));
    }
    @ExceptionHandler(DataAccessException.class) ResponseEntity<?> databaseError() {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).cacheControl(CacheControl.noStore())
                .body(Map.of("message","Demo database unavailable. Retry with the same request key to avoid duplicate payments."));
    }
    public record Credentials(String email,String password) { @Override public String toString() { return "Credentials[redacted]"; } }
    public record Purchase(UUID requestKey,UUID cardId,String fiatAmount) {}
    public record Payment(UUID requestKey,String recipientAddress,String ethAmount) {}
}
