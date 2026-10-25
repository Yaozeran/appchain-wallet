CREATE TABLE custody_users (
    id UUID PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    demo_address VARCHAR(42) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- These are synthetic card references, never real PANs, CVCs or bank credentials.
CREATE TABLE custody_cards (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES custody_users(id),
    label TEXT NOT NULL DEFAULT 'Wallet Demo Card',
    last_four VARCHAR(4) NOT NULL DEFAULT '0000',
    expires VARCHAR(7) NOT NULL DEFAULT '12/2035',
    is_fake BOOLEAN NOT NULL DEFAULT TRUE CHECK (is_fake)
);

CREATE TABLE custody_accounts (
    code TEXT PRIMARY KEY,
    user_id UUID REFERENCES custody_users(id),
    asset VARCHAR(3) NOT NULL CHECK (asset IN ('USD', 'ETH')),
    balance NUMERIC(78,0) NOT NULL DEFAULT 0,
    CHECK (user_id IS NULL OR balance >= 0),
    UNIQUE(user_id, asset)
);

INSERT INTO custody_accounts(code, asset) VALUES
    ('system:demo-funding', 'USD'),
    ('system:fiat-settlement', 'USD'),
    ('system:crypto-inventory', 'ETH'),
    ('system:external-payments', 'ETH');

CREATE TABLE custody_journals (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES custody_users(id),
    recipient_user_id UUID REFERENCES custody_users(id),
    kind TEXT NOT NULL CHECK (kind IN ('FUND', 'BUY', 'SEND')),
    request_key UUID NOT NULL,
    fingerprint TEXT NOT NULL,
    fiat_cents NUMERIC(78,0) NOT NULL DEFAULT 0,
    crypto_wei NUMERIC(78,0) NOT NULL DEFAULT 0,
    recipient_address VARCHAR(42),
    status TEXT NOT NULL CHECK (status IN ('DEMO_FUNDED', 'DEMO_CONVERTED', 'INTERNAL_COMPLETED', 'EXTERNAL_SIMULATED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, request_key)
);

CREATE TABLE custody_entries (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    journal_id UUID NOT NULL REFERENCES custody_journals(id),
    account_code TEXT NOT NULL REFERENCES custody_accounts(code),
    delta NUMERIC(78,0) NOT NULL CHECK (delta <> 0)
);
CREATE INDEX custody_history_sender ON custody_journals(user_id, created_at DESC);
CREATE INDEX custody_history_recipient ON custody_journals(recipient_user_id, created_at DESC);

CREATE TABLE custody_sessions (
    token_hash VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES custody_users(id),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX custody_session_expiry ON custody_sessions(expires_at);

-- A committed journal must balance independently for every asset.
CREATE FUNCTION custody_check_journal() RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM custody_entries WHERE journal_id=NEW.id) OR EXISTS (
        SELECT a.asset FROM custody_entries e JOIN custody_accounts a ON a.code=e.account_code
        WHERE e.journal_id=NEW.id GROUP BY a.asset HAVING sum(e.delta) <> 0
    ) THEN
        RAISE EXCEPTION 'Unbalanced custody journal';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER custody_balanced_journal
AFTER INSERT ON custody_journals DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION custody_check_journal();
