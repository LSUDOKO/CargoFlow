-- Evidence sources an exporter registers for one shipment. A bound source may only submit telemetry to that
-- shipment; sources registered by an operator stay unbound.
ALTER TABLE evidence_sources
    ADD COLUMN shipment_id TEXT REFERENCES shipments (shipment_id) ON DELETE CASCADE,
    ADD COLUMN label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 80);
CREATE INDEX evidence_sources_by_shipment ON evidence_sources (shipment_id) WHERE shipment_id IS NOT NULL;
