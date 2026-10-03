-- Contracts v2: humidity and shock limits in the policy, place-based milestones, per-epoch telemetry
-- aggregates, and default cover. Every new column defaults to the v1 meaning (0 = no limit / no place), so
-- rows written before v2 read back unchanged.

ALTER TABLE shipments
    ADD COLUMN max_humidity_x100 INT NOT NULL DEFAULT 0 CHECK (max_humidity_x100 BETWEEN 0 AND 10000),
    ADD COLUMN max_shock_x100    INT NOT NULL DEFAULT 0 CHECK (max_shock_x100 BETWEEN 0 AND 65535),
    -- display names of milestone places, by milestone index, as posted by the frontend ('' = unnamed)
    ADD COLUMN place_labels      JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(place_labels) = 'array');

ALTER TABLE financing_milestones
    ADD COLUMN lat_e6   INT NOT NULL DEFAULT 0 CHECK (lat_e6 BETWEEN -90000000 AND 90000000),
    ADD COLUMN lon_e6   INT NOT NULL DEFAULT 0 CHECK (lon_e6 BETWEEN -180000000 AND 180000000),
    ADD COLUMN radius_m BIGINT NOT NULL DEFAULT 0 CHECK (radius_m = 0 OR radius_m BETWEEN 1000 AND 1000000);

ALTER TABLE telemetry_epochs
    ADD COLUMN lat_e6            INT NOT NULL DEFAULT 0,
    ADD COLUMN lon_e6            INT NOT NULL DEFAULT 0,
    ADD COLUMN max_humidity_x100 INT NOT NULL DEFAULT 0,
    ADD COLUMN max_shock_x100    INT NOT NULL DEFAULT 0,
    -- set when the evidence passed but its centroid was outside the milestone's place (metres away)
    ADD COLUMN held_distance_m   BIGINT;

-- Default cover, rebuilt from the indexed CoverPool events of a shipment (chain_events is the source).
CREATE TABLE cover_offers (
    shipment_id TEXT NOT NULL REFERENCES shipments (shipment_id) ON DELETE CASCADE,
    insurer     TEXT NOT NULL CHECK (insurer ~ '^0x[0-9a-f]{40}$'),
    amount      NUMERIC(38,0) NOT NULL,
    premium_bps INT NOT NULL CHECK (premium_bps BETWEEN 0 AND 10000),
    status      TEXT NOT NULL CHECK (status IN ('OPEN', 'WITHDRAWN', 'ACCEPTED')),
    tx_hash     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (shipment_id, insurer)
);
CREATE INDEX cover_offers_by_insurer ON cover_offers (insurer);

CREATE TABLE covers (
    shipment_id      TEXT PRIMARY KEY REFERENCES shipments (shipment_id) ON DELETE CASCADE,
    insurer          TEXT NOT NULL CHECK (insurer ~ '^0x[0-9a-f]{40}$'),
    financier        TEXT NOT NULL CHECK (financier ~ '^0x[0-9a-f]{40}$'),
    amount           NUMERIC(38,0) NOT NULL,
    premium          NUMERIC(38,0) NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED', 'CLAIMED')),
    financier_payout NUMERIC(38,0) NOT NULL DEFAULT 0,
    insurer_return   NUMERIC(38,0) NOT NULL DEFAULT 0,
    loss             NUMERIC(38,0) NOT NULL DEFAULT 0,
    accepted_tx      TEXT NOT NULL,
    accepted_at      TIMESTAMPTZ NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX covers_by_insurer ON covers (insurer);
