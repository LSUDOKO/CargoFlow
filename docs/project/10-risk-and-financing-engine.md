# Risk and Financing Engine

## 1. Six-factor risk model

The supplied design uses this starting weight set:

| Dimension | Weight |
|---|---:|
| Shipment physical risk | 0.25 |
| Evidence conflict risk | 0.20 |
| Counterparty risk | 0.20 |
| Operational corridor risk | 0.15 |
| Provider reputation risk | 0.10 |
| Fraud / synthesis risk | 0.10 |

Weights sum to 1.00.

These are starting governance parameters, not empirically validated credit weights.

## 2. Risk model

Define normalized dimensions:

```text
Rphysical
Rconflict
Rcounterparty
Rcorridor
Rprovider
Rfraud ∈ [0,1]
```

Then:

```text
R =
  0.25 Rphysical +
  0.20 Rconflict +
  0.20 Rcounterparty +
  0.15 Rcorridor +
  0.10 Rprovider +
  0.10 Rfraud
```

## 3. Dynamic financing capacity

A future capacity function can be represented as:

```text
capacity(t) = min(
    committedFacility,
    invoiceValue × advanceRate × EvidenceTransfer(E(t)) × RiskPenalty(R(t))
)
```

Important safety rule:

> **Capacity may decrease continuously; released funds are never clawed back automatically by the MVP.**

This avoids turning a noisy sensor into an immediate reverse-transfer mechanism.

## 4. Milestone release policy

Simple MVP rule:

```text
if evidenceScore >= threshold
and riskScore <= maxRisk
and conflict <= maxConflict
and milestone not released
then release exact tranche
else keep funds in vault
```

## 5. Partial release

The research design permits proportional release below the threshold. For the first version, do **not** enable partial release. Binary behavior is safer and easier to explain:

`PASS → exact tranche`

`FAIL → zero tranche`

After this is tested, introduce partial release with a hard minimum and maximum.

## 6. Safety buffer

Reserve a configurable fraction of the committed facility as a safety buffer for unexpected events or fee obligations.

Example:

```text
40,000 USDG committed
4,000 USDG safety reserve
36,000 USDG immediately allocatable
```

For the hero demo, a zero buffer may be used for simplicity, but the UI should expose the concept.

## 7. Financing fee

The source demo uses 3% of the 40,000 USDG drawn facility as a flat financing fee:

```text
40,000 × 0.03 = 1,200 USDG
```

This is a demo parameter, not a recommended real-world financing rate.

A production design should define whether fees are:

- flat;
- annualized simple rate;
- day-count based;
- milestone based;
- utilization based.

## 8. Default waterfall

If a shipment cannot recover:

1. stop future draws;
2. return undrawn facility balance to financier;
3. preserve evidence and dispute artifacts;
4. apply any explicitly configured recovery collateral or insurance;
5. handle remaining loss according to the facility contract.

Do not invent off-chain legal recovery claims in the MVP.

## 9. Credit safety invariants

```text
I1: totalDrawn <= totalCommitted
I2: releasedMilestones are monotonic
I3: settled facility cannot draw
I4: paused facility cannot draw
I5: disputed facility cannot draw
I6: supplier recipient is immutable after funding
I7: financingFeeBps cannot change after funding unless a governance rule permits it
I8: one milestone cannot release twice
```
