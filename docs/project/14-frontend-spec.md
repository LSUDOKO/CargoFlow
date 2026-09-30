# Frontend Product and UX Specification

## 1. UI goal

The dashboard should make a judge understand the entire system in seconds:

`Shipment → Evidence → Risk → Capital → Proof → Settlement`

## 2. Pages

### A. Landing / protocol overview

Show:

- one-line problem;
- live demo CTA;
- USDG / Robinhood Chain badges;
- evidence-to-finance flow.

### B. Exporter portal

Cards:

- active shipments;
- available capital;
- facility status;
- latest evidence score;
- latest proof.

Actions:

- register shipment;
- upload invoice commitment;
- view milestone history;
- view pause reason;
- submit secondary proof.

### C. Financier portal

Show:

- committed capital;
- drawn capital;
- remaining exposure;
- shipment risk;
- evidence score;
- upcoming milestone;
- facility fee;
- settlement projection.

### D. Live shipment screen

The hero screen.

Left:

- route map;
- milestone timeline.

Center:

- temperature chart;
- sensor agreement;
- current evidence score.

Right:

- financing gauge;
- USDG escrow;
- drawn amount;
- current state.

Bottom:

- proof / Merkle / transaction audit log.

## 3. State colors

Use semantic colors, but define them consistently in the design system:

```text
ACTIVE       → positive
PAUSED       → warning/critical
DISPUTED     → review
SETTLED      → completed
```

## 4. Anomaly UX

When anomaly appears:

```text
┌─────────────────────────────────────────┐
│ CRITICAL — FINANCING PAUSED             │
│ Primary sensor: 11.7°C                  │
│ Allowed range: 2.0–8.0°C                │
│ Conflict factor: 0.78                   │
│                                         │
│ [ View Evidence ] [ Generate Recovery ] │
└─────────────────────────────────────────┘
```

## 5. Recovery UX

After proof submission:

```text
Proof received
        ↓
Context verified
        ↓
Range verified
        ↓
Merkle commitment verified
        ↓
Financing resumed
        ↓
8,000 USDG released
```

## 6. Audit drawer

Each event should show:

- timestamp;
- actor;
- contract;
- function;
- transaction hash;
- relevant commitment/proof hash;
- before/after state.

## 7. Wallet UX

Support:

- MetaMask or WalletConnect-compatible flow;
- Robinhood Chain Testnet;
- token balance visibility;
- one-click network switch where wallet supports it.

## 8. Tech recommendation

Suggested stack from the source design:

- Next.js;
- React;
- TypeScript;
- Tailwind CSS;
- wagmi;
- viem;
- WebSocket client.

Keep blockchain reads typed and cached.

## 9. Judge-mode demo switch

Add a hidden/demo-only control:

```text
Scenario:
[Normal] [Thermal Excursion] [Recovery Proof]
```

This makes the demo reproducible without changing smart-contract logic.
