-- CargoFlow on Dune: 2. Anomalies, pause rate and zero-knowledge recoveries
--
-- Four Dune queries, one per block:
--   2a  decoded  per facility: epochs committed, pass/fail, pauses, ZK recoveries, time to recovery
--   2b  decoded  per route (route commitment): the same, aggregated
--   2c  uploaded per facility, with the off-chain decision and the readable route label
--   2d  uploaded per route label
--
-- Definitions:
--   epoch pass       EvidenceRegistry.EvidenceEpochCommitted.compliant = true (the on-chain compliance flag)
--   pause            FinancingController.FinancingPaused (monitor/AI or arbiter)
--   recovery         the first FinancingResumed after a pause on the same facility
--   ZK recovery      a recovery whose transaction also emitted EvidenceRegistry.EvidenceProofVerified for the
--                    epoch named in FinancingResumed.basis (resumeWithProof sets basis = the recovery epoch id;
--                    resumeByVerifier sets basis = an attestation hash and emits no proof event)
--   time to recovery seconds from the pause to that resume, reported in hours
--   pause rate       pauses per 100 committed epochs
-- Pause reason codes are keccak hashes of the decision reasons, so they are not decoded here; the uploaded
-- epochs table carries the readable reasons.
-- On chain a route is only its commitment (a hash); the uploaded shipments table carries a readable label.


-- ===================================================================================== 2a (decoded)
WITH epochs AS (
    SELECT
        shipmentId AS shipment_id,
        COUNT(*) AS epochs,
        COUNT(*) FILTER (WHERE compliant) AS passed,
        COUNT(*) FILTER (WHERE NOT compliant) AS failed,
        AVG(CAST(score AS DOUBLE)) AS avg_score
    FROM cargoflow_robinhood.EvidenceRegistry_evt_EvidenceEpochCommitted
    GROUP BY 1
),
pr AS (
    SELECT shipmentId AS shipment_id, evt_block_time AS ts, evt_block_number AS bn, evt_index AS ix,
        evt_tx_hash AS tx, 'pause' AS kind, CAST(NULL AS VARBINARY) AS basis
    FROM cargoflow_robinhood.FinancingController_evt_FinancingPaused
    UNION ALL
    SELECT shipmentId, evt_block_time, evt_block_number, evt_index, evt_tx_hash, 'resume', basis
    FROM cargoflow_robinhood.FinancingController_evt_FinancingResumed
),
seq AS (
    SELECT
        pr.*,
        LEAD(kind) OVER (PARTITION BY shipment_id ORDER BY bn, ix) AS next_kind,
        LEAD(ts) OVER (PARTITION BY shipment_id ORDER BY bn, ix) AS next_ts,
        LEAD(tx) OVER (PARTITION BY shipment_id ORDER BY bn, ix) AS next_tx,
        LEAD(basis) OVER (PARTITION BY shipment_id ORDER BY bn, ix) AS next_basis
    FROM pr
),
proofs AS (
    SELECT evt_tx_hash AS tx, epochId AS epoch_id
    FROM cargoflow_robinhood.EvidenceRegistry_evt_EvidenceProofVerified
),
recoveries AS (
    SELECT
        s.shipment_id,
        date_diff('second', s.ts, s.next_ts) / 3600.0 AS hours_to_recover,
        p.tx IS NOT NULL AS via_zk
    FROM seq AS s
    LEFT JOIN proofs AS p ON p.tx = s.next_tx AND p.epoch_id = s.next_basis
    WHERE s.kind = 'pause' AND s.next_kind = 'resume'
),
pauses AS (
    SELECT shipment_id, COUNT(*) AS pauses, MAX(ts) AS last_paused_at
    FROM pr WHERE kind = 'pause' GROUP BY 1
),
rec AS (
    SELECT
        shipment_id,
        COUNT(*) AS recoveries,
        COUNT(*) FILTER (WHERE via_zk) AS zk_recoveries,
        AVG(hours_to_recover) AS avg_hours_to_recover,
        AVG(hours_to_recover) FILTER (WHERE via_zk) AS avg_hours_to_zk_recover,
        MAX(hours_to_recover) AS max_hours_to_recover
    FROM recoveries GROUP BY 1
),
facilities AS (
    SELECT f.shipmentId AS shipment_id, f.financier, f.exporter, s.routeCommitment AS route_commitment
    FROM cargoflow_robinhood.FinancingController_evt_FacilityCreated AS f
    LEFT JOIN cargoflow_robinhood.ShipmentRegistry_evt_ShipmentRegistered AS s
        ON s.shipmentId = f.shipmentId
)
SELECT
    f.shipment_id,
    f.route_commitment,
    f.financier,
    COALESCE(e.epochs, 0) AS epochs,
    COALESCE(e.passed, 0) AS epochs_passed,
    COALESCE(e.failed, 0) AS epochs_failed,
    CAST(e.passed AS DOUBLE) / NULLIF(e.epochs, 0) AS pass_rate,
    e.avg_score,
    COALESCE(p.pauses, 0) AS pauses,
    100.0 * COALESCE(p.pauses, 0) / NULLIF(e.epochs, 0) AS pauses_per_100_epochs,
    COALESCE(r.recoveries, 0) AS recoveries,
    COALESCE(r.zk_recoveries, 0) AS zk_recoveries,
    r.avg_hours_to_recover,
    r.avg_hours_to_zk_recover,
    r.max_hours_to_recover,
    p.last_paused_at
FROM facilities AS f
LEFT JOIN epochs AS e ON e.shipment_id = f.shipment_id
LEFT JOIN pauses AS p ON p.shipment_id = f.shipment_id
LEFT JOIN rec AS r ON r.shipment_id = f.shipment_id
ORDER BY pauses DESC, epochs DESC;


-- ===================================================================================== 2b (decoded)
WITH routes AS (
    SELECT shipmentId AS shipment_id, routeCommitment AS route_commitment
    FROM cargoflow_robinhood.ShipmentRegistry_evt_ShipmentRegistered
),
epochs AS (
    SELECT
        shipmentId AS shipment_id,
        COUNT(*) AS epochs,
        COUNT(*) FILTER (WHERE compliant) AS passed
    FROM cargoflow_robinhood.EvidenceRegistry_evt_EvidenceEpochCommitted
    GROUP BY 1
),
pr AS (
    SELECT shipmentId AS shipment_id, evt_block_time AS ts, evt_block_number AS bn, evt_index AS ix,
        evt_tx_hash AS tx, 'pause' AS kind, CAST(NULL AS VARBINARY) AS basis
    FROM cargoflow_robinhood.FinancingController_evt_FinancingPaused
    UNION ALL
    SELECT shipmentId, evt_block_time, evt_block_number, evt_index, evt_tx_hash, 'resume', basis
    FROM cargoflow_robinhood.FinancingController_evt_FinancingResumed
),
seq AS (
    SELECT
        pr.*,
        LEAD(kind) OVER (PARTITION BY shipment_id ORDER BY bn, ix) AS next_kind,
        LEAD(ts) OVER (PARTITION BY shipment_id ORDER BY bn, ix) AS next_ts,
        LEAD(tx) OVER (PARTITION BY shipment_id ORDER BY bn, ix) AS next_tx,
        LEAD(basis) OVER (PARTITION BY shipment_id ORDER BY bn, ix) AS next_basis
    FROM pr
),
recoveries AS (
    SELECT
        s.shipment_id,
        date_diff('second', s.ts, s.next_ts) / 3600.0 AS hours_to_recover,
        p.evt_tx_hash IS NOT NULL AS via_zk
    FROM seq AS s
    LEFT JOIN cargoflow_robinhood.EvidenceRegistry_evt_EvidenceProofVerified AS p
        ON p.evt_tx_hash = s.next_tx AND p.epochId = s.next_basis
    WHERE s.kind = 'pause' AND s.next_kind = 'resume'
),
pauses AS (
    SELECT shipment_id, COUNT(*) AS pauses FROM pr WHERE kind = 'pause' GROUP BY 1
),
rec AS (
    SELECT
        shipment_id,
        COUNT(*) AS recoveries,
        COUNT(*) FILTER (WHERE via_zk) AS zk_recoveries,
        SUM(hours_to_recover) AS total_hours_to_recover
    FROM recoveries GROUP BY 1
),
per_facility AS (
    SELECT
        r.route_commitment,
        f.shipmentId AS shipment_id,
        COALESCE(e.epochs, 0) AS epochs,
        COALESCE(e.passed, 0) AS passed,
        COALESCE(p.pauses, 0) AS pauses,
        COALESCE(rc.recoveries, 0) AS recoveries,
        COALESCE(rc.zk_recoveries, 0) AS zk_recoveries,
        rc.total_hours_to_recover
    FROM cargoflow_robinhood.FinancingController_evt_FacilityCreated AS f
    LEFT JOIN routes AS r ON r.shipment_id = f.shipmentId
    LEFT JOIN epochs AS e ON e.shipment_id = f.shipmentId
    LEFT JOIN pauses AS p ON p.shipment_id = f.shipmentId
    LEFT JOIN rec AS rc ON rc.shipment_id = f.shipmentId
)
SELECT
    route_commitment,
    COUNT(*) AS facilities,
    SUM(epochs) AS epochs,
    CAST(SUM(passed) AS DOUBLE) / NULLIF(SUM(epochs), 0) AS pass_rate,
    SUM(pauses) AS pauses,
    100.0 * SUM(pauses) / NULLIF(SUM(epochs), 0) AS pauses_per_100_epochs,
    CAST(COUNT(*) FILTER (WHERE pauses > 0) AS DOUBLE) / COUNT(*) AS share_of_facilities_paused,
    SUM(zk_recoveries) AS zk_recoveries,
    SUM(total_hours_to_recover) / NULLIF(SUM(recoveries), 0) AS avg_hours_to_recover
FROM per_facility
GROUP BY route_commitment
ORDER BY facilities DESC;


-- ==================================================================================== 2c (uploaded)
WITH ev AS (
    SELECT block_time AS ts, block_number AS bn, log_index AS ix, tx_hash AS tx, contract, event_name,
        shipment_id, args
    FROM dune.{{team}}.cargoflow_chain_events
),
epochs AS (
    SELECT
        shipment_id,
        COUNT(*) AS epochs,
        COUNT(*) FILTER (WHERE compliant) AS passed,
        COUNT(*) FILTER (WHERE NOT compliant) AS failed,
        COUNT(*) FILTER (WHERE NOT decision_pass) AS decision_failed,
        COUNT(*) FILTER (WHERE held_distance_m IS NOT NULL) AS held_outside_place,
        COUNT(*) FILTER (WHERE proof_verified) AS proof_verified,
        AVG(CAST(score AS DOUBLE)) AS avg_score,
        MAX(max_humidity_x100) / 100.0 AS max_humidity_pct,
        MAX(max_shock_x100) / 100.0 AS max_shock_g
    FROM dune.{{team}}.cargoflow_epochs
    GROUP BY 1
),
pr AS (
    SELECT shipment_id, ts, bn, ix, tx, 'pause' AS kind, CAST(NULL AS VARCHAR) AS basis
    FROM ev WHERE contract = 'FinancingController' AND event_name = 'FinancingPaused'
    UNION ALL
    SELECT shipment_id, ts, bn, ix, tx, 'resume', json_extract_scalar(args, '$.basis')
    FROM ev WHERE contract = 'FinancingController' AND event_name = 'FinancingResumed'
),
seq AS (
    SELECT
        pr.*,
        LEAD(kind) OVER (PARTITION BY shipment_id ORDER BY bn, ix) AS next_kind,
        LEAD(ts) OVER (PARTITION BY shipment_id ORDER BY bn, ix) AS next_ts,
        LEAD(tx) OVER (PARTITION BY shipment_id ORDER BY bn, ix) AS next_tx,
        LEAD(basis) OVER (PARTITION BY shipment_id ORDER BY bn, ix) AS next_basis
    FROM pr
),
proofs AS (
    SELECT tx, json_extract_scalar(args, '$.epochId') AS epoch_id
    FROM ev WHERE contract = 'EvidenceRegistry' AND event_name = 'EvidenceProofVerified'
),
recoveries AS (
    SELECT
        s.shipment_id,
        date_diff('second', s.ts, s.next_ts) / 3600.0 AS hours_to_recover,
        p.tx IS NOT NULL AS via_zk
    FROM seq AS s
    LEFT JOIN proofs AS p ON p.tx = s.next_tx AND p.epoch_id = s.next_basis
    WHERE s.kind = 'pause' AND s.next_kind = 'resume'
),
pauses AS (
    SELECT shipment_id, COUNT(*) AS pauses FROM pr WHERE kind = 'pause' GROUP BY 1
),
rec AS (
    SELECT
        shipment_id,
        COUNT(*) AS recoveries,
        COUNT(*) FILTER (WHERE via_zk) AS zk_recoveries,
        AVG(hours_to_recover) AS avg_hours_to_recover,
        AVG(hours_to_recover) FILTER (WHERE via_zk) AS avg_hours_to_zk_recover
    FROM recoveries GROUP BY 1
)
SELECT
    s.shipment_id,
    s.external_ref,
    s.route_label,
    s.status,
    COALESCE(e.epochs, 0) AS epochs,
    COALESCE(e.passed, 0) AS epochs_passed,
    COALESCE(e.failed, 0) AS epochs_failed,
    CAST(e.passed AS DOUBLE) / NULLIF(e.epochs, 0) AS pass_rate,
    COALESCE(e.decision_failed, 0) AS policy_decisions_failed,
    COALESCE(e.held_outside_place, 0) AS epochs_held_outside_place,
    e.avg_score,
    e.max_humidity_pct,
    e.max_shock_g,
    COALESCE(p.pauses, 0) AS pauses,
    100.0 * COALESCE(p.pauses, 0) / NULLIF(e.epochs, 0) AS pauses_per_100_epochs,
    COALESCE(r.recoveries, 0) AS recoveries,
    COALESCE(r.zk_recoveries, 0) AS zk_recoveries,
    r.avg_hours_to_recover,
    r.avg_hours_to_zk_recover
FROM dune.{{team}}.cargoflow_shipments AS s
LEFT JOIN epochs AS e ON e.shipment_id = s.shipment_id
LEFT JOIN pauses AS p ON p.shipment_id = s.shipment_id
LEFT JOIN rec AS r ON r.shipment_id = s.shipment_id
WHERE s.financier IS NOT NULL
ORDER BY pauses DESC, epochs DESC;


-- ==================================================================================== 2d (uploaded)
WITH ev AS (
    SELECT block_time AS ts, block_number AS bn, log_index AS ix, tx_hash AS tx, contract, event_name,
        shipment_id, args
    FROM dune.{{team}}.cargoflow_chain_events
),
pr AS (
    SELECT shipment_id, ts, bn, ix, tx, 'pause' AS kind, CAST(NULL AS VARCHAR) AS basis
    FROM ev WHERE contract = 'FinancingController' AND event_name = 'FinancingPaused'
    UNION ALL
    SELECT shipment_id, ts, bn, ix, tx, 'resume', json_extract_scalar(args, '$.basis')
    FROM ev WHERE contract = 'FinancingController' AND event_name = 'FinancingResumed'
),
seq AS (
    SELECT
        pr.*,
        LEAD(kind) OVER (PARTITION BY shipment_id ORDER BY bn, ix) AS next_kind,
        LEAD(ts) OVER (PARTITION BY shipment_id ORDER BY bn, ix) AS next_ts,
        LEAD(tx) OVER (PARTITION BY shipment_id ORDER BY bn, ix) AS next_tx,
        LEAD(basis) OVER (PARTITION BY shipment_id ORDER BY bn, ix) AS next_basis
    FROM pr
),
proofs AS (
    SELECT tx, json_extract_scalar(args, '$.epochId') AS epoch_id
    FROM ev WHERE contract = 'EvidenceRegistry' AND event_name = 'EvidenceProofVerified'
),
per_facility AS (
    SELECT
        s.shipment_id,
        s.route_label,
        (SELECT COUNT(*) FROM dune.{{team}}.cargoflow_epochs AS e
            WHERE e.shipment_id = s.shipment_id) AS epochs,
        (SELECT COUNT(*) FROM dune.{{team}}.cargoflow_epochs AS e
            WHERE e.shipment_id = s.shipment_id AND e.compliant) AS passed,
        (SELECT COUNT(*) FROM pr WHERE pr.shipment_id = s.shipment_id AND pr.kind = 'pause') AS pauses
    FROM dune.{{team}}.cargoflow_shipments AS s
    WHERE s.financier IS NOT NULL
),
recoveries AS (
    SELECT
        s.shipment_id,
        date_diff('second', s.ts, s.next_ts) / 3600.0 AS hours_to_recover,
        p.tx IS NOT NULL AS via_zk
    FROM seq AS s
    LEFT JOIN proofs AS p ON p.tx = s.next_tx AND p.epoch_id = s.next_basis
    WHERE s.kind = 'pause' AND s.next_kind = 'resume'
),
rec AS (
    SELECT
        shipment_id,
        COUNT(*) AS recoveries,
        COUNT(*) FILTER (WHERE via_zk) AS zk_recoveries,
        SUM(hours_to_recover) AS total_hours_to_recover
    FROM recoveries GROUP BY 1
)
SELECT
    f.route_label,
    COUNT(*) AS facilities,
    SUM(f.epochs) AS epochs,
    CAST(SUM(f.passed) AS DOUBLE) / NULLIF(SUM(f.epochs), 0) AS pass_rate,
    SUM(f.pauses) AS pauses,
    100.0 * SUM(f.pauses) / NULLIF(SUM(f.epochs), 0) AS pauses_per_100_epochs,
    CAST(COUNT(*) FILTER (WHERE f.pauses > 0) AS DOUBLE) / COUNT(*) AS share_of_facilities_paused,
    COALESCE(SUM(r.zk_recoveries), 0) AS zk_recoveries,
    SUM(r.total_hours_to_recover) / NULLIF(SUM(r.recoveries), 0) AS avg_hours_to_recover
FROM per_facility AS f
LEFT JOIN rec AS r ON r.shipment_id = f.shipment_id
GROUP BY f.route_label
ORDER BY facilities DESC;
