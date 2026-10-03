-- The financing marketplace. A request is an exporter asking for capital against a registered, policy-set shipment
-- that has no facility yet; financiers offer a fee; the exporter accepts one and creates the facility on chain naming
-- that financier, and the indexer marks the request funded once the facility is funded. Nothing here moves money.
CREATE TABLE financing_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id     TEXT NOT NULL REFERENCES shipments (shipment_id) ON DELETE CASCADE,
    exporter        TEXT NOT NULL CHECK (exporter ~ '^0x[0-9a-f]{40}$'),
    amount          NUMERIC(38,0) NOT NULL CHECK (amount > 0), -- USDG base units
    max_fee_bps     INT NOT NULL CHECK (max_fee_bps BETWEEN 0 AND 10000),
    milestone_count INT NOT NULL CHECK (milestone_count BETWEEN 1 AND 16),
    note            TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'funded', 'closed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- at most one live request per shipment
CREATE UNIQUE INDEX financing_requests_live ON financing_requests (shipment_id) WHERE status IN ('open', 'accepted');
CREATE INDEX financing_requests_by_status ON financing_requests (status, created_at);

CREATE TABLE financing_offers (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES financing_requests (id) ON DELETE CASCADE,
    financier  TEXT NOT NULL CHECK (financier ~ '^0x[0-9a-f]{40}$'),
    fee_bps    INT NOT NULL CHECK (fee_bps BETWEEN 0 AND 10000),
    accepted   BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (request_id, financier)
);
