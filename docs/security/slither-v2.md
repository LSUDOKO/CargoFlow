# Static analysis: Slither triage for contracts v2

Command: `make slither` (Slither 0.11.x, config `contracts/slither.config.json`: dependencies, tests, scripts,
mocks and the generated verifier are out of scope; informational detectors excluded). Scope of the change:
`CoverPool.sol`, `libraries/GeoDistance.sol`, and the v2 edits to `EvidenceRegistry`, `PolicyEngine` and
`FinancingController` (design: `docs/superpowers/plans/2026-10-03-contracts-v2.md`).

Result: **8 findings, 0 high-impact, none in the new code, none requiring a further change.**

## New findings

| Detector | Location | Verdict | Action |
|---|---|---|---|
| `uninitialized-state` | `FinancingController._milestones` "never initialized" | False positive, removed | The first v2 run reported it: `createFacility` wrote the array through a local storage alias (`MilestoneSpec[] storage stored = _milestones[id]; stored.push(m)`) and the new `placeCheck` view reads it, which Slither does not connect. The push now goes through the mapping directly (`_milestones[shipmentId].push(m)`), identical behaviour, and the finding is gone. |

`CoverPool` and `GeoDistance` produce no finding at low impact or above. With informational detectors enabled
the only output for them is `naming-convention` on `CoverPool.CONTROLLER` / `VAULT` / `USDG`, which follow the
existing immutable-in-capitals convention used by every other contract here.

## Unchanged from v1 (see `slither-triage.md`)

| Detector | Location | Verdict |
|---|---|---|
| `arbitrary-send-erc20` | `ReceivableVault.deposit`, `ReceivableVault.settle` | False positive (controller-only, caller identity checked) |
| `incorrect-equality` | `EvidenceRegistry.getEpoch` (`committedAt == 0`) | Accepted (existence sentinel) |
| `uninitialized-local` | `FinancingController.createFacility` (`committed`) | Accepted (accumulator from zero) |
| `timestamp` | `EvidenceRegistry.commitEpoch`, `EvidenceRegistry.getEpoch`, `FinancingController._requireEvidencePasses` | Accepted (minute-scale windows; the v2 signature change only renames the location) |

One further `uninitialized-local` on `EvidenceEngineSol.fuseEpoch` (`acc`) comes from
`src/experimental/`, which predates v2, is not deployed and is not part of this change; it is an accumulator
summed from zero.

## What the new code relies on instead

- `CoverPool`: `SafeERC20` for every transfer, `nonReentrant` on every mutating function, state written before
  each token call, pull-based payouts (`withdraw`) so a frozen or reverting recipient can never block the other
  party, and a balance-delta check that refuses a fee-on-transfer token (`UnsupportedToken`). USDG is assumed to
  be a plain 6-decimal ERC-20. The pool holds no role (`test_poolHoldsNoProtocolRole`,
  `test_coverPoolIsWiredAndHoldsNoRole`), so it has no path to the vault's escrow. Its three invariants (balance
  equals open offers + active covers + credited payouts; a cover pays at most once; payout + return equals the
  cover and the financier's share never exceeds its loss) run under a handler-based fuzz campaign
  (`test/invariant/CoverPool.invariants.t.sol`, 256 runs x 128 calls per invariant, zero handler reverts).
- `GeoDistance`: integer-only, no assembly, uint256 intermediates in micrometres that cannot overflow for any
  in-range input (`testFuzz_neverRevertsAndIsBounded`); accuracy bound stated in NatSpec and checked against 65
  embedded haversine reference vectors plus a fuzz campaign over rotated / mirrored / swapped references.
- Place and limit checks: coordinates are range-checked at both entry points (`createFacility`, `commitEpoch`);
  the place check runs after the policy so `OutsideMilestonePlace` always means healthy evidence in the wrong
  place, never a masked policy failure.

Not an audit. See `SECURITY.md`.
