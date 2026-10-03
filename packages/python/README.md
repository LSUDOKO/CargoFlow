# cargoflow (Python SDK)

Analytics-first Python access to [CargoFlow](https://github.com/LSUDOKO/CargoFlow): typed models of the public read
API, pandas (or polars) data frames, portfolio risk analytics with a seeded Monte Carlo of default and recovery,
and the gateway request signer. Read-only: the SDK never submits transactions.

```sh
pip install cargoflow                 # pandas
pip install "cargoflow[polars]"       # + polars frames
pip install "cargoflow[notebooks]"    # + Jupyter and matplotlib for the examples
```

Python 3.10+. Dependencies: httpx, pydantic v2, pandas, numpy, cryptography.

## Quick start

```python
from cargoflow import CargoFlow
from cargoflow import analytics as cfa

cf = CargoFlow()                                   # https://cargoflow-api-75ul.onrender.com by default
cf.stats()                                         # Stats(shipments={'ACTIVE': 2, ...}, total=4, ...)
cf.shipments(status=["PAUSED", "DISPUTED"]).to_frame()

pf = cf.portfolio()                                # views, epochs and tracks of every shipment, fetched concurrently
cfa.exposure(pf)                                   # committed / drawn / in escrow / covered by status
cfa.excursion_stats(pf)                            # temperature excursions per route and cargo band
mc = cfa.simulate_default_recovery(pf, n_sims=20_000, seed=2026)
mc.summary()                                       # expected loss, VaR / ES 95 and 99, default probabilities
mc.by_shipment()
```

## Client

`CargoFlow(api_url=..., timeout=60, retries=3, backoff=1.0)`; retries cover 429, 5xx and connection errors with
exponential backoff (the hosted API can take a few seconds to wake). Errors raise `CargoFlowError`
(`status`, `code`, `message`); 404s raise `NotFoundError`.

| Method | Endpoint | Returns |
| --- | --- | --- |
| `health()`, `config()`, `stats()` | `/v1/health`, `/v1/config`, `/v1/stats` | `Health`, `dict`, `Stats` |
| `shipments(status=, party=, ref=, limit=, offset=)` | `/v1/shipments` | `ModelList[Shipment]` |
| `iter_shipments(...)`, `all_shipments(...)` | paginated `/v1/shipments` | every match |
| `shipment(id)` | `/v1/shipments/{id}` | `ShipmentView` (record, milestones, live facility, latest evidence, cover) |
| `epochs(id)` | `/v1/shipments/{id}/epochs` | `ModelList[Epoch]` |
| `track(id)` | `/v1/shipments/{id}/track` | `ModelList[TrackPoint]` |
| `audit(id, limit=)` | `/v1/shipments/{id}/audit` | `ModelList[AuditEntry]` |
| `telemetry(id)` | `/v1/shipments/{id}/telemetry` | `TelemetrySummary` (per-epoch, per-sensor aggregates) |
| `sources(id)` | `/v1/shipments/{id}/sources` | `ModelList[GatewaySource]` |
| `cover(id)` | `/v1/shipments/{id}/cover` | `ShipmentCover` (offers and accepted cover; `NotFoundError` on API versions before contracts v2) |
| `party(address)` | `/v1/parties/{address}` | `Party` (exporter, financier, buyer, insurer records, grade) |
| `market_requests(status=, exporter=)` | `/v1/requests` | `ModelList[MarketRequest]` |
| `portfolio(ids=None, status=, party=, include_track=True, include_cover=False)` | all of the above per shipment | `analytics.Portfolio` |
| `get(path, params)` | any GET | decoded JSON |

Models are pydantic v2 with snake_case fields (camelCase on the wire). Amounts are USDG **base units** as `int`
(the API sends decimal strings, so no precision is lost; `cargoflow.usdg(x)` converts to USDG). Temperatures are
hundredths of °C (`*_x100`), positions micro-degrees (`*_e6`), shares basis points (`*_bps`). Unknown fields are
kept, so newer API versions do not break older clients.

Every list result is a `ModelList` with `.to_frame(backend="pandas" | "polars")`; nested objects are flattened
(`policy_min_temp_x100`, `penalties_conflict`).

## Analytics (`cargoflow.analytics`)

All functions take a `Portfolio` and return a DataFrame (pass `backend="polars"` for polars). Amounts in USDG.

| Function | What it measures |
| --- | --- |
| `Portfolio.shipments_frame()` / `epochs_frame()` / `track_frame()` / `milestones_frame()` | Tidy frames: one row per shipment (route, cargo band, facility amounts, cover, latest score), epoch, track point (with band exceedance), milestone. |
| `exposure(pf, by="status")` | Invoice value, committed, drawn, in escrow (funded, undrawn, open facilities), undrawn, covered (ACTIVE cover), uncovered drawn, share of drawn; `TOTAL` row. Any shipments-frame column works as `by` (`"financier"`, `"route"`, `"cargo"`). |
| `excursion_stats(pf, by=("route", "cargo"))` | Per lane and band: epochs, excursion epochs and rate, shipments with an excursion, mean / max exceedance (°C), minutes out of band, excursions committed on chain. |
| `conflict_distribution(pf, by=None, quantiles=...)`, `conflict_histogram(pf, bins=...)` | Sensor-conflict score distribution (mean, std, p50/p90/p95/p99, max, share above the policy limit) and banded counts. |
| `release_latency(pf)` | Seconds from the approving `APPROVE_ADVANCE` epoch to the milestone release on chain, per released milestone. |
| `pause_events(pf)`, `recovery_rates(pf, by=None)` | Every pause and its outcome (recovered with/without proof, defaulted, open), recovery rate (open pauses censored), mean time to recovery; `TOTAL` row. |
| `estimate_epoch_rates(pf, prior=(1, 1))` | Beta posteriors of `p_pause` (per milestone evaluation) and `p_recover` (per resolved pause) from history. |
| `simulate_default_recovery(pf, n_sims=10_000, seed=7, ...)` | Monte Carlo of default and recovery (below). Returns `MonteCarloResult` with `summary()`, `by_shipment()`, `var(level)`, `expected_shortfall(level)`, `loss_distribution()`, raw arrays `defaults`, `ead`, `losses` (`n_sims x shipments`). |

### The Monte Carlo model

For every open facility (not SETTLED / DEFAULTED) with `D` drawn and remaining tranches `A_1..A_R`:

1. each remaining milestone evaluation pauses the facility with probability `p_pause`;
2. a pause is recovered (resume with proof, then the tranche is released) with probability `p_recover`, otherwise
   the facility defaults there; a facility PAUSED today starts with that pending pause;
3. exposure at default is what was drawn before the failing milestone, `EAD = D + A_1 + ... + A_(k-1)`;
4. the accepted (ACTIVE) cover pays `min(cover, EAD)`; a salvage fraction of the rest is recovered,
   `salvage ~ Beta(2, 5)` by default (mean 29%, configurable or fixed with a float);
5. `loss = (EAD - cover payout) x (1 - salvage)`.

`p_pause` and `p_recover` come from the historical epochs through conjugate Beta updates; with
`parameter_uncertainty=True` (default) every simulation draws its own pair from the posteriors, so a short history
shows up as a wider loss distribution rather than false precision. The whole run is one vectorised numpy
computation over a `(n_sims, shipments, milestones)` array, seeded with `numpy.random.default_rng(seed)`.
Simplifications: milestones independent given the rates, one pause per milestone, no settlement risk after
delivery, disputes or fees. `tests/test_montecarlo.py` checks the simulation against the closed-form default
probabilities and expected losses.

## Gateway signing (`cargoflow.gateway`)

Byte-identical to the backend (`backend/internal/auth`), the website and `@cargoflow/gateway`; pinned by the Go
test vector.

```python
from cargoflow.gateway import load_key_file, sign_request, signed_headers

key = load_key_file("cargoflow-gateway-CF-0411-src-1d959c814185668d.json")   # the website's key file
body = '{"points":[...]}'
path = f"/v1/shipments/{key.shipment_id}/telemetry"
headers = signed_headers(key, "POST", path, body)          # X-Source-Id, X-Timestamp, X-Signature
# or the primitive: sign_request(seed_bytes, "POST", path, unix_ts, body)
```

The signature is base64url Ed25519 over `CARGOFLOW-V1\nPOST\n<path>\n<ts>\n<hex sha256(body)>`. The SDK does not
send telemetry; use the gateway agent or your own HTTP client.

## Examples

`examples/` holds two notebooks that run against the live read API, each with an equivalent `.py` script:

- `portfolio_risk_review.ipynb`: the book, exposure, counterparties, pauses and recoveries, release latency,
  Monte Carlo with a sensitivity table and the loss distribution.
- `route_excursion_analysis.ipynb`: excursions per lane and cargo band, the worst epochs, conflict distributions,
  per-sensor aggregates of the worst shipment, a map of excursion centroids.

```sh
pip install -e ".[notebooks]"
jupyter nbconvert --to notebook --execute --inplace examples/portfolio_risk_review.ipynb
python examples/route_excursion_analysis.py
```

## Development

```sh
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest                 # unit tests (respx mocks), no network
pytest -m live         # one read-only smoke test against the live API
```

## Licence

MIT (see the repository LICENSE).
