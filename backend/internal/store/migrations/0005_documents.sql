-- Documents a shipment party attested by hash. The files themselves are never uploaded: only their SHA-256 (what a
-- person can check with any tool) and keccak256 (what the chain's invoiceHash commits to) are recorded, with who
-- signed the attestation in which role.
CREATE TABLE shipment_documents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id TEXT NOT NULL REFERENCES shipments (shipment_id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('invoice', 'bill_of_lading', 'packing_list', 'certificate', 'other')),
    name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    size_bytes  BIGINT NOT NULL CHECK (size_bytes >= 0),
    sha256      TEXT NOT NULL CHECK (sha256 ~ '^0x[0-9a-f]{64}$'),
    keccak256   TEXT NOT NULL CHECK (keccak256 ~ '^0x[0-9a-f]{64}$'),
    signer      TEXT NOT NULL CHECK (signer ~ '^0x[0-9a-f]{40}$'),
    role        TEXT NOT NULL CHECK (role IN ('exporter', 'financier', 'buyer')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (shipment_id, sha256, signer)
);
CREATE INDEX shipment_documents_by_shipment ON shipment_documents (shipment_id, created_at);
