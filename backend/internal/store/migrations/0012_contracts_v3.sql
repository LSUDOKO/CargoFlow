-- Contracts v3: parametric cover (a TRIGGERED status and the trigger terms), facility cancellation, and the device
-- key hashes recorded per epoch.
ALTER TABLE covers DROP CONSTRAINT IF EXISTS covers_status_check;
ALTER TABLE covers ADD CONSTRAINT covers_status_check CHECK (status IN ('ACTIVE', 'RELEASED', 'CLAIMED', 'TRIGGERED'));
-- {consecutiveFailedEpochs, salvageToExporter, epochFloor, exporterSalvage}; NULL for a plain default cover
ALTER TABLE covers ADD COLUMN parametric JSONB;
ALTER TABLE cover_offers ADD COLUMN parametric JSONB;

-- the device key hashes recorded on chain for an epoch (recordEpochSources), and the transaction
ALTER TABLE telemetry_epochs ADD COLUMN sources_tx_hash TEXT;
