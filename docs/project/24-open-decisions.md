# Open Decisions, Risks, and Questions

## 1. Network placement of Stylus

**Decision:** do not assume Stylus on Robinhood Chain.

**Action:** build Solidity core on Robinhood; validate a minimal Stylus contract on Arbitrum Sepolia.

## 2. Hash function consistency

**Question:** Should the telemetry commitment use SHA-256 or Poseidon?

**Recommendation:**

- MVP operational commitment: SHA-256 is simple.
- ZK production path: use Poseidon where the circuit proves the corresponding commitment.

Do not claim one commitment root is simultaneously a SHA-256 and Poseidon root.

## 3. Evidence score calibration

Current source values such as 94, 96, 48, 89, 95, 98 are demo scenario values, not a statistically validated model.

**Action:** implement deterministic formulas first, then run synthetic calibration experiments.

## 4. Dempster-Shafer scaling

The supplied Rust example uses integer scaling. A production implementation should avoid overflow and document scale factors.

**Action:** create property tests for sum-of-masses and normalization.

## 5. Partial release policy

The source design permits proportional releases. The MVP should stay binary.

**Action:** future branch only after risk tests.

## 6. AI authority

**Decision:** advisory + bounded pause/request only.

**Never:** direct arbitrary token transfer.

## 7. Settlement fee model

**MVP:** fixed basis points parameter.

**Future:** utilization/time-based fee if economic modeling supports it.

## 8. Dispute resolver

**MVP:** trusted verifier / admin-controlled resolution path.

**Future:** multi-attestor or arbitration mechanism.

## 9. Real IoT vs simulation

**MVP:** deterministic synthetic telemetry.

**Future:** real device integration after protocol correctness is established.

## 10. Legal status

Do not market CargoFlow as a live financial institution or as automatically enforceable trade-finance documentation in all jurisdictions.

The protocol is a technical prototype.

## 11. Testnet assumptions

Testnet USDG has no financial value. Testnet contracts are disposable and may change.

Always load current contract addresses from official Paxos documentation before deployment.

## 12. Must-measure benchmarks

Before making technical performance claims, measure:

- Solidity evidence computation gas;
- Stylus evidence computation gas;
- ZK proof generation latency;
- ZK verification gas;
- epoch ingestion throughput;
- UI transaction-to-update latency.
