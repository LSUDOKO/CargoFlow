# Evidence Engine

## 1. Objective

The evidence engine turns messy physical observations into a deterministic, explainable signal that the financing controller can consume.

## 2. Input model

```text
TelemetryPoint {
  timestamp
  sensor_id
  temperature_x100
  humidity_x100
  latitude_e6
  longitude_e6
  shock_x100
  signature / source credential
}
```

Use fixed-point integers on-chain. Avoid floating-point arithmetic in Solidity.

## 3. Sensor evidence model

For a simple two-state frame:

```text
Θ = {COMPLIANT, DEFECTIVE}
```

Each sensor produces a basic probability assignment:

```text
m(COMPLIANT)
m(DEFECTIVE)
m({COMPLIANT, DEFECTIVE})  ← uncertainty
```

The uncertainty mass can absorb stale, low-resolution, or degraded readings rather than forcing every reading into a binary conclusion.

## 4. Dempster-Shafer combination

For two independent evidence sources, Dempster's rule combines compatible masses and normalizes by the conflict:

```text
K = Σ m1(A) · m2(B)  for A ∩ B = ∅

m12(C) = [Σ m1(A)m2(B) for A ∩ B = C] / (1-K)
```

`K` is the conflict factor.

When `K` is high, do not blindly normalize and release capital. Instead:

- lower confidence;
- pause if policy threshold is crossed;
- request secondary proof.

## 5. Example

Sensor 1:

```text
Compliance = 0.85
Defect      = 0.05
Uncertainty = 0.10
```

Sensor 2:

```text
Compliance = 0.80
Defect      = 0.08
Uncertainty = 0.12
```

These observations reinforce compliance.

Now consider:

Sensor 1:

```text
Compliance = 0.90
Defect      = 0.02
```

Sensor 2:

```text
Compliance = 0.05
Defect      = 0.90
```

Conflict becomes high. A robust policy should pause rather than choose the average.

## 6. Evidence score

A practical MVP score can be defined as:

```text
base = 100
physicalPenalty = f(temperature, humidity, shock)
conflictPenalty = g(K)
freshnessPenalty = h(gap)
routePenalty = j(routeDeviation)
sourcePenalty = q(providerReliability)
fraudPenalty = r(syntheticAnomalySignals)

score = clamp(
  base
  - physicalPenalty
  - conflictPenalty
  - freshnessPenalty
  - routePenalty
  - sourcePenalty
  - fraudPenalty,
  0,
  100
)
```

This formula is intentionally explicit rather than hiding the policy inside an opaque model.

## 7. Source reliability

A provider should have a context-dependent reputation record:

```text
providerId
sensorType
corridor
historicalObservations
verifiedObservations
challengeWins
challengeLosses
uptime
lastSeen
reliabilityScore
```

The same provider may have different reliability in temperature sensing versus GPS telemetry.

## 8. Evidence diversity

A future `EvidenceDiversityScore` should estimate how independent the evidence sources are.

Example dimensions:

- different manufacturer;
- different communication path;
- different physical placement;
- different organization;
- different cryptographic key.

Two sensors from the same device cluster should not count as two fully independent sources.

## 9. Fraud / synthetic telemetry detection

Detect patterns such as:

- identical repeated readings;
- impossible velocity;
- sudden GPS jumps;
- timestamp backdating;
- packet replay;
- frozen sensor values;
- periodic patterns inconsistent with physical noise;
- identical telemetry from multiple supposedly independent devices.

## 10. Epoch design

For the demo:

- 8 readings = 1 compact evidence epoch.
- Production concept: e.g. hourly batches from minute-level raw samples.

Each epoch stores:

- root;
- start/end timestamp;
- reading count;
- source IDs;
- min/max values;
- compliance flag;
- evidence score;
- conflict factor;
- optional ZK proof metadata.

## 11. Stylus module

The source design proposes `EvidenceEngine.rs` for compute-heavy fusion. Use Stylus only where the target chain supports it.

Recommended split:

- Solidity: financial state + high-value invariant enforcement.
- Rust/Stylus: compute-heavy evidence experiment on Arbitrum Sepolia.
- Go: ingestion, simulation, proof orchestration.
