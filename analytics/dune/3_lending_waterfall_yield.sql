-- CargoFlow on Dune: 3. Lending waterfall and yield
--
-- Six Dune queries, one per block:
--   3a  decoded  per facility: fee earned, tenor, annualised yield, realised result net of cover
--   3b  decoded  by tenor bucket: fees, yield and the fee distribution
--   3c  decoded  cover: premiums earned vs payouts, per insurer
--   3d  uploaded per facility (same columns as 3a, plus the readable reference and route)
--   3e  uploaded by tenor bucket
--   3f  uploaded cover premiums vs payouts
--
-- Definitions (USDG, 6 decimals):
--   fee                 ReceivableVault.FacilitySettled.fee (paid by the buyer to the financier in the waterfall)
--   tenor               first CapitalDeposited -> FacilitySettled (or FacilityDefaulted), in days
--   yield on committed  fee / committed * 365 / tenor_days (the financier deposits the full commitment)
--   yield on drawn      fee / principal * 365 / tenor_days (principal = what the exporter actually drew)
--   realised result     settled: fee - premium paid; defaulted: -outstandingPrincipal + cover payout - premium
--   cover payout        CoverClaimed.payout, or v3 ParametricTriggered.financierPayout
-- Lines marked v3 read events added in contracts v3; delete them if the deployment predates v3.


-- ===================================================================================== 3a (decoded)
WITH facilities AS (
    SELECT shipmentId AS shipment_id, financier, exporter, CAST(committed AS DOUBLE) / 1e6 AS committed,
        feeBps AS fee_bps, milestoneCount AS milestones, evt_block_time AS created_at
    FROM cargoflow_robinhood.FinancingController_evt_FacilityCreated
),
deposits AS (
    SELECT shipmentId AS shipment_id, MIN(evt_block_time) AS deposited_at
    FROM cargoflow_robinhood.ReceivableVault_evt_CapitalDeposited GROUP BY 1
),
settled AS (
    SELECT shipmentId AS shipment_id, evt_block_time AS closed_at,
        CAST(principal AS DOUBLE) / 1e6 AS principal, CAST(fee AS DOUBLE) / 1e6 AS fee,
        CAST(residual AS DOUBLE) / 1e6 AS residual_to_exporter
    FROM cargoflow_robinhood.ReceivableVault_evt_FacilitySettled
),
defaulted AS (
    SELECT shipmentId AS shipment_id, evt_block_time AS closed_at,
        CAST(outstandingPrincipal AS DOUBLE) / 1e6 AS outstanding
    FROM cargoflow_robinhood.ReceivableVault_evt_FacilityDefaulted
),
cover AS (
    SELECT a.shipmentId AS shipment_id, CAST(a.premium AS DOUBLE) / 1e6 AS premium,
        COALESCE(CAST(c.payout AS DOUBLE), CAST(t.financierPayout AS DOUBLE), 0) / 1e6 AS payout
    FROM cargoflow_robinhood.CoverPool_evt_CoverAccepted AS a
    LEFT JOIN cargoflow_robinhood.CoverPool_evt_CoverClaimed AS c ON c.shipmentId = a.shipmentId
    LEFT JOIN cargoflow_robinhood.CoverPool_evt_ParametricTriggered AS t -- v3
        ON t.shipmentId = a.shipmentId -- v3
),
joined AS (
    SELECT
        f.*,
        d.deposited_at,
        COALESCE(s.closed_at, x.closed_at) AS closed_at,
        CASE WHEN s.shipment_id IS NOT NULL THEN 'SETTLED'
            WHEN x.shipment_id IS NOT NULL THEN 'DEFAULTED'
            WHEN d.shipment_id IS NOT NULL THEN 'OPEN' ELSE 'UNFUNDED' END AS outcome,
        s.principal,
        s.fee,
        s.residual_to_exporter,
        x.outstanding,
        COALESCE(c.premium, 0) AS cover_premium,
        COALESCE(c.payout, 0) AS cover_payout,
        date_diff('second', d.deposited_at, COALESCE(s.closed_at, x.closed_at)) / 86400.0 AS tenor_days
    FROM facilities AS f
    LEFT JOIN deposits AS d ON d.shipment_id = f.shipment_id
    LEFT JOIN settled AS s ON s.shipment_id = f.shipment_id
    LEFT JOIN defaulted AS x ON x.shipment_id = f.shipment_id
    LEFT JOIN cover AS c ON c.shipment_id = f.shipment_id
)
SELECT
    shipment_id,
    financier,
    outcome,
    committed,
    fee_bps,
    principal,
    fee,
    residual_to_exporter,
    outstanding AS defaulted_principal,
    cover_premium,
    cover_payout,
    tenor_days,
    CASE WHEN tenor_days IS NULL THEN 'open'
        WHEN tenor_days < 30 THEN '< 30d' WHEN tenor_days < 60 THEN '30-60d'
        WHEN tenor_days < 90 THEN '60-90d' ELSE '90d+' END AS tenor_bucket,
    fee / NULLIF(committed, 0) * 365 / NULLIF(GREATEST(tenor_days, 1.0 / 24), 0) AS apr_on_committed,
    fee / NULLIF(principal, 0) * 365 / NULLIF(GREATEST(tenor_days, 1.0 / 24), 0) AS apr_on_drawn,
    CASE outcome
        WHEN 'SETTLED' THEN fee - cover_premium
        WHEN 'DEFAULTED' THEN cover_payout - outstanding - cover_premium
    END AS realised_result_usdg
FROM joined
ORDER BY created_at DESC;


-- ===================================================================================== 3b (decoded)
WITH facilities AS (
    SELECT shipmentId AS shipment_id, CAST(committed AS DOUBLE) / 1e6 AS committed, feeBps AS fee_bps
    FROM cargoflow_robinhood.FinancingController_evt_FacilityCreated
),
deposits AS (
    SELECT shipmentId AS shipment_id, MIN(evt_block_time) AS deposited_at
    FROM cargoflow_robinhood.ReceivableVault_evt_CapitalDeposited GROUP BY 1
),
settled AS (
    SELECT shipmentId AS shipment_id, evt_block_time AS closed_at,
        CAST(principal AS DOUBLE) / 1e6 AS principal, CAST(fee AS DOUBLE) / 1e6 AS fee
    FROM cargoflow_robinhood.ReceivableVault_evt_FacilitySettled
),
per_facility AS (
    SELECT
        f.fee_bps,
        f.committed,
        s.principal,
        s.fee,
        date_diff('second', d.deposited_at, s.closed_at) / 86400.0 AS tenor_days
    FROM facilities AS f
    JOIN deposits AS d ON d.shipment_id = f.shipment_id
    JOIN settled AS s ON s.shipment_id = f.shipment_id
),
bucketed AS (
    SELECT
        *,
        CASE WHEN tenor_days < 30 THEN '< 30d' WHEN tenor_days < 60 THEN '30-60d'
            WHEN tenor_days < 90 THEN '60-90d' ELSE '90d+' END AS tenor_bucket,
        fee / NULLIF(committed, 0) * 365 / GREATEST(tenor_days, 1.0 / 24) AS apr_on_committed,
        fee / NULLIF(principal, 0) * 365 / GREATEST(tenor_days, 1.0 / 24) AS apr_on_drawn
    FROM per_facility
)
SELECT
    tenor_bucket,
    COUNT(*) AS settled_facilities,
    SUM(committed) AS committed_usdg,
    SUM(principal) AS principal_usdg,
    SUM(fee) AS fees_earned_usdg,
    AVG(tenor_days) AS avg_tenor_days,
    SUM(fee) / NULLIF(SUM(committed), 0) * 365 / NULLIF(AVG(tenor_days), 0) AS pooled_apr_on_committed,
    approx_percentile(apr_on_committed, 0.5) AS median_apr_on_committed,
    approx_percentile(apr_on_drawn, 0.5) AS median_apr_on_drawn,
    MIN(fee_bps) AS min_fee_bps,
    approx_percentile(fee_bps, 0.5) AS median_fee_bps,
    MAX(fee_bps) AS max_fee_bps,
    COUNT(*) FILTER (WHERE fee_bps < 100) AS fee_under_1pct,
    COUNT(*) FILTER (WHERE fee_bps >= 100 AND fee_bps < 200) AS fee_1_to_2pct,
    COUNT(*) FILTER (WHERE fee_bps >= 200 AND fee_bps < 500) AS fee_2_to_5pct,
    COUNT(*) FILTER (WHERE fee_bps >= 500) AS fee_5pct_plus
FROM bucketed
GROUP BY tenor_bucket
ORDER BY MIN(tenor_days);


-- ===================================================================================== 3c (decoded)
WITH accepted AS (
    SELECT shipmentId AS shipment_id, insurer, financier,
        CAST(amount AS DOUBLE) / 1e6 AS cover_amount, CAST(premium AS DOUBLE) / 1e6 AS premium
    FROM cargoflow_robinhood.CoverPool_evt_CoverAccepted
),
claims AS (
    SELECT shipmentId AS shipment_id, CAST(payout AS DOUBLE) / 1e6 AS paid_financier,
        CAST(0 AS DOUBLE) AS paid_exporter, CAST(loss AS DOUBLE) / 1e6 AS loss, 'default claim' AS kind
    FROM cargoflow_robinhood.CoverPool_evt_CoverClaimed
    UNION ALL
    SELECT shipmentId, CAST(financierPayout AS DOUBLE) / 1e6, CAST(exporterSalvage AS DOUBLE) / 1e6, -- v3
        CAST(NULL AS DOUBLE), 'parametric trigger' -- v3
    FROM cargoflow_robinhood.CoverPool_evt_ParametricTriggered -- v3
),
released AS (
    SELECT shipmentId AS shipment_id FROM cargoflow_robinhood.CoverPool_evt_CoverReleased
)
SELECT
    a.insurer,
    COUNT(*) AS covers_written,
    SUM(a.cover_amount) AS cover_written_usdg,
    SUM(a.premium) AS premiums_earned_usdg,
    COUNT(r.shipment_id) AS covers_released,
    COUNT(c.shipment_id) AS covers_paid_out,
    COALESCE(SUM(c.paid_financier), 0) AS paid_to_financiers_usdg,
    COALESCE(SUM(c.paid_exporter), 0) AS salvage_to_exporters_usdg,
    SUM(a.premium) - COALESCE(SUM(c.paid_financier + c.paid_exporter), 0) AS insurer_net_usdg,
    COALESCE(SUM(c.paid_financier + c.paid_exporter), 0) / NULLIF(SUM(a.premium), 0) AS loss_ratio,
    SUM(a.premium) / NULLIF(SUM(a.cover_amount), 0) AS avg_premium_rate
FROM accepted AS a
LEFT JOIN claims AS c ON c.shipment_id = a.shipment_id
LEFT JOIN released AS r ON r.shipment_id = a.shipment_id
GROUP BY a.insurer
ORDER BY premiums_earned_usdg DESC;


-- ==================================================================================== 3d (uploaded)
WITH ev AS (
    SELECT block_time AS ts, contract, event_name, shipment_id, args
    FROM dune.{{team}}.cargoflow_chain_events
),
facilities AS (
    SELECT shipment_id, json_extract_scalar(args, '$.financier') AS financier,
        CAST(json_extract_scalar(args, '$.committed') AS DOUBLE) / 1e6 AS committed,
        CAST(json_extract_scalar(args, '$.feeBps') AS INTEGER) AS fee_bps, ts AS created_at
    FROM ev WHERE contract = 'FinancingController' AND event_name = 'FacilityCreated'
),
deposits AS (
    SELECT shipment_id, MIN(ts) AS deposited_at
    FROM ev WHERE contract = 'ReceivableVault' AND event_name = 'CapitalDeposited' GROUP BY 1
),
settled AS (
    SELECT shipment_id, ts AS closed_at,
        CAST(json_extract_scalar(args, '$.principal') AS DOUBLE) / 1e6 AS principal,
        CAST(json_extract_scalar(args, '$.fee') AS DOUBLE) / 1e6 AS fee,
        CAST(json_extract_scalar(args, '$.residual') AS DOUBLE) / 1e6 AS residual_to_exporter
    FROM ev WHERE contract = 'ReceivableVault' AND event_name = 'FacilitySettled'
),
defaulted AS (
    SELECT shipment_id, ts AS closed_at,
        CAST(json_extract_scalar(args, '$.outstandingPrincipal') AS DOUBLE) / 1e6 AS outstanding
    FROM ev WHERE contract = 'ReceivableVault' AND event_name = 'FacilityDefaulted'
),
cover AS (
    SELECT
        shipment_id,
        COALESCE(SUM(CAST(json_extract_scalar(args, '$.premium') AS DOUBLE))
            FILTER (WHERE event_name = 'CoverAccepted'), 0) / 1e6 AS premium,
        COALESCE(SUM(CAST(json_extract_scalar(args, '$.payout') AS DOUBLE))
            FILTER (WHERE event_name = 'CoverClaimed'), 0) / 1e6
        + COALESCE(SUM(CAST(json_extract_scalar(args, '$.financierPayout') AS DOUBLE))
            FILTER (WHERE event_name = 'ParametricTriggered'), 0) / 1e6 AS payout
    FROM ev WHERE contract = 'CoverPool'
    GROUP BY 1
),
joined AS (
    SELECT
        f.*,
        sh.external_ref,
        sh.route_label,
        CASE WHEN s.shipment_id IS NOT NULL THEN 'SETTLED'
            WHEN x.shipment_id IS NOT NULL THEN 'DEFAULTED'
            WHEN d.shipment_id IS NOT NULL THEN 'OPEN' ELSE 'UNFUNDED' END AS outcome,
        s.principal,
        s.fee,
        s.residual_to_exporter,
        x.outstanding,
        COALESCE(c.premium, 0) AS cover_premium,
        COALESCE(c.payout, 0) AS cover_payout,
        date_diff('second', d.deposited_at, COALESCE(s.closed_at, x.closed_at)) / 86400.0 AS tenor_days
    FROM facilities AS f
    LEFT JOIN dune.{{team}}.cargoflow_shipments AS sh ON sh.shipment_id = f.shipment_id
    LEFT JOIN deposits AS d ON d.shipment_id = f.shipment_id
    LEFT JOIN settled AS s ON s.shipment_id = f.shipment_id
    LEFT JOIN defaulted AS x ON x.shipment_id = f.shipment_id
    LEFT JOIN cover AS c ON c.shipment_id = f.shipment_id
)
SELECT
    shipment_id,
    external_ref,
    route_label,
    financier,
    outcome,
    committed,
    fee_bps,
    principal,
    fee,
    residual_to_exporter,
    outstanding AS defaulted_principal,
    cover_premium,
    cover_payout,
    tenor_days,
    CASE WHEN tenor_days IS NULL THEN 'open'
        WHEN tenor_days < 30 THEN '< 30d' WHEN tenor_days < 60 THEN '30-60d'
        WHEN tenor_days < 90 THEN '60-90d' ELSE '90d+' END AS tenor_bucket,
    fee / NULLIF(committed, 0) * 365 / NULLIF(GREATEST(tenor_days, 1.0 / 24), 0) AS apr_on_committed,
    fee / NULLIF(principal, 0) * 365 / NULLIF(GREATEST(tenor_days, 1.0 / 24), 0) AS apr_on_drawn,
    CASE outcome
        WHEN 'SETTLED' THEN fee - cover_premium
        WHEN 'DEFAULTED' THEN cover_payout - outstanding - cover_premium
    END AS realised_result_usdg
FROM joined
ORDER BY created_at DESC;


-- ==================================================================================== 3e (uploaded)
WITH ev AS (
    SELECT block_time AS ts, contract, event_name, shipment_id, args
    FROM dune.{{team}}.cargoflow_chain_events
),
facilities AS (
    SELECT shipment_id,
        CAST(json_extract_scalar(args, '$.committed') AS DOUBLE) / 1e6 AS committed,
        CAST(json_extract_scalar(args, '$.feeBps') AS INTEGER) AS fee_bps
    FROM ev WHERE contract = 'FinancingController' AND event_name = 'FacilityCreated'
),
deposits AS (
    SELECT shipment_id, MIN(ts) AS deposited_at
    FROM ev WHERE contract = 'ReceivableVault' AND event_name = 'CapitalDeposited' GROUP BY 1
),
settled AS (
    SELECT shipment_id, ts AS closed_at,
        CAST(json_extract_scalar(args, '$.principal') AS DOUBLE) / 1e6 AS principal,
        CAST(json_extract_scalar(args, '$.fee') AS DOUBLE) / 1e6 AS fee
    FROM ev WHERE contract = 'ReceivableVault' AND event_name = 'FacilitySettled'
),
per_facility AS (
    SELECT f.fee_bps, f.committed, s.principal, s.fee,
        date_diff('second', d.deposited_at, s.closed_at) / 86400.0 AS tenor_days
    FROM facilities AS f
    JOIN deposits AS d ON d.shipment_id = f.shipment_id
    JOIN settled AS s ON s.shipment_id = f.shipment_id
),
bucketed AS (
    SELECT
        *,
        CASE WHEN tenor_days < 30 THEN '< 30d' WHEN tenor_days < 60 THEN '30-60d'
            WHEN tenor_days < 90 THEN '60-90d' ELSE '90d+' END AS tenor_bucket,
        fee / NULLIF(committed, 0) * 365 / GREATEST(tenor_days, 1.0 / 24) AS apr_on_committed,
        fee / NULLIF(principal, 0) * 365 / GREATEST(tenor_days, 1.0 / 24) AS apr_on_drawn
    FROM per_facility
)
SELECT
    tenor_bucket,
    COUNT(*) AS settled_facilities,
    SUM(committed) AS committed_usdg,
    SUM(principal) AS principal_usdg,
    SUM(fee) AS fees_earned_usdg,
    AVG(tenor_days) AS avg_tenor_days,
    SUM(fee) / NULLIF(SUM(committed), 0) * 365 / NULLIF(AVG(tenor_days), 0) AS pooled_apr_on_committed,
    approx_percentile(apr_on_committed, 0.5) AS median_apr_on_committed,
    approx_percentile(apr_on_drawn, 0.5) AS median_apr_on_drawn,
    MIN(fee_bps) AS min_fee_bps,
    approx_percentile(fee_bps, 0.5) AS median_fee_bps,
    MAX(fee_bps) AS max_fee_bps,
    COUNT(*) FILTER (WHERE fee_bps < 100) AS fee_under_1pct,
    COUNT(*) FILTER (WHERE fee_bps >= 100 AND fee_bps < 200) AS fee_1_to_2pct,
    COUNT(*) FILTER (WHERE fee_bps >= 200 AND fee_bps < 500) AS fee_2_to_5pct,
    COUNT(*) FILTER (WHERE fee_bps >= 500) AS fee_5pct_plus
FROM bucketed
GROUP BY tenor_bucket
ORDER BY MIN(tenor_days);


-- ==================================================================================== 3f (uploaded)
WITH ev AS (
    SELECT contract, event_name, shipment_id, args
    FROM dune.{{team}}.cargoflow_chain_events
    WHERE contract = 'CoverPool'
),
accepted AS (
    SELECT shipment_id, json_extract_scalar(args, '$.insurer') AS insurer,
        CAST(json_extract_scalar(args, '$.amount') AS DOUBLE) / 1e6 AS cover_amount,
        CAST(json_extract_scalar(args, '$.premium') AS DOUBLE) / 1e6 AS premium
    FROM ev WHERE event_name = 'CoverAccepted'
),
claims AS (
    SELECT
        shipment_id,
        COALESCE(CAST(json_extract_scalar(args, '$.payout') AS DOUBLE),
            CAST(json_extract_scalar(args, '$.financierPayout') AS DOUBLE)) / 1e6 AS paid_financier,
        COALESCE(CAST(json_extract_scalar(args, '$.exporterSalvage') AS DOUBLE), 0) / 1e6 AS paid_exporter
    FROM ev WHERE event_name IN ('CoverClaimed', 'ParametricTriggered')
),
released AS (
    SELECT shipment_id FROM ev WHERE event_name = 'CoverReleased'
)
SELECT
    a.insurer,
    COUNT(*) AS covers_written,
    SUM(a.cover_amount) AS cover_written_usdg,
    SUM(a.premium) AS premiums_earned_usdg,
    COUNT(r.shipment_id) AS covers_released,
    COUNT(c.shipment_id) AS covers_paid_out,
    COALESCE(SUM(c.paid_financier), 0) AS paid_to_financiers_usdg,
    COALESCE(SUM(c.paid_exporter), 0) AS salvage_to_exporters_usdg,
    SUM(a.premium) - COALESCE(SUM(c.paid_financier + c.paid_exporter), 0) AS insurer_net_usdg,
    COALESCE(SUM(c.paid_financier + c.paid_exporter), 0) / NULLIF(SUM(a.premium), 0) AS loss_ratio,
    SUM(a.premium) / NULLIF(SUM(a.cover_amount), 0) AS avg_premium_rate
FROM accepted AS a
LEFT JOIN claims AS c ON c.shipment_id = a.shipment_id
LEFT JOIN released AS r ON r.shipment_id = a.shipment_id
GROUP BY a.insurer
ORDER BY premiums_earned_usdg DESC;
