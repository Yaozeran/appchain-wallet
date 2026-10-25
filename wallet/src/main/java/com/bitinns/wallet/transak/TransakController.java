package com.bitinns.wallet.transak;

import com.bitinns.wallet.moonpay.ClientIpResolver;
import jakarta.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.util.Map;
import java.util.Set;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/transak")
public class TransakController {
    private final TransakService service;
    private final TransakProperties properties;
    public TransakController(TransakService service, TransakProperties properties) { this.service = service; this.properties = properties; }
    @GetMapping("/config") public ResponseEntity<TransakService.Config> config() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.configuration());
    }
    @PostMapping("/checkout") public ResponseEntity<TransakService.Checkout> checkout(@RequestBody Request body, HttpServletRequest request) {
        if (!service.origin().equals(request.getHeader("Origin"))) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Checkout must originate from the configured frontend.");
        String ip = null;
        Set<String> trusted = properties.trustedProxies() == null ? Set.of() : properties.trustedProxies();
        if (trusted.contains(request.getRemoteAddr())) ip = ClientIpResolver.canonicalPublicIp(request.getHeader("True-Client-IP"));
        if (ip == null && !service.production()) ip = ClientIpResolver.canonicalPublicIp(properties.sandboxClientIp());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.checkout(body.walletAddress(), body.fiatCurrency(), body.fiatAmount(), body.asset(), ip));
    }
    @ExceptionHandler(ResponseStatusException.class) ResponseEntity<Map<String,String>> error(ResponseStatusException exception) {
        return ResponseEntity.status(exception.getStatusCode()).cacheControl(CacheControl.noStore()).body(Map.of("message", exception.getReason() == null ? "Checkout failed." : exception.getReason()));
    }
    @ExceptionHandler(HttpMessageNotReadableException.class) ResponseEntity<Map<String,String>> invalid() {
        return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).body(Map.of("message", "Send valid checkout details as JSON."));
    }
    public record Request(String walletAddress, String fiatCurrency, BigDecimal fiatAmount, String asset) {}
}
