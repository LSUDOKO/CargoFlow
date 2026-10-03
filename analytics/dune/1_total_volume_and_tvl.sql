-- CargoFlow on Dune: 1. Total volume and TVL (USDG)
--
-- Four Dune queries, one per block (each block ends with a semicolon; paste one block per Dune query):
--   1a  decoded  daily USDG flows and running balances
--   1b  decoded  current totals (one row)
--   1c  uploaded daily USDG flows and running balances
--   1d  uploaded current totals (one row)
--
-- Decoded form: Dune's decoded tables cargoflow_robinhood.<Contract>_evt_<Event>, available once the CargoFlow
-- contracts are submitted for decoding on Robinhood Chain. Uploaded form: the tables CargoFlow's indexer pushes
-- through the Dune uploads API (see upload-schema.md); {{team}} is a Dune text parameter (your team or user handle).
--
-- USDG has 6 decimals: every amount is divided by 1e6. Flows:
--   committed        FinancingController.FacilityCreated.committed
--   deposited        ReceivableVault.CapitalDeposited.amount          (financier -> vault)
--   drawn            ReceivableVault.AdvanceReleased.amount           (vault -> exporter)
--   settled          ReceivableVault.FacilitySettled principal + fee + residual (invoice paid by the buyer)
--   refunded         undrawnRefund on settle/default + CapitalReturned on cancel (vault -> financier)
--   defaulted        ReceivableVault.FacilityDefaulted.outstandingPrincipal
--   vault escrow     deposited - drawn - refunded (the buyer's payment passes straight through the waterfall)
--   cover pool       CoverOffered - OfferWithdrawn - Withdrawn (premiums go insurer-direct, never via the pool)
-- Lines marked v3 read events added in contracts v3; delete them if the deployment you query predates v3.


-- ===================================================================================== 1a (decoded)
WITH flows AS (
    SELECT evt_block_time AS ts, 'committed' AS kind, CAST(committed AS DOUBLE) / 1e6 AS usdg
    FROM cargoflow_robinhood.FinancingController_evt_FacilityCreated
    UNION ALL
    SELECT evt_block_time, 'deposited', CAST(amount AS DOUBLE) / 1e6
    FROM cargoflow_robinhood.ReceivableVault_evt_CapitalDeposited
    UNION ALL
    SELECT evt_block_time, 'drawn', CAST(amount AS DOUBLE) / 1e6
    FROM cargoflow_robinhood.ReceivableVault_evt_AdvanceReleased
    UNION ALL
    SELECT evt_block_time, 'settled',
        (CAST(principal AS DOUBLE) + CAST(fee AS DOUBLE) + CAST(residual AS DOUBLE)) / 1e6
    FROM cargoflow_robinhood.ReceivableVault_evt_FacilitySettled
    UNION ALL
    SELECT evt_block_time, 'refunded', CAST(undrawnRefund AS DOUBLE) / 1e6
    FROM cargoflow_robinhood.ReceivableVault_evt_FacilitySettled
    UNION ALL
    SELECT evt_block_time, 'defaulted', CAST(outstandingPrincipal AS DOUBLE) / 1e6
    FROM cargoflow_robinhood.ReceivableVault_evt_FacilityDefaulted
    UNION ALL
    SELECT evt_block_time, 'refunded', CAST(undrawnRefund AS DOUBLE) / 1e6
    FROM cargoflow_robinhood.ReceivableVault_evt_FacilityDefaulted
    UNION ALL
    SELECT evt_block_time, 'refunded', CAST(amount AS DOUBLE) / 1e6 -- v3
    FROM cargoflow_robinhood.ReceivableVault_evt_CapitalReturned -- v3
    UNION ALL
    SELECT evt_block_time, 'cover_in', CAST(amount AS DOUBLE) / 1e6
    FROM cargoflow_robinhood.CoverPool_evt_CoverOffered
    UNION ALL
    SELECT evt_block_time, 'cover_out', CAST(amount AS DOUBLE) / 1e6
    FROM cargoflow_robinhood.CoverPool_evt_OfferWithdrawn
    UNION ALL
    SELECT evt_block_time, 'cover_out', CAST(amount AS DOUBLE) / 1e6
    FROM cargoflow_robinhood.CoverPool_evt_Withdrawn
),
daily AS (
    SELECT
        date_trunc('day', ts) AS day,
        COALESCE(SUM(usdg) FILTER (WHERE kind = 'committed'), 0) AS committed,
        COALESCE(SUM(usdg) FILTER (WHERE kind = 'deposited'), 0) AS deposited,
        COALESCE(SUM(usdg) FILTER (WHERE kind = 'drawn'), 0) AS drawn,
        COALESCE(SUM(usdg) FILTER (WHERE kind = 'settled'), 0) AS settled,
        COALESCE(SUM(usdg) FILTER (WHERE kind = 'refunded'), 0) AS refunded,
        COALESCE(SUM(usdg) FILTER (WHERE kind = 'defaulted'), 0) AS defaulted,
        COALESCE(SUM(usdg) FILTER (WHERE kind = 'cover_in'), 0) AS cover_in,
        COALESCE(SUM(usdg) FILTER (WHERE kind = 'cover_out'), 0) AS cover_out
    FROM flows
    GROUP BY 1
)
SELECT
    day,
    committed,
    deposited,
    drawn,
    settled,
    defaulted,
    SUM(committed) OVER (ORDER BY day) AS cumulative_committed,
    SUM(deposited) OVER (ORDER BY day) AS cumulative_deposited,
    SUM(drawn) OVER (ORDER BY day) AS cumulative_drawn,
    SUM(settled) OVER (ORDER BY day) AS cumulative_settled,
    SUM(defaulted) OVER (ORDER BY day) AS cumulative_defaulted,
    SUM(deposited - drawn - refunded) OVER (ORDER BY day) AS vault_escrow_usdg,
    SUM(cover_in - cover_out) OVER (ORDER BY day) AS cover_pool_usdg,
    SUM(deposited - drawn - refunded + cover_in - cover_out) OVER (ORDER BY day) AS tvl_usdg
FROM daily
ORDER BY day;


-- ===================================================================================== 1b (decoded)
WITH facilities AS (
    SELECT shipmentId AS shipment_id, CAST(committed AS DOUBLE) / 1e6 AS committed
    FROM cargoflow_robinhood.FinancingController_evt_FacilityCreated
),
last_status AS (
    SELECT shipment_id, status
    FROM (
        SELECT
            shipmentId AS shipment_id,
            "to" AS status,
            ROW_NUMBER() OVER (
                PARTITION BY shipmentId ORDER BY evt_block_number DESC, evt_index DESC
            ) AS rn
        FROM cargoflow_robinhood.FinancingController_evt_StatusChanged
    ) AS s
    WHERE rn = 1
),
vault AS (
    SELECT
        (SELECT COALESCE(SUM(CAST(amount AS DOUBLE)), 0)
            FROM cargoflow_robinhood.ReceivableVault_evt_CapitalDeposited) / 1e6 AS deposited,
        (SELECT COALESCE(SUM(CAST(amount AS DOUBLE)), 0)
            FROM cargoflow_robinhood.ReceivableVault_evt_AdvanceReleased) / 1e6 AS drawn,
        (SELECT COALESCE(SUM(CAST(principal AS DOUBLE) + CAST(fee AS DOUBLE) + CAST(residual AS DOUBLE)), 0)
            FROM cargoflow_robinhood.ReceivableVault_evt_FacilitySettled) / 1e6 AS settled,
        (SELECT COALESCE(SUM(CAST(outstandingPrincipal AS DOUBLE)), 0)
            FROM cargoflow_robinhood.ReceivableVault_evt_FacilityDefaulted) / 1e6 AS defaulted,
        (
            (SELECT COALESCE(SUM(CAST(undrawnRefund AS DOUBLE)), 0)
                FROM cargoflow_robinhood.ReceivableVault_evt_FacilitySettled)
            + (SELECT COALESCE(SUM(CAST(undrawnRefund AS DOUBLE)), 0)
                FROM cargoflow_robinhood.ReceivableVault_evt_FacilityDefaulted)
            + (SELECT COALESCE(SUM(CAST(amount AS DOUBLE)), 0) -- v3
                FROM cargoflow_robinhood.ReceivableVault_evt_CapitalReturned) -- v3
        ) / 1e6 AS refunded,
        (
            (SELECT COALESCE(SUM(CAST(amount AS DOUBLE)), 0) FROM cargoflow_robinhood.CoverPool_evt_CoverOffered)
            - (SELECT COALESCE(SUM(CAST(amount AS DOUBLE)), 0) FROM cargoflow_robinhood.CoverPool_evt_OfferWithdrawn)
            - (SELECT COALESCE(SUM(CAST(amount AS DOUBLE)), 0) FROM cargoflow_robinhood.CoverPool_evt_Withdrawn)
        ) / 1e6 AS cover_pool
)
SELECT
    (SELECT COUNT(*) FROM facilities) AS facilities,
    (SELECT COUNT(*) FROM last_status WHERE status IN (2, 3, 4, 5, 6)) AS live_facilities, -- FINANCED..DELIVERED
    (SELECT COUNT(*) FROM last_status WHERE status = 7) AS settled_facilities,
    (SELECT COUNT(*) FROM last_status WHERE status = 8) AS defaulted_facilities,
    (SELECT COALESCE(SUM(committed), 0) FROM facilities) AS committed_usdg,
    v.deposited AS deposited_usdg,
    v.drawn AS drawn_usdg,
    v.settled AS settled_usdg,
    v.defaulted AS defaulted_usdg,
    v.deposited - v.drawn - v.refunded AS vault_escrow_usdg,
    v.cover_pool AS cover_pool_usdg,
    v.deposited - v.drawn - v.refunded + v.cover_pool AS tvl_usdg
FROM vault AS v;


-- ==================================================================================== 1c (uploaded)
WITH ev AS (
    SELECT block_time AS ts, contract, event_name, args
    FROM dune.{{team}}.cargoflow_chain_events
),
flows AS (
    SELECT ts, 'committed' AS kind,
        CAST(json_extract_scalar(args, '$.committed') AS DOUBLE) / 1e6 AS usdg
    FROM ev WHERE contract = 'FinancingController' AND event_name = 'FacilityCreated'
    UNION ALL
    SELECT ts, 'deposited', CAST(json_extract_scalar(args, '$.amount') AS DOUBLE) / 1e6
    FROM ev WHERE contract = 'ReceivableVault' AND event_name = 'CapitalDeposited'
    UNION ALL
    SELECT ts, 'drawn', CAST(json_extract_scalar(args, '$.amount') AS DOUBLE) / 1e6
    FROM ev WHERE contract = 'ReceivableVault' AND event_name = 'AdvanceReleased'
    UNION ALL
    SELECT ts, 'settled',
        (CAST(json_extract_scalar(args, '$.principal') AS DOUBLE)
            + CAST(json_extract_scalar(args, '$.fee') AS DOUBLE)
            + CAST(json_extract_scalar(args, '$.residual') AS DOUBLE)) / 1e6
    FROM ev WHERE contract = 'ReceivableVault' AND event_name = 'FacilitySettled'
    UNION ALL
    SELECT ts, 'refunded', CAST(json_extract_scalar(args, '$.undrawnRefund') AS DOUBLE) / 1e6
    FROM ev WHERE contract = 'ReceivableVault' AND event_name IN ('FacilitySettled', 'FacilityDefaulted')
    UNION ALL
    SELECT ts, 'refunded', CAST(json_extract_scalar(args, '$.amount') AS DOUBLE) / 1e6
    FROM ev WHERE contract = 'ReceivableVault' AND event_name = 'CapitalReturned'
    UNION ALL
    SELECT ts, 'defaulted', CAST(json_extract_scalar(args, '$.outstandingPrincipal') AS DOUBLE) / 1e6
    FROM ev WHERE contract = 'ReceivableVault' AND event_name = 'FacilityDefaulted'
    UNION ALL
    SELECT ts, 'cover_in', CAST(json_extract_scalar(args, '$.amount') AS DOUBLE) / 1e6
    FROM ev WHERE contract = 'CoverPool' AND event_name = 'CoverOffered'
    UNION ALL
    SELECT ts, 'cover_out', CAST(json_extract_scalar(args, '$.amount') AS DOUBLE) / 1e6
    FROM ev WHERE contract = 'CoverPool' AND event_name IN ('OfferWithdrawn', 'Withdrawn')
),
daily AS (
    SELECT
        date_trunc('day', ts) AS day,
        COALESCE(SUM(usdg) FILTER (WHERE kind = 'committed'), 0) AS committed,
        COALESCE(SUM(usdg) FILTER (WHERE kind = 'deposited'), 0) AS deposited,
        COALESCE(SUM(usdg) FILTER (WHERE kind = 'drawn'), 0) AS drawn,
        COALESCE(SUM(usdg) FILTER (WHERE kind = 'settled'), 0) AS settled,
        COALESCE(SUM(usdg) FILTER (WHERE kind = 'refunded'), 0) AS refunded,
        COALESCE(SUM(usdg) FILTER (WHERE kind = 'defaulted'), 0) AS defaulted,
        COALESCE(SUM(usdg) FILTER (WHERE kind = 'cover_in'), 0) AS cover_in,
        COALESCE(SUM(usdg) FILTER (WHERE kind = 'cover_out'), 0) AS cover_out
    FROM flows
    GROUP BY 1
)
SELECT
    day,
    committed,
    deposited,
    drawn,
    settled,
    defaulted,
    SUM(committed) OVER (ORDER BY day) AS cumulative_committed,
    SUM(deposited) OVER (ORDER BY day) AS cumulative_deposited,
    SUM(drawn) OVER (ORDER BY day) AS cumulative_drawn,
    SUM(settled) OVER (ORDER BY day) AS cumulative_settled,
    SUM(defaulted) OVER (ORDER BY day) AS cumulative_defaulted,
    SUM(deposited - drawn - refunded) OVER (ORDER BY day) AS vault_escrow_usdg,
    SUM(cover_in - cover_out) OVER (ORDER BY day) AS cover_pool_usdg,
    SUM(deposited - drawn - refunded + cover_in - cover_out) OVER (ORDER BY day) AS tvl_usdg
FROM daily
ORDER BY day;


-- ==================================================================================== 1d (uploaded)
WITH ev AS (
    SELECT block_number, log_index, contract, event_name, shipment_id, args
    FROM dune.{{team}}.cargoflow_chain_events
),
amounts AS (
    SELECT
        contract,
        event_name,
        shipment_id,
        CAST(json_extract_scalar(args, '$.committed') AS DOUBLE) / 1e6 AS committed,
        CAST(json_extract_scalar(args, '$.amount') AS DOUBLE) / 1e6 AS amount,
        CAST(json_extract_scalar(args, '$.principal') AS DOUBLE) / 1e6 AS principal,
        CAST(json_extract_scalar(args, '$.fee') AS DOUBLE) / 1e6 AS fee,
        CAST(json_extract_scalar(args, '$.residual') AS DOUBLE) / 1e6 AS residual,
        CAST(json_extract_scalar(args, '$.undrawnRefund') AS DOUBLE) / 1e6 AS undrawn_refund,
        CAST(json_extract_scalar(args, '$.outstandingPrincipal') AS DOUBLE) / 1e6 AS outstanding
    FROM ev
),
last_status AS (
    SELECT shipment_id, status
    FROM (
        SELECT
            shipment_id,
            CAST(json_extract_scalar(args, '$.to') AS INTEGER) AS status,
            ROW_NUMBER() OVER (PARTITION BY shipment_id ORDER BY block_number DESC, log_index DESC) AS rn
        FROM ev
        WHERE contract = 'FinancingController' AND event_name = 'StatusChanged'
    ) AS s
    WHERE rn = 1
),
totals AS (
    SELECT
        COUNT(*) FILTER (WHERE event_name = 'FacilityCreated') AS facilities,
        COALESCE(SUM(committed) FILTER (WHERE event_name = 'FacilityCreated'), 0) AS committed,
        COALESCE(SUM(amount) FILTER (WHERE event_name = 'CapitalDeposited'), 0) AS deposited,
        COALESCE(SUM(amount) FILTER (WHERE event_name = 'AdvanceReleased'), 0) AS drawn,
        COALESCE(SUM(principal + fee + residual) FILTER (WHERE event_name = 'FacilitySettled'), 0) AS settled,
        COALESCE(SUM(outstanding) FILTER (WHERE event_name = 'FacilityDefaulted'), 0) AS defaulted,
        COALESCE(SUM(undrawn_refund) FILTER (
            WHERE event_name IN ('FacilitySettled', 'FacilityDefaulted')), 0)
        + COALESCE(SUM(amount) FILTER (
            WHERE contract = 'ReceivableVault' AND event_name = 'CapitalReturned'), 0) AS refunded,
        COALESCE(SUM(amount) FILTER (WHERE contract = 'CoverPool' AND event_name = 'CoverOffered'), 0)
        - COALESCE(SUM(amount) FILTER (
            WHERE contract = 'CoverPool' AND event_name IN ('OfferWithdrawn', 'Withdrawn')), 0) AS cover_pool
    FROM amounts
)
SELECT
    t.facilities,
    (SELECT COUNT(*) FROM last_status WHERE status IN (2, 3, 4, 5, 6)) AS live_facilities,
    (SELECT COUNT(*) FROM last_status WHERE status = 7) AS settled_facilities,
    (SELECT COUNT(*) FROM last_status WHERE status = 8) AS defaulted_facilities,
    t.committed AS committed_usdg,
    t.deposited AS deposited_usdg,
    t.drawn AS drawn_usdg,
    t.settled AS settled_usdg,
    t.defaulted AS defaulted_usdg,
    t.deposited - t.drawn - t.refunded AS vault_escrow_usdg,
    t.cover_pool AS cover_pool_usdg,
    t.deposited - t.drawn - t.refunded + t.cover_pool AS tvl_usdg
FROM totals AS t;
