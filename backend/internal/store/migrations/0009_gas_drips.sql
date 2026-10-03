-- Native currency the gas drip sent, so the per-address and daily limits survive restarts.
CREATE TABLE gas_drips (
    id         BIGSERIAL PRIMARY KEY,
    address    TEXT NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
    tx_hash    TEXT NOT NULL,
    amount_wei NUMERIC(78,0) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX gas_drips_by_address ON gas_drips (address, created_at);
CREATE INDEX gas_drips_by_time ON gas_drips (created_at);
