# CargoFlow on Dune

Three dashboards' worth of DuneSQL for CargoFlow's on-chain financing: volume and TVL, anomalies and pauses, and the
lending waterfall with yield. Status: **queries written and checked locally; not yet created on Dune** (needs a
Dune API key and team handle).

| File | Queries | Answers |
|---|---|---|
| `1_total_volume_and_tvl.sql` | 1a-1d | USDG committed, deposited, drawn, settled, defaulted per day and cumulative; vault escrow, cover pool and TVL over time and now |
| `2_anomaly_and_pause_rate.sql` | 2a-2d | epochs committed, pass/fail rate, pauses per 100 epochs, share of facilities paused, ZK recoveries (`resumeWithProof`) and time to recovery, per facility and per route |
| `3_lending_waterfall_yield.sql` | 3a-3f | financier fees, annualised yield per facility by tenor bucket, fee distribution, realised result net of cover, insurer premiums vs payouts and loss ratio |

Each file holds several Dune queries, one per block (blocks are headed `-- ===== 1a (decoded)` and end with a
semicolon). Create one Dune query per block.

## Two forms of every query

Dune lists Robinhood Chain (`robinhood.*` raw tables; decoded project tables are named
`<project>_robinhood.<Contract>_evt_<Event>`). Whether Robinhood Chain **Testnet** (46630), where CargoFlow runs, is
indexed is not documented, so every query exists twice:

1. **Decoded** (`a`, `b`, `c` blocks): reads `cargoflow_robinhood.<Contract>_evt_<Event>`, the tables Dune creates
   after the CargoFlow contracts are submitted for decoding (project name `cargoflow`). Columns are the ABI argument
   names from `contracts/src/interfaces/*.sol` plus Dune's `evt_block_time`, `evt_block_number`, `evt_index`,
   `evt_tx_hash`. `StatusChanged`'s `from` and `to` are quoted because they are SQL keywords.
2. **Uploaded** (`c`/`d` for 1-2, `d`/`e`/`f` for 3): reads `dune.{{team}}.cargoflow_chain_events`,
   `dune.{{team}}.cargoflow_shipments` and `dune.{{team}}.cargoflow_epochs`, which CargoFlow's backend pushes through
   the Dune uploads API every 15 minutes. `{{team}}` is a Dune text parameter: set it to your team or user handle.
   The table shapes are in [`upload-schema.md`](upload-schema.md); the pusher itself is still to be written.

The uploaded form can say more than the decoded one: readable route labels (on chain a route is only a hash), the
off-chain policy decision and its readable reasons (on chain the pause reason is a keccak hash), and epochs held
because their centroid was outside the milestone's place.

Units: USDG has 6 decimals, so every amount is divided by `1e6`. Yields are fractions (`0.25` = 25% APR).
Lines marked `-- v3` read events added in contracts v3 (`CapitalReturned`, `ParametricTriggered`); delete them when
querying a deployment that predates v3, or the decoded table will not exist.

## Checks run

```bash
python -m venv .venv && .venv/bin/pip install -r check/requirements.txt
.venv/bin/python check/parse.py *.sql          # every block parses as Trino SQL (sqlglot)
.venv/bin/python check/run_uploaded.py *.sql   # uploaded forms run in DuckDB on synthetic data
```

`run_uploaded.py` loads two facilities (one settled after a pause and a ZK recovery five hours later, one defaulted
with a 30,000 USDG cover claim) and the outputs reconcile: escrow and cover pool return to 0, the settled facility
shows a 2,000 USDG fee at 25.2% APR on committed capital over 29 days, the defaulted one a -20,600 USDG result after
cover, and the route shows one ZK recovery with a 5.0-hour time to recovery. The decoded forms are parse-checked only
(DuckDB has no Dune decoded tables).

## Creating the dashboard (needs the key)

1. Create each query in the Dune UI, or with `POST https://api.dune.com/api/v1/query` (`{"name", "query_sql",
   "parameters": [{"key": "team", "type": "text", "value": "<team>"}], "is_private": false}`).
2. Add visualisations: 1a/1c area chart of `vault_escrow_usdg`, `cover_pool_usdg`, `tvl_usdg` and bars of the daily
   flows; 1b/1d counters; 2b/2d bar chart of `pauses_per_100_epochs` by route; 3b/3e table; 3c/3f table.
3. Put the dashboard link here and in the site footer.
