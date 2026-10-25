package com.bitinns.wallet.custody;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class PasswordHashTests {
    @Test void saltsHashesAndRejectsWrongPasswordsAndMalformedHashes() {
        String first = PasswordHash.hash("test-password-123"), second = PasswordHash.hash("test-password-123");
        assertThat(first).isNotEqualTo(second).doesNotContain("test-password-123");
        assertThat(PasswordHash.matches("test-password-123",first)).isTrue();
        assertThat(PasswordHash.matches("wrong-password",first)).isFalse();
        assertThat(PasswordHash.matches("test-password-123","broken")).isFalse();
    }
    @Test void credentialsNeverAppearInRecordToString() {
        assertThat(new CustodyController.Credentials("someone@wallet.test","private-password").toString())
                .doesNotContain("private-password", "someone@wallet.test");
    }
}
