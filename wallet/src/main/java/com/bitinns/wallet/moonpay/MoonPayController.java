package com.bitinns.wallet.moonpay;

import jakarta.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/moonpay")
public class MoonPayController {
    private final MoonPayService service;
    private final ClientIpResolver clientIpResolver;

    public MoonPayController(MoonPayService service, ClientIpResolver clientIpResolver) {
        this.service = service;
        this.clientIpResolver = clientIpResolver;
    }

    @GetMapping("/config")
    public ResponseEntity<MoonPayService.Config> configuration() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.configuration());
    }

    @PostMapping("/checkout")
    public ResponseEntity<MoonPayService.Checkout> checkout(@RequestBody CheckoutRequest body,
                                                           HttpServletRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.checkout(
                body.walletAddress(), body.fiatCurrency(), body.fiatAmount(), clientIpResolver.resolve(request)));
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> checkoutError(ResponseStatusException exception) {
        return ResponseEntity.status(exception.getStatusCode()).cacheControl(CacheControl.noStore())
                .body(Map.of("message", exception.getReason() == null ? "Checkout is unavailable." : exception.getReason()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, String>> invalidBody() {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).cacheControl(CacheControl.noStore())
                .body(Map.of("message", "Send a wallet address, fiat currency, and numeric fiat amount."));
    }

    public record CheckoutRequest(String walletAddress, String fiatCurrency, BigDecimal fiatAmount) {}
}
