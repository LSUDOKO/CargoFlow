# Contracts v2: place-based milestones, humidity and shock limits, default cover

Approved in conversation on 2026-10-03 (contract changes and a redeploy are accepted). The v1 deployment stays on
chain and in the README as history; v2 is a fresh deployment with new addresses and a new live run.

Order of work: (1) contracts and their tests, (2) backend and frontend follow the new ABIs, (3) the lead deploys to
Robinhood Chain Testnet, verifies sources, runs the live lifecycle and updates the README.

## 1. Place-based milestones

- `MilestoneSpec` gains `int32 latE6`, `int32 lonE6`, `uint32 radiusM`. `radiusM == 0` means "no place condition"
  (v1 behaviour).
- `EvidenceRegistry.commitEpoch` gains the epoch's centroid `int32 latE6`, `int32 lonE6` (the mean position of the
  epoch's readings, computed by the evidence engine; aggregate only), stored in `EvidenceEpoch`.
- `FinancingController.evaluateAndReleaseMilestone` and `resumeWithProof` additionally require, when
  `radiusM > 0`, that the epoch centroid lies within `radiusM` of the milestone's place; otherwise
  `revert OutsideMilestonePlace()`. Distance on chain uses an equirectangular approximation in integer math with a
  cosine lookup by latitude degree (accurate to well under 1% for radii up to 500 km); validated against a Go
  haversine reference in tests, including the antimeridian and high latitudes. `radiusM` is bounded
  (1 km ≤ r ≤ 1,000 km when non-zero) and coordinates are range-checked at `createFacility`.
- Evidence that passes the policy but is outside the place is neither a failure nor a pause: the milestone simply
  waits (off chain the backend records `HELD_NOT_AT_PLACE`).

## 2. Humidity and shock limits

- `Policy` gains `uint16 maxHumidityX100` (0 = no limit, max 10000) and `uint16 maxShockX100` (0 = no limit).
  They are part of `hashPolicy` and the commit-reveal.
- `commitEpoch` gains the epoch's `uint16 maxHumidityX100` and `uint16 maxShockX100` (aggregate maxima). The
  controller's evidence check requires each to be within the policy limit when the limit is non-zero; a breach is a
  policy failure like a low score (`EvidenceBelowPolicy`), and the off-chain decision pauses the facility with reason
  `HUMIDITY_LIMIT` / `SHOCK_LIMIT`.
- The zero-knowledge circuit is unchanged: it proves the temperature band. A humidity or shock pause is recovered
  through the arbiter (`resumeByVerifier`) or by fresh evidence, not by the temperature proof; `resumeWithProof`
  therefore also requires the recovery epoch's humidity and shock maxima to be within the limits.

## 3. Default cover

- New `CoverPool` contract (immutable, same access contract). An insurer calls
  `offerCover(shipmentId, coverAmount, premiumBps)` while the facility is `CREATED` or `FINANCED`, depositing
  `coverAmount` USDG. The financier accepts with `acceptCover(shipmentId, insurer)`, paying the premium
  (`coverAmount * premiumBps / 10_000`, premium ≤ 20%) to the insurer immediately. One accepted cover per facility;
  unaccepted offers can be withdrawn by their insurer at any time.
- On `SETTLED` the cover returns to the insurer (`release(shipmentId)`, callable by anyone once settled).
- On `DEFAULTED` the financier's loss is `drawn` (the principal already paid to the exporter and not recovered);
  `claim(shipmentId)` pays the financier `min(cover, loss)` and returns the remainder to the insurer. Callable by
  anyone once defaulted; pays once.
- The pool reads facility state from the controller and vault through their interfaces; it has no role in the vault
  and cannot touch escrowed capital. Invariants: the pool's USDG balance equals the sum of open offers and accepted
  covers; a cover pays out at most once; total paid on a cover never exceeds it.

## Tests and tooling

Foundry unit, fuzz and invariant tests for every new path; the existing suites updated for the new structs; the
deploy script deploys and wires `CoverPool` and writes it to the manifest; `make check` green; a Slither pass with
the triage noted in `docs/security/`.
