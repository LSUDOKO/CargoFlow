-- The vessel carrying a shipment, named by its exporter, and the AIS positions seen for watched vessels.
CREATE TABLE shipment_vessels (
    shipment_id   TEXT PRIMARY KEY REFERENCES shipments (shipment_id) ON DELETE CASCADE,
    mmsi          TEXT NOT NULL CHECK (mmsi ~ '^[0-9]{9}$'),
    name          TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 120),
    registered_by TEXT NOT NULL CHECK (registered_by ~ '^0x[0-9a-f]{40}$'),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shipment_vessels_by_mmsi ON shipment_vessels (mmsi);

CREATE TABLE vessel_positions (
    mmsi          TEXT NOT NULL,
    ts            BIGINT NOT NULL,
    lat_e6        INT NOT NULL,
    lon_e6        INT NOT NULL,
    sog_knots_x10 INT NOT NULL,
    cog_deg_x10   INT NOT NULL,
    PRIMARY KEY (mmsi, ts)
);
