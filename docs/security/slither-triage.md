# Static analysis: Slither triage

Command: `make slither` (Slither 0.11.x via `uv tool install slither-analyzer`, config in
`contracts/slither.config.json`: dependencies, tests, scripts, mocks and the generated verifier are out of scope).

Result on the core contracts: **7 findings, 0 high-impact, none requiring a code change.** Each is explained
below so the report can be re-run and compared; a new finding that is not in this table needs a fresh look.

| Detector | Location | Verdict | Why |
|---|---|---|---|
| `arbitrary-send-erc20` | `ReceivableVault.deposit` (`transferFrom(f.financier, ...)`) | False positive | `deposit` is `onlyRole(CONTROLLER_ROLE)`. The only caller, `FinancingController.depositCapital`, reverts with `NotFinancier` unless `msg.sender == f.financier`, so tokens move only from the account that initiated the call, using its own allowance. The vault cannot be driven by anyone else. |
| `arbitrary-send-erc20` | `ReceivableVault.settle` (`transferFrom(f.payer, ...)`) | False positive | Same shape: controller-only, and `FinancingController.settle` reverts with `NotBuyer` unless `msg.sender == f.buyer`. Nobody can pull the buyer's allowance on their behalf. |
| `incorrect-equality` | `EvidenceRegistry.getEpoch` (`committedAt == 0`) | Accepted | A zero commit time is the "never committed" sentinel; `commitEpoch` sets it to `block.timestamp`, which is never zero on a live chain. It is an existence check, not a balance check an attacker could nudge. |
| `uninitialized-local` | `FinancingController.createFacility` (`committed`) | Accepted | An accumulator that is intentionally summed from zero across the milestone loop. |
| `timestamp` | `EvidenceRegistry.commitEpoch` | Accepted | The `endTime <= block.timestamp` check rejects evidence from the future. Validators can skew a timestamp by seconds, while epochs span minutes. |
| `timestamp` | `EvidenceRegistry.getEpoch` | Accepted | Same sentinel as above. |
| `timestamp` | `FinancingController._requireEvidencePasses` | Accepted | The freshness window (`maxEvidenceAgeSec`) is policy-defined in minutes to hours; second-level skew cannot make stale evidence fresh in any way that matters. |

What Slither does **not** replace: the 170-test Foundry suite including the I1-I8 invariant tests, the circuit
negative tests, and the real-proof integration test. It is also not an audit. See `SECURITY.md` and the
testnet-only warning on the single-party trusted setup.
