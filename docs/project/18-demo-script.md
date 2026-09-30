# 5–7 Minute Demo Script

## Demo objective

Show one financial story, not ten disconnected features.

## Scene 0 — 20 seconds

Headline:

> "Traditional financing sees documents. CargoFlow sees whether the cargo is still behaving like the financing contract expects."

Show:

- shipment;
- USDG facility;
- milestone timeline.

## Scene 1 — 45 seconds: Create shipment

Create:

`CF-2026-SG01`

Synthetic cargo:

`20,000 kg frozen mango pulp`

Invoice:

`100,000 USD`

Facility:

`40,000 USDG`

Policy:

`2°C–8°C`

Five tranches:

`8,000 USDG each`

## Scene 2 — 45 seconds: Fund facility

Financier deposits 40,000 USDG.

Show on dashboard:

```text
FINANCED
Escrow: 40,000 USDG
Drawn: 0 USDG
```

## Scene 3 — 60 seconds: Normal milestones

M1:

- sensor 1: 4.8°C
- sensor 2: 5.1°C
- evidence: 94
- release: 8,000 USDG

M2:

- stable temperature
- evidence: 96
- release: another 8,000 USDG

Show cumulative:

`16,000 USDG drawn`

## Scene 4 — 60 seconds: Failure

Inject sensor sequence:

`5.2 → 6.8 → 8.9 → 10.4 → 11.7°C`

Dashboard:

```text
CRITICAL
Evidence score: 48
Conflict: 0.78
Facility: PAUSED
M3 release: BLOCKED
```

Attempt the third tranche.

The transaction reverts because the controller is paused.

This is the key "finance reacts to physics" moment.

## Scene 5 — 75 seconds: Recovery

Reveal that the primary probe was positioned incorrectly.

Secondary core probe:

`4.5, 4.6, 4.6, 4.7°C`

Generate ZK proof.

Show:

```text
Context: VERIFIED
Bounds: VERIFIED
Commitment: VERIFIED
Raw data: NOT REVEALED
```

Then:

`PAUSED → ACTIVE`

M3 delayed tranche releases:

`8,000 USDG`

## Scene 6 — 45 seconds: Delivery

M4 and M5 clear.

Total drawn:

`40,000 USDG`

## Scene 7 — 45 seconds: Settlement

Buyer pays:

`100,000 USDG`

Waterfall:

- `40,000` principal → financier
- `1,200` fee → financier
- `58,800` residual → exporter

Status:

`SETTLED`

## Scene 8 — 30 seconds: Why this matters

Final slide:

```text
CargoFlow is not a tracker.
It is a financing state machine controlled by verifiable physical evidence.
```

Then display:

`Robinhood Chain + USDG + ZK + multi-sensor evidence + bounded AI`

## Judge proof checklist

During the demo, make sure the judge can visibly see:

- actual Robinhood testnet transactions;
- USDG token movement;
- contract state transition;
- pause transaction;
- proof verification transaction or receipt;
- resumed tranche;
- final settlement;
- source code / contract verification link.
