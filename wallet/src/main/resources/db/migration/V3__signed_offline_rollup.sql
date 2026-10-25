-- Separate test-chain state. Never reinterpret existing custodial ETH as on-chain funds.
CREATE TABLE payment_test_accounts (
    address VARCHAR(42) PRIMARY KEY CHECK (address ~ '^0x[0-9a-f]{40}$'),
    balance NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (balance>=0),
    nonce BIGINT NOT NULL DEFAULT 0 CHECK (nonce>=0)
);
CREATE TABLE payment_wallets (
    user_id UUID PRIMARY KEY REFERENCES custody_users(id),
    address VARCHAR(42) NOT NULL UNIQUE REFERENCES payment_test_accounts(address),
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE payment_wallet_challenges (
    user_id UUID PRIMARY KEY REFERENCES custody_users(id),
    challenge UUID NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE payment_test_head (
    id INTEGER PRIMARY KEY CHECK(id=1),
    number BIGINT NOT NULL,
    hash VARCHAR(66) NOT NULL,
    timestamp BIGINT NOT NULL
);
INSERT INTO payment_test_head VALUES(1,0,'0x0000000000000000000000000000000000000000000000000000000000000000',1700000000);
CREATE TABLE payment_test_purchases (
    user_id UUID NOT NULL REFERENCES custody_users(id),
    request_key UUID NOT NULL,
    journal_id UUID NOT NULL UNIQUE REFERENCES custody_journals(id),
    address VARCHAR(42) NOT NULL REFERENCES payment_test_accounts(address),
    crypto_wei NUMERIC(78,0) NOT NULL,
    fingerprint TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,request_key)
);
CREATE TABLE payment_test_runs (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES custody_users(id),
    request_key UUID NOT NULL,
    fingerprint TEXT NOT NULL,
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id,request_key)
);
CREATE TABLE payment_test_receipts (
    transaction_hash VARCHAR(66) PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES payment_test_runs(id),
    sender VARCHAR(42) NOT NULL,
    recipient VARCHAR(42) NOT NULL,
    receipt JSONB NOT NULL
);
CREATE INDEX payment_receipts_recipient ON payment_test_receipts(recipient);
