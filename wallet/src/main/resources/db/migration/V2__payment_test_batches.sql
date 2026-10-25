-- Application benchmark artifacts, not OP Stack batches or L1 receipts.
CREATE TABLE custody_test_batches (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES custody_users(id),
    request_key UUID NOT NULL,
    fingerprint TEXT NOT NULL,
    payment_count INTEGER NOT NULL CHECK (payment_count BETWEEN 1 AND 200),
    processing_ms DOUBLE PRECISION NOT NULL,
    raw_bytes INTEGER NOT NULL,
    compressed_payload BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id,request_key)
);
CREATE TABLE custody_test_batch_payments (
    batch_id UUID NOT NULL REFERENCES custody_test_batches(id),
    journal_id UUID NOT NULL UNIQUE REFERENCES custody_journals(id),
    PRIMARY KEY(batch_id,journal_id)
);
