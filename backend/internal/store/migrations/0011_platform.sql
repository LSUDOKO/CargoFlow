-- Platform: hardware-rooted device trust, in-app notifications, Slack alerts and the automatic ZK recovery cache.

-- Device trust. A source's key may be Ed25519 (32 bytes), ECDSA P-256 (65-byte uncompressed SEC1 point, from a secure
-- element or a software key) or a WebAuthn passkey (its P-256 credential key, same encoding). device_class records how
-- much the key's custody was proven: software, passkey (a platform authenticator's key that never leaves the device),
-- or secure_element (an X.509 chain from a manufacturer root vouches for the key).
ALTER TABLE evidence_sources DROP CONSTRAINT IF EXISTS evidence_sources_public_key_check;
ALTER TABLE evidence_sources
    ADD CONSTRAINT evidence_sources_public_key_size CHECK (octet_length(public_key) IN (32, 65)),
    ADD COLUMN key_type TEXT NOT NULL DEFAULT 'ed25519' CHECK (key_type IN ('ed25519', 'p256', 'webauthn')),
    ADD COLUMN device_class TEXT NOT NULL DEFAULT 'software' CHECK (device_class IN ('software', 'passkey', 'secure_element')),
    ADD COLUMN key_hash TEXT, -- 0x + keccak256(public_key)
    ADD COLUMN attestation JSONB NOT NULL DEFAULT '{}'::jsonb, -- what was verified: format, chain subjects, aaguid, rp id hash
    ADD COLUMN webauthn_credential_id BYTEA,
    ADD COLUMN webauthn_rp_id_hash BYTEA,
    ADD COLUMN webauthn_sign_count BIGINT NOT NULL DEFAULT 0;
CREATE INDEX evidence_sources_by_key_hash ON evidence_sources (key_hash) WHERE key_hash IS NOT NULL;

-- In-app notifications, per wallet. dedupe_key makes creation idempotent (a redelivered chain event, a worker that
-- rescans) per recipient.
CREATE TABLE notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    address     TEXT NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
    shipment_id TEXT REFERENCES shipments (shipment_id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    title       TEXT NOT NULL CHECK (length(title) <= 200),
    body        TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 1000),
    link        TEXT NOT NULL DEFAULT '' CHECK (length(link) <= 500),
    data        JSONB NOT NULL DEFAULT '{}'::jsonb,
    dedupe_key  TEXT NOT NULL,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (address, dedupe_key)
);
CREATE INDEX notifications_by_address ON notifications (address, created_at DESC);

-- Slack incoming webhooks join the alert channels.
ALTER TABLE alert_subscriptions DROP CONSTRAINT IF EXISTS alert_subscriptions_channel_check;
ALTER TABLE alert_subscriptions ADD CONSTRAINT alert_subscriptions_channel_check
    CHECK (channel IN ('webhook', 'telegram', 'email', 'slack'));

-- Pre-built recovery proofs. The worker proves a paused facility's recovery for the exporter without touching the
-- chain; the exporter's signed request then only commits the evidence. A proof is valid for one pause (paused_at), one
-- set of readings (readings_root), one epoch id and one submitter.
CREATE TABLE recovery_proofs (
    shipment_id   TEXT NOT NULL REFERENCES shipments (shipment_id) ON DELETE CASCADE,
    sensor_id     TEXT NOT NULL,
    readings_root TEXT NOT NULL CHECK (readings_root ~ '^0x[0-9a-f]{64}$'),
    paused_at     BIGINT NOT NULL,
    epoch_id      TEXT NOT NULL CHECK (epoch_id ~ '^0x[0-9a-f]{64}$'),
    milestone     INT NOT NULL,
    sequence      INT NOT NULL,
    submitter     TEXT NOT NULL CHECK (submitter ~ '^0x[0-9a-f]{40}$'),
    score         INT NOT NULL,
    proof         JSONB NOT NULL, -- {a, b, c} as hex words
    used_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (shipment_id, sensor_id, readings_root, paused_at)
);
