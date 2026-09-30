# CargoFlow backend

Go evidence engine: takes raw shipment telemetry to a policy decision and a cryptographic commitment.
Everything on the decision path is **integer arithmetic** (basis points, fixed-point degrees), so the
same input always produces the same score, root and decision, on any platform.

```
telemetry.Point ─► telemetry.Validator ─► epoch.Processor ─┬► evidence.Evaluate ─► risk.Score ─► decision.Decide
 (fixed-point)     bounds · order ·         8 readings/     │    (Dempster-Shafer,     (6 factors)   (PASS / pause /
                   replay · equivocation    sensor per      │     fraud, route, gaps)                 secondary proof)
                                            epoch           └► merkle.Build (salted Poseidon) ─► root for EvidenceRegistry
```

## Try it

```bash
cd backend
go test ./...
go run ./cmd/cargoflow-sim -scenario conflicting_sensors        # the hero story, epoch by epoch
go run ./cmd/cargoflow-sim -scenario malicious_replay           # replays are quarantined
go run ./cmd/cargoflow-sim -scenario gps_jump -json             # machine-readable
```

| Scenario | What happens | Expected outcome |
|---|---|---|
| `normal` | two healthy probes, realistic ship speed | all epochs PASS, score ~100 |
| `conflicting_sensors` | primary probe climbs 5.2 → 11.7 C, core probe stays 4.5-4.7 C | last epoch: score 48, conflict ~75%, **PAUSE_FACILITY** |
| `thermal_excursion` | both probes overheat | not compliant, score 56, pause |
| `sensor_detached` | core probe goes silent halfway | coverage penalty, still passes |
| `stale_packets` | one hour of silence | freshness penalty |
| `gps_jump` | position teleports ~556 km in one interval | fraud + route penalties, pause |
| `malicious_replay` | old valid packets re-injected | rejected at ingestion, committed roots unchanged |

Runs are reproducible: the same `-seed` gives byte-identical output.

## Packages

| Package | Responsibility |
|---|---|
| `internal/telemetry` | `Point` (fixed-point), stateless validation, stateful ordering / replay / equivocation gate |
| `internal/simulator` | seeded, deterministic scenario generator |
| `internal/geo` | integer-only distance and point-to-route deviation |
| `internal/evidence` | per-reading mass, Dempster-Shafer `Combine` with conflict factor, fraud signals, 0-100 score |
| `internal/risk` | six-factor risk model (0.25 / 0.20 / 0.20 / 0.15 / 0.10 / 0.10) |
| `internal/merkle` | Poseidon Merkle tree (circomlib-compatible), salted reading leaves |
| `internal/epoch` | ties the above into closed, committed epochs |
| `internal/decision` | policy gate: approve, request secondary proof, or pause, with reason codes |

## The evidence score

```
score = clamp(100 - physical - conflict - freshness - route - source - fraud - coverage, 0, 100)
```

| Penalty | Points (cap) | Driven by |
|---|---|---|
| physical | up to 60 | worst per-sensor defect mass, fused uncertainty, fraction of readings outside the band |
| conflict | up to 40 | worst per-step Dempster-Shafer conflict `K` between sources |
| freshness | up to 20 | longest silence between a sensor's readings vs policy |
| route | up to 15 | distance from the planned route vs policy |
| source | up to 10 | least reliable sensor |
| fraud | up to 40 | frozen sensor (15), impossible speed (25), cloned streams (30) |
| coverage | up to 15 | fewer sensors than the policy requires, or sensors missing from some time steps |

Conflict is taken as the **worst step**, not the epoch average, so a short excursion cannot be averaged away.
Dempster normalisation alone would hide a contradiction (two disagreeing sensors can fuse to a confident
result), which is why conflict is reported and penalised separately, and why the controller gates on it.

> **Calibration status:** the weights and caps are explicit design parameters, **not** statistically
> validated. The docs list calibration as an open item; change them in `internal/evidence/score.go` and the
> tests will show exactly what moves.

## Commitments (the contract with the circuit)

Each epoch's readings are sorted by `(timestamp, sensorId)` and committed as a Poseidon Merkle tree
padded with zero leaves to a power of two. A leaf is:

```
leaf = Poseidon(timestamp, sensorField, temp + 10000, humidity, lat + 90e6, lon + 180e6, shock, salt)
```

- `sensorField` = first 31 bytes of `SHA-256(sensorId)` (always below the BN254 modulus)
- `salt` = first 31 bytes of `HMAC-SHA256(secret, shipmentId || len(sensor) || sensor || timestamp)`, so a
  public root cannot be brute-forced back into "4.6 C"
- Poseidon is the BN254 instance from circomlib; `TestPoseidonMatchesCircomlibTestVector` pins it
- the 32-byte big-endian root is what `EvidenceRegistry.commitEpoch` stores

The P3 circuit must hash leaves with exactly this field order and offsets.

## Limits of what this proves

Sensor honesty is out of scope: a valid commitment or proof says the committed readings satisfy the
statement, not that the probe was telling the truth. Trust comes from source credentials, reliability
weighting, multi-sensor conflict detection and (later) challenges. Sensor authentication arrives with
the API in P4; today ingestion checks plausibility, ordering and replay only.
