package com.bitinns.wallet.payment;

import com.bitinns.wallet.custody.CustodyService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/custody/wallet")
public class PaymentWalletController {
    private final CustodyService auth;
    private final PaymentWalletService service;
    private final String origin;
    public PaymentWalletController(CustodyService auth,PaymentWalletService service,@Value("${custody.frontend-origin}") String origin){this.auth=auth;this.service=service;this.origin=origin;}
    private java.util.UUID user(String token){return auth.authenticate(token);}
    private void write(HttpServletRequest request){
        if(!origin.equals(request.getHeader("Origin")))throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Use the configured frontend origin.");
        if(!"test".equals(request.getHeader("X-Wallet-Mode")))throw new ResponseStatusException(HttpStatus.CONFLICT,"Normal mode is disabled. Choose test mode explicitly.");
    }
    private ResponseEntity<?> ok(Object body){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);}
    @GetMapping("/me") public ResponseEntity<?> me(@CookieValue(name="wallet_demo_session",required=false) String token){return ok(service.snapshot(user(token)));}
    @PostMapping("/challenge") public ResponseEntity<?> challenge(@CookieValue(name="wallet_demo_session",required=false) String token,HttpServletRequest request){write(request);return ok(service.challenge(user(token)));}
    public record Binding(String address,String signature){@Override public String toString(){return "Binding[ownership proof redacted]";}}
    @PostMapping("/bind") public ResponseEntity<?> bind(@CookieValue(name="wallet_demo_session",required=false) String token,@RequestBody Binding body,HttpServletRequest request){write(request);return ok(service.bind(user(token),body.address(),body.signature()));}
    @PostMapping("/buy") public ResponseEntity<?> buy(@CookieValue(name="wallet_demo_session",required=false) String token,@RequestBody PaymentWalletService.Purchase body,HttpServletRequest request){write(request);return ok(service.buy(user(token),body));}
    @PostMapping("/send") public ResponseEntity<?> send(@CookieValue(name="wallet_demo_session",required=false) String token,@RequestBody PaymentWalletService.Payment body,HttpServletRequest request){write(request);return ok(service.send(user(token),body));}
    @GetMapping("/history") public ResponseEntity<?> history(@CookieValue(name="wallet_demo_session",required=false) String token){return ok(service.history(user(token)));}
    @ExceptionHandler(ResponseStatusException.class) public ResponseEntity<?> error(ResponseStatusException error){return ResponseEntity.status(error.getStatusCode()).cacheControl(CacheControl.noStore()).body(Map.of("message",error.getReason()==null?"Request failed.":error.getReason()));}
    @ExceptionHandler(HttpMessageNotReadableException.class) public ResponseEntity<?> invalid(){return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).body(Map.of("message","Provide valid wallet/payment details. Never send a recovery phrase or private key."));}
    @ExceptionHandler(DataAccessException.class) public ResponseEntity<?> databaseError(){return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).cacheControl(CacheControl.noStore()).body(Map.of("message","Payment state unavailable. Retry the exact pending request to avoid a duplicate debit."));}
}
