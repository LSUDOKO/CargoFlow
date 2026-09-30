-- CargoFlow operational store. The chain is the financial source of truth: nothing here is used to
-- decide a balance. Hex values (addresses, hashes) are stored lowercase with a 0x prefix.

CREATE TABLE evidence_sources (
    source_id       TEXT PRIMARY KEY CHECK (source_id <> ''),
    public_key      BYTEA NOT NULL CHECK (octet_length(public_key) = 32), -- Ed25519; no shared secret is stored
    sensor_ids      TEXT[] NOT NULL CHECK (cardinality(sensor_ids) > 0),
    reliability_bps INT NOT NULL DEFAULT 9500 CHECK (reliability_bps BETWEEN 0 AND 10000),
    disabled        BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shipments (
    shipment_id           TEXT PRIMARY KEY CHECK (shipment_id ~ '^0x[0-9a-f]{64}$'),
    external_ref          TEXT NOT NULL,
    exporter              TEXT NOT NULL CHECK (exporter ~ '^0x[0-9a-f]{40}$'),
    buyer                 TEXT NOT NULL CHECK (buyer ~ '^0x[0-9a-f]{40}$'),
    financier             TEXT CHECK (financier ~ '^0x[0-9a-f]{40}$'),
    invoice_hash          TEXT NOT NULL CHECK (invoice_hash ~ '^0x[0-9a-f]{64}$'),
    route_commitment      TEXT NOT NULL CHECK (route_commitment ~ '^0x[0-9a-f]{64}$'),
    policy_commitment     TEXT NOT NULL CHECK (policy_commitment ~ '^0x[0-9a-f]{64}$'),
    invoice_value         NUMERIC(38,0) NOT NULL CHECK (invoice_value > 0), -- USDG base units
    -- mirror of the policy; the chain holds the authoritative copy
    min_temp_x100         INT NOT NULL,
    max_temp_x100         INT NOT NULL,
    max_gap_sec           INT NOT NULL,
    max_route_deviation_m INT NOT NULL,
    min_evidence_score    INT NOT NULL CHECK (min_evidence_score BETWEEN 0 AND 100),
    max_conflict_bps      INT NOT NULL CHECK (max_conflict_bps BETWEEN 0 AND 10000),
    max_risk_bps          INT NOT NULL CHECK (max_risk_bps BETWEEN 0 AND 10000),
    requires_zk           BOOLEAN NOT NULL DEFAULT false,
    min_sensors           INT NOT NULL DEFAULT 2 CHECK (min_sensors >= 1),
    route                 JSONB NOT NULL DEFAULT '[]'::jsonb,
    status                TEXT NOT NULL DEFAULT 'REGISTERED',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (exporter, external_ref)
);

CREATE TABLE financing_milestones (
    shipment_id           TEXT NOT NULL REFERENCES shipments (shipment_id) ON DELETE CASCADE,
    milestone_index       INT NOT NULL CHECK (milestone_index >= 0),
    description           TEXT NOT NULL DEFAULT '',
    allocated_usdg        NUMERIC(38,0) NOT NULL CHECK (allocated_usdg > 0),
    evidence_threshold    INT NOT NULL CHECK (evidence_threshold BETWEEN 0 AND 100),
    checkpoint_commitment TEXT NOT NULL,
    is_released           BOOLEAN NOT NULL DEFAULT false,
    release_tx_hash       TEXT,
    released_at           TIMESTAMPTZ,
    PRIMARY KEY (shipment_id, milestone_index)
);

-- Raw readings stay off-chain. The primary key makes ingestion idempotent and survives restarts,
-- so replay detection does not depend on process memory.
CREATE TABLE telemetry_points (
    shipment_id      TEXT NOT NULL REFERENCES shipments (shipment_id) ON DELETE CASCADE,
    sensor_id        TEXT NOT NULL,
    ts               BIGINT NOT NULL CHECK (ts > 0),
    temperature_x100 INT NOT NULL,
    humidity_x100    INT NOT NULL,
    latitude_e6      INT NOT NULL,
    longitude_e6     INT NOT NULL,
    shock_x100       INT NOT NULL,
    source_id        TEXT REFERENCES evidence_sources (source_id),
    received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (shipment_id, sensor_id, ts)
);
CREATE INDEX telemetry_points_by_time ON telemetry_points (shipment_id, ts);

CREATE TABLE quarantined_readings (
    id          BIGSERIAL PRIMARY KEY,
    shipment_id TEXT NOT NULL REFERENCES shipments (shipment_id) ON DELETE CASCADE,
    sensor_id   TEXT NOT NULL,
    ts          BIGINT NOT NULL,
    reason      TEXT NOT NULL,
    payload     JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX quarantined_by_shipment ON quarantined_readings (shipment_id, created_at);

CREATE TABLE telemetry_epochs (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id        TEXT NOT NULL REFERENCES shipments (shipment_id) ON DELETE CASCADE,
    milestone_index    INT NOT NULL,
    sequence           INT NOT NULL CHECK (sequence >= 0), -- the on-chain epoch seq for this milestone
    epoch_id           TEXT NOT NULL CHECK (epoch_id ~ '^0x[0-9a-f]{64}$'),
    merkle_root        TEXT NOT NULL CHECK (merkle_root ~ '^0x[0-9a-f]{64}$'),
    reading_count      INT NOT NULL,
    start_time         BIGINT NOT NULL,
    end_time           BIGINT NOT NULL,
    score              INT NOT NULL CHECK (score BETWEEN 0 AND 100),
    conflict_bps       INT NOT NULL CHECK (conflict_bps BETWEEN 0 AND 10000),
    risk_bps           INT NOT NULL CHECK (risk_bps BETWEEN 0 AND 10000),
    compliant          BOOLEAN NOT NULL,
    penalties          JSONB NOT NULL DEFAULT '{}'::jsonb,
    decision_pass      BOOLEAN NOT NULL,
    decision_action    TEXT NOT NULL,
    decision_reasons   TEXT[] NOT NULL DEFAULT '{}',
    points             JSONB NOT NULL, -- the committed readings in leaf order; private witness source
    commit_tx_hash     TEXT,
    proof_verified     BOOLEAN NOT NULL DEFAULT false,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (shipment_id, milestone_index, sequence),
    UNIQUE (epoch_id)
);
CREATE INDEX telemetry_epochs_by_shipment ON telemetry_epochs (shipment_id, created_at);

CREATE TABLE ai_monitoring_events (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id              TEXT NOT NULL REFERENCES shipments (shipment_id) ON DELETE CASCADE,
    epoch_id                 TEXT,
    severity                 TEXT NOT NULL,
    action_type              TEXT NOT NULL,
    reason_code              TEXT NOT NULL,
    model_inference_data     JSONB NOT NULL DEFAULT '{}'::jsonb,
    onchain_action_triggered BOOLEAN NOT NULL DEFAULT false,
    tx_hash                  TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_events_by_shipment ON ai_monitoring_events (shipment_id, created_at);

-- Every on-chain log we have seen. (tx_hash, log_index) is the idempotency key.
CREATE TABLE chain_events (
    tx_hash      TEXT NOT NULL,
    log_index    INT NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash   TEXT NOT NULL,
    contract     TEXT NOT NULL,
    event_name   TEXT NOT NULL,
    shipment_id  TEXT,
    args         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX chain_events_by_shipment ON chain_events (shipment_id, block_number, log_index);
CREATE INDEX chain_events_by_block ON chain_events (block_number);

CREATE TABLE sync_state (
    name       TEXT PRIMARY KEY,
    last_block BIGINT NOT NULL CHECK (last_block >= 0),
    block_hash TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Outbox for transactions we send. `key` makes every action idempotent across restarts and retries.
CREATE TABLE chain_actions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id TEXT NOT NULL REFERENCES shipments (shipment_id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    key         TEXT NOT NULL UNIQUE,
    status      TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'CONFIRMED', 'FAILED')),
    tx_hash     TEXT,
    error       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chain_actions_by_shipment ON chain_actions (shipment_id, created_at);
