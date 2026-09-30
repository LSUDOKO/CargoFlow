# Testing and Verification Plan

## 1. Testing pyramid

```text
Unit tests
   ↓
Contract invariant / fuzz tests
   ↓
Backend integration tests
   ↓
ZK circuit tests
   ↓
End-to-end local tests
   ↓
Public testnet smoke tests
```

## 2. Solidity unit tests

Test:

- shipment creation;
- facility creation;
- funding;
- allowance failures;
- release success;
- release over committed amount;
- duplicate milestone;
- pause;
- resume;
- settlement;
- unused capital refund.

## 3. Fuzz / invariant tests

### Invariant A

`drawn <= committed`

### Invariant B

A milestone releases at most once.

### Invariant C

No transfer can target an unregistered supplier.

### Invariant D

A paused or settled facility cannot release.

### Invariant E

The vault never transfers more USDG than its balance.

## 4. Evidence tests

Create synthetic scenarios:

| Scenario | Expected |
|---|---|
| Two healthy sensors | High score |
| One hot sensor / one healthy | High conflict → pause/review |
| Both hot | Physical failure → pause |
| One stale sensor | Penalize freshness |
| GPS jump | Fraud/anomaly flag |
| Replayed packet | Reject |
| Wrong timestamp order | Reject or quarantine |
| Valid recovery proof | Resume |
| Invalid recovery proof | Stay paused |

## 5. ZK tests

Prove:

- all values in range → success;
- one below range → failure;
- one above range → failure;
- wrong policy hash → failure;
- wrong nonce → failure;
- wrong shipment ID → failure;
- wrong Merkle root → failure;
- valid proof on-chain → success.

## 6. End-to-end test

Run exactly the hero scenario locally:

```text
register shipment
→ fund 40k USDG
→ release M1
→ release M2
→ inject thermal anomaly
→ verify on-chain pause
→ produce secondary ZK proof
→ resume
→ release M3
→ release M4
→ release M5
→ settle 100k
```

Expected final values:

```text
facility committed: 40,000 USDG
facility drawn:     40,000 USDG
principal repaid:   40,000 USDG
fee:                 1,200 USDG
exporter residual:  58,800 USDG
status:             SETTLED
```

## 7. Testnet smoke checklist

- correct chain ID;
- correct USDG address;
- wallet funded with gas;
- USDG faucet balance received;
- token decimals checked on-chain;
- contracts verified;
- approval works;
- funding works;
- release works;
- pause works;
- proof verification works;
- settlement works.

## 8. Benchmark plan

Measure, do not assume:

- gas per milestone release;
- gas per evidence commit;
- ZK verification gas;
- proof generation time;
- backend epoch throughput;
- WebSocket end-to-end latency.

If comparing Stylus vs Solidity, use the same inputs, same algorithm, same compiler constraints, and report exact measured results.
