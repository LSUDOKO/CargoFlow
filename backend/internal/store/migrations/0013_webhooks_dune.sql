-- Alchemy webhook deliveries seen recently (replay protection by the payload id), kept 24 hours.
CREATE TABLE webhook_deliveries (
    provider    TEXT NOT NULL,
    delivery_id TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, delivery_id)
);
CREATE INDEX webhook_deliveries_by_time ON webhook_deliveries (received_at);

-- Dune upload state per table: whether the table was created, and for the append-only event table the
-- (block, log index, tx) of the last row Dune accepted.
CREATE TABLE dune_uploads (
    table_name       TEXT PRIMARY KEY,
    created          BOOLEAN NOT NULL DEFAULT false,
    cursor_block     BIGINT NOT NULL DEFAULT -1,
    cursor_log_index INT NOT NULL DEFAULT -1,
    cursor_tx        TEXT NOT NULL DEFAULT '',
    rows_pushed      BIGINT NOT NULL DEFAULT 0,
    last_pushed_at   TIMESTAMPTZ
);

-- The block timestamp of each indexed event (filled by the indexer; NULL for rows indexed before this column
-- existed, which the Dune uploader backfills from the block header).
ALTER TABLE chain_events ADD COLUMN block_time TIMESTAMPTZ;

-- User operations CargoFlow agreed to sponsor through ZeroDev's gas policy webhook (rate limits count these).
CREATE TABLE sponsorships (
    id         BIGSERIAL PRIMARY KEY,
    sender     TEXT NOT NULL,
    nonce      TEXT NOT NULL,
    max_cost   NUMERIC(78,0) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sponsorships_by_sender ON sponsorships (sender, created_at);
CREATE INDEX sponsorships_by_time ON sponsorships (created_at);
