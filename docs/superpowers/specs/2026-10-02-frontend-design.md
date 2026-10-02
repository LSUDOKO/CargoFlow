# CargoFlow Frontend: Design Spec

Status: approved and implemented (plan: `docs/superpowers/plans/2026-10-02-frontend.md`)
Parent spec: [`2026-09-30-cargoflow-design.md`](2026-09-30-cargoflow-design.md) (P6)

## 1. Intent

A complete, branded, working web frontend for CargoFlow, so that a judge, an exporter, a financier and a
buyer can each follow and drive the whole lifecycle in a browser without opening code:

`Shipment → Evidence → Risk → Capital → Proof → Settlement`

**What was asked:**
- A professional product feel taking cues from Tripadvisor: sticky tabbed search/track bar, clean cards,
  bold pill buttons, readable type hierarchy, refined micro-interactions.
- The reference images in `assests/` (Robinhood marketing pages, plus the Logistiqo, QuickChain and Shipora
  logistics landing pages).
- A consistent theme across every page, generated brand assets, and every button, form and tab working
  against the real system.

**Success criteria**
1. Landing, track, fleet, exporter, financier, buyer and demo pages exist, are responsive at 375 / 768 /
   1280 px, and have no axe accessibility violations at serious or critical level.
2. A Playwright run against the real local stack (anvil, backend, built frontend) drives the full story
   through the browser: register → fund → two releases → anomaly pause → ZK recovery → remaining releases
   → delivery → settlement. It ends on the settled waterfall.
3. Every on-chain action is sent from a connected wallet, and its explorer link appears in the UI.
4. `pnpm lint`, `pnpm typecheck` and `pnpm build` pass in CI.
5. Nothing on the page is fake when a backend is reachable. Marketing copy is the only static content, and
   live figures come from the API or the chain.

## 2. Non-goals

- User accounts, email or login beyond wallets.
- A real map tile provider. The route is drawn as SVG on a stylised world outline.
- Mobile apps, i18n, and a CMS.
- Mainnet.
- Copying another brand's identity: the references inform layout and tone, not logos or trade dress.

## 3. Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 16** (App Router, React 19, Turbopack), TypeScript strict | Requested; Vercel-native |
| Styling | Tailwind CSS v4 with CSS-variable design tokens | Tokens shared by Tailwind and inline SVG |
| Chain | wagmi v2 + viem; injected + WalletConnect (project id from `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`) | Typed contract calls; custom on-brand wallet modal instead of RainbowKit |
| Server state | TanStack Query (REST) + one WebSocket hook that invalidates queries on events | Live without polling storms |
| Charts | Hand-rolled SVG (sparklines, gauges, waterfall) | Brand-exact and dependency-free |
| Motion | CSS transitions + `motion` only where it earns it (counters, timeline) | Calm, respects `prefers-reduced-motion` |
| Tests | Vitest (units), Playwright + `@axe-core/playwright` (e2e, a11y) | Real-browser verification |
| Package manager | pnpm | Disk-efficient store |

Contract ABIs come from `contracts/out` through a generator script, so they never drift from the deployed
code. Deployment addresses come from `GET /v1/config`, so one build serves both local and testnet.

## 4. Brand system

**Name and mark.** The CargoFlow logo is a shipping container whose side corrugations become a chain link,
in SVG and paired with a wordmark. A favicon and an OG image are derived from it.

**Colour tokens**

| Token | Hex | Use |
|---|---|---|
| `ink` | `#0B1B2B` | Deep navy base, dark sections, primary text on light |
| `ink-2` | `#13293D` | Raised dark surfaces |
| `paper` | `#F7F9F4` | Light page background (a slight lime-warm white) |
| `signal` | `#C6F432` | Lime: primary CTA and keyword highlight (Robinhood-style marker) |
| `signal-ink` | `#0B1B2B` | Text on lime |
| `verified` | `#00C46A` | Emerald: on-chain confirmed, passing evidence |
| `alert` | `#FFB020` | Amber: pause, anomaly, pending |
| `danger` | `#E5484D` | Failures only |
| `slate` | `#5B6B7B` | Secondary text |
| `line` | `#DCE3DA` | Borders on light |

Contrast is checked at AA for every text and background pair used.

**Type.** Space Grotesk (display: tight leading, 600–700, sizes up to 88 px) / Inter (UI and body) /
JetBrains Mono (hashes, amounts, ids), all via `next/font`.

**Components**
- Pill buttons in three sizes. Primary is lime on ink; secondary is ink outline; ghost.
- Rounded-3xl cards with a `+` corner affordance.
- Highlighted keyword spans (lime marker).
- `HashBadge`: shortened, copyable, links to the explorer.
- `StatusPill`: ACTIVE emerald, PAUSED amber, SETTLED ink, DEFAULTED danger.
- Glass panels used only on dark hero imagery.

**Illustration.** One flat vector style (navy line, lime and amber fills, no gradients):
- the hero (a container ship at a port with a crane and floating "verified" chips);
- six spot illustrations: sensor, Merkle tree, ZK shield, AI monitor, escrow vault, settlement.

They are generated with free Hugging Face image spaces where the result fits the style and hand-built in SVG
where it does not. Every asset lives in `frontend/public/brand/` with its provenance noted in
`frontend/public/brand/README.md`.

## 5. Information architecture

```
/                      Landing
/track/[id]            Shipment dashboard (id = 0x… shipment id; external ref accepted and resolved)
/shipments             Fleet: tabs Active | Paused | Settled | All, search, sort, filter, detail drawer
/exporter              Register-and-finance wizard + my shipments
/financier             Fund facilities, exposure, risk, settlement projection
/buyer                 Confirm delivery, pay invoice
/demo                  Judge mode: scene-by-scene live story
```

Shared: a sticky header with nav, a network/health pill, and the wallet button; a footer; a toast stack;
the wallet modal; a command-style global search (⌘K) that resolves a shipment id or reference.

### Landing (`/`)

1. **Hero:** a giant headline with a lime-highlighted keyword ("Capital that **moves** with your cargo"),
   the subline, the illustrated port scene, and the **tabbed action bar** with three tabs:
   - *Track shipment* (id or reference → `/track`);
   - *Get financing* (→ `/exporter`);
   - *Verify proof* (epoch id → evidence lookup).
2. **Live stats strip:** shipments, USDG under escrow, epochs committed, proofs verified, from `GET /v1/stats`.
3. **How it works:** six Robinhood-style cards with `+` that expand to detail (Sense → Fuse → Commit →
   Release → Pause & Prove → Settle).
4. **Hero story section:** the 40,000 / 100,000 waterfall as an animated stacked bar.
5. **Verifiable by design:** contract cards with verified-source badges and explorer links.
6. **Built on:** Robinhood Chain, USDG, Groth16 and Arbitrum Stylus marks, as text-only marks where the
   brand forbids reuse.
7. **FAQ:** an accordion.
8. **Footer:** testnet disclaimer.

### Shipment dashboard (`/track/[id]`)

- **Header:** reference, status pill, parties (hash badges), invoice and committed amounts, and action
  buttons that appear according to the connected wallet's role.
- **Left:** the route map (SVG, origin → destination, current position from the latest reading) and the
  milestone timeline (5 tranches: released / blocked / next, each with its release transaction).
- **Center:**
  - telemetry charts for both probes against the policy band;
  - evidence score and conflict gauges;
  - a risk breakdown;
  - an epoch list (root, score, decision, commit transaction).
- **Right:** escrow state (drawn / committed / remaining, state-machine stepper), the AI monitor panel
  (latest assessment, confidence, decider), and the ZK proof card (verified epoch, resume transaction).
- **Bottom:** an audit trail table (filterable by kind) with explorer links.
- **Live:** the WebSocket subscribes to the shipment, and events animate in.

### Fleet (`/shipments`)

- Tabs with counts; search by id or reference; sort by created, score, drawn and status; filter chips
  (paused only, has proof, financier = me).
- Each row has a mini sparkline of evidence score.
- Clicking a row opens a detail drawer with the container breakdown (sensors, reading counts, last reading,
  epochs), with "Open dashboard" and "Copy id".
- The list is paginated against `GET /v1/shipments`.

### Role portals

- **Exporter wizard:** a stepped form with validation, one wallet transaction per step, and a progress rail.
  1. Shipment details (reference, buyer, invoice value, route preset).
  2. Policy (temperature band, thresholds, with sensible cold-chain defaults).
  3. Facility (financier address, five milestones and their allocations, fee).
  4. Sign: `registerShipment` → `setPolicy` → `createFacility`. Each step is resumable if one fails,
     because state is read back from the chain.
  5. Mirror to the backend (public mirror endpoint).
  6. Start transit, enabled once funded.
- **Financier:** facilities naming the connected wallet; a fund action (approve + `depositCapital`, showing
  the USDG balance and the required amount); an exposure summary and a settlement projection.
- **Buyer:** facilities naming the connected wallet; `markDelivered`; then approve + `settle` with the
  waterfall preview.

### Judge mode (`/demo`)

- Creates a demo shipment with server-held demo wallets.
- Then offers a scene list, each scene a button that becomes ✓ when its events land:
  1. Fund.
  2. Healthy milestones.
  3. Thermal excursion → pause.
  4. Recovery readings + ZK proof.
  5. Remaining milestones.
  6. Delivery and settlement.
- An embedded live dashboard for the same shipment sits beside the scene list.
- Scale defaults to 1/2000 on testnet, so the faucet USDG is enough.

## 6. Backend additions (Go, TDD)

1. **`POST /v1/shipments/mirror`**
   - Public; rate-limited per IP; body `{shipmentId, externalRef, route, maxGapSec, minSensors}`.
   - Runs the existing `RegisterShipment`, which already refuses anything the chain does not confirm
     (parties, commitments, policy, route, reference).
   - Idempotent: a repeat call returns the existing shipment.
2. **`GET /v1/stats`**
   - Counts by status, total committed and drawn base units, epochs committed, proofs verified.
3. **`DEMO_MODE`**
   - Off by default. When on, it uses `DEMO_EXPORTER_KEY`, `DEMO_FINANCIER_KEY` and `DEMO_BUYER_KEY`, plus
     a server-generated demo evidence source.
   - `POST /v1/demo/shipments` `{divisor}` creates and funds a shipment through the hero runner's steps
     and returns its id.
   - `POST /v1/demo/shipments/{id}/scenes/{scene}` runs one scene: `healthy`, `excursion`, `recover`,
     `finish`, `settle`.
   - Scenes are idempotent: a completed scene returns its recorded result.
   - Rate-limited, and refused unless `DEMO_MODE=true`.
   - Implemented by splitting `internal/hero` into steps, so the e2e test, the CLI and the API share one
     code path.
4. **CORS:** the frontend origin is added via the existing `CORS_ORIGINS`.

## 7. Data flow

- **REST:** `/v1/config` (addresses, chain), `/v1/stats`, `/v1/shipments[/id|/epochs|/audit]` through
  TanStack Query with typed parsers (zod), so a malformed response becomes a visible error, not a crash.
- **WebSocket:** `/v1/ws?shipment=` events invalidate the matching queries; the connection
  reconnects with backoff, and on close code 1013 it refetches.
- **Chain reads:** wagmi `useReadContract` for balances and allowances only. Facility truth comes from the
  backend view, which itself reads the chain.
- **Writes:** wagmi `useWriteContract` → wait for receipt → toast with explorer link → invalidate. Wrong
  network prompts a switch to 46630 (or 31337 locally). Reverts are decoded into human messages using the
  contract custom errors.

## 8. States and errors

Every data view has loading skeletons, an empty state with a next action, and an error state with retry.
Further cases:
- **Backend unreachable:** a banner, and the pages fall back to chain-only reads where possible.
- **Wallet missing:** install / WalletConnect options.
- **Insufficient USDG:** the exact shortfall and a faucet link.
- **Paused facility:** amber banner with the reason and a recovery CTA.
- **Forms:** inline validation and disabled submit while a transaction is in flight. Transactions are never
  sent twice (the button is locked by the pending hash).

## 9. Accessibility and performance

Semantic landmarks, focus rings in lime on ink, keyboard-operable tabs, accordion, drawer and modal (focus
trap, Esc), `aria-live` for toasts and live events, and reduced-motion support.

Performance targets:
- LCP under 2.5 s on the landing page on a local production build;
- hero illustration served as optimised WebP/AVIF via `next/image`;
- no client JS on pure marketing sections (React Server Components).

## 10. Testing

| Layer | What |
|---|---|
| Vitest | formatters (USDG base units, bps, hashes), status mapping, revert decoding, API parsers, the WebSocket reducer |
| Go | mirror endpoint (accepts chain-confirmed, rejects mismatches, idempotent, rate-limited), stats, demo endpoints (off by default, each scene, idempotency) |
| Playwright e2e | full story through the browser on the local stack using injected test wallets (anvil keys via a test-only connector); fleet tabs, sort, filter; track by reference; error states with the backend down |
| a11y | axe on every page |
| CI | new `frontend` job: install, lint, typecheck, unit tests, build; e2e runs in the existing backend job, which already has anvil and Postgres |

## 11. Risks

- **Image generation quality on free models:** mitigated by the SVG fallback with the same palette.
- **Next.js 16 / wagmi compatibility:** pin versions and verify the build early (task 1).
- **Testnet latency in the demo (≈2 min per run):** each scene shows progress and can be resumed.

## 12. Deviations found while building

| Spec said | Built | Why |
|---|---|---|
| Telemetry charts from the API | New `GET /v1/shipments/{id}/telemetry` returning per-epoch per-sensor aggregates | The API deliberately exposes no readings; aggregates keep that rule while making charts possible |
| Illustrations generated with free image models | Hero generated (FLUX.1-schnell); the six spot illustrations hand-drawn as SVG | The generated spots missed the palette and the free GPU quota ran out (spec fallback) |
| OG image as a static PNG | Rendered at build by `next/og` | Always in sync with the brand, no binary to maintain |
| Exporter recomputes shipment id and policy hash | Read from the contracts (`shipmentIdFor`, `hashPolicy`); only the route commitment is recomputed, pinned by a Go vector | No second implementation to drift |
| Backend-down test stops the API | The test aborts API requests in the browser | Deterministic, and identical from the user's side |
