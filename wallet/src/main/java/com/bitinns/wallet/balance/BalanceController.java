package com.bitinns.wallet.balance;

import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/balances")
public class BalanceController {
    private final BalanceService service;
    public BalanceController(BalanceService service) { this.service = service; }
    @GetMapping public ResponseEntity<BalanceService.Balance> balance(@RequestParam String chain,
            @RequestParam String address, @RequestParam(defaultValue="native") String asset) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.read(chain, address, asset));
    }
    @ExceptionHandler(ResponseStatusException.class) ResponseEntity<Map<String,String>> error(ResponseStatusException exception) {
        return ResponseEntity.status(exception.getStatusCode()).cacheControl(CacheControl.noStore()).body(Map.of("message", exception.getReason() == null ? "Balance unavailable." : exception.getReason()));
    }
}
