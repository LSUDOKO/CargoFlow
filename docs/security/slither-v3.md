# Static analysis: Slither triage for contracts v3

Command: `make slither` (Slither 0.11.x, config `contracts/slither.config.json`: dependencies, tests, scripts,
mocks, the generated verifier and the sibling projects `contracts/confidential/` and `contracts/hedge/` are out
of scope; informational detectors excluded). Scope of the change: `DeviceRegistry.sol`, `EBLRegistry.sol`, and
the v3 additions to `FinancingController`, `ReceivableVault`, `EvidenceRegistry` and `CoverPool` (design:
`docs/superpowers/plans/2026-10-03-platform.md`, "Contracts v3"; summary in `docs/architecture.md`).

Result: **13 findings, 0 high-impact; 5 new, all reviewed, none requiring a further change.**

## New findings

| Detector | Location | Verdict | Reasoning |
|---|---|---|---|
| `arbitrary-send-erc20` | `FinancingController.bindTitle` (`EBL.transferFrom(f.exporter, this, tokenId)`) | False positive | `from` is not arbitrary: the function first requires `msg.sender == f.exporter` and that the exporter owns the token; the exporter must also have approved the controller. Same pattern as the v1 vault findings. |
| `incorrect-equality` | `CoverPool.rescue` (`amount == 0`) | False positive | Only decides whether there is anything to sweep (`NothingToRescue`); no balance can be manipulated to make a strict equality dangerous, and the amount is bounded to the untracked excess. |
| `calls-loop` (x2) | `CoverPool._requireConsecutiveFailures` (`EVIDENCE.getEpoch`, `EVIDENCE.epochOrdinal`) | Accepted | The loop is bounded by `MAX_TRIGGER_EPOCHS = 32` (fixed at offer time), the callee is the immutable, trusted `EvidenceRegistry` read through the controller, and the calls are views. A revert (unknown epoch) only fails the trigger call itself. |
| `timestamp` | `FinancingController.cancelFacility` (`block.timestamp < financedAt + CANCEL_TIMEOUT`) | Accepted | A 14-day window; validator timestamp drift (seconds) is irrelevant. |

`DeviceRegistry` and `EBLRegistry` produce no finding at low impact or above.

## Unchanged from v2 (see `slither-v2.md`)

`arbitrary-send-erc20` on `ReceivableVault.deposit` / `settle`, `incorrect-equality` and `timestamp` on
`EvidenceRegistry.getEpoch`, `uninitialized-local` on `FinancingController.createFacility` (`committed`) and
`EvidenceEngineSol.fuseEpoch` (`acc`), `timestamp` on `EvidenceRegistry.commitEpoch` and
`FinancingController._requireEvidencePasses`: same verdicts as before.

## What the new code relies on instead

- **Additivity.** No v2 signature changed and enum values were only appended. The v2 unit tests pass with one
  fixture change (the controller constructor's 7th argument); the two invariant handlers were extended with
  the v3 actions.
- **Title escrow.** Bills move with `transferFrom`, never `safeTransferFrom`, so no recipient code runs during
  settle / default / cancel (no reentrancy, no blocking by a contract buyer or financier). All controller entry
  points are `nonReentrant`. Escrowed bills cannot be moved, surrendered or voided by anyone but the controller
  (`test_escrowedTitleCannotBeMovedBySomeoneElse`).
- **Cancellation.** Allowed only before transit, so `drawn == 0` by construction, and the vault re-checks it
  (`CannotCancel`). The protocol invariant handler now cancels at random and checks that only the two parties
  succeed, only before transit, and that the refund equals the deposit.
- **Parametric cover.** Consecutiveness comes from per-shipment commit ordinals written by the registry itself,
  so a compliant epoch cannot be skipped; epochs committed before acceptance are excluded (no insuring a known
  loss); the split is computed so payout + salvage + remainder == cover. Pull payments as in v2. The CoverPool
  invariant campaign now includes parametric offers, failing epochs, guided triggers, cancellation, stray USDG
  and rescues; a scripted reachability test (`test_handlerReachesV3Paths`) proves each path is reachable.
- **Rescue.** Admin-only (`DEFAULT_ADMIN_ROLE` of the access contract, two-step transfer), bounded by
  `untrackedUsdg()`; the invariant asserts `untrackedUsdg() == stray` after every call.
- **Circuit breaker.** OpenZeppelin `Pausable` on new-risk entry points only; exits are deliberately not
  guarded and tests exercise every exit while paused (`test/core/CircuitBreaker.t.sol`).
- **Smart accounts.** No `tx.origin`; tests drive the exporter and buyer through a contract account with a
  separate submitting EOA (`test/integration/SmartAccountCallers.t.sol`).

Trust assumptions that remain: the evidence worker's `compliant` verdict drives parametric payouts (as it
already drives releases); carriers are vetted off chain before `CARRIER_ROLE` is granted; the eBL model is
designed around MLETR concepts and is not a legal compliance claim.

Not an audit. See `SECURITY.md`.
