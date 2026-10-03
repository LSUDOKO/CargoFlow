# CargoFlow v2: expected footage

The v2 film (`FullV2`, `src/scenes-v2`) plays a screen recording in each slot below when
`public/footage/<shot id>.mp4` exists **and** is listed in `public/footage/manifest.json`.
After adding or replacing files, run:

```
node scripts/footage-manifest.mjs
```

Until then each slot shows a marked "RECORDING PLACEHOLDER" card with the shot id, its length and
what must be on screen. Click paths, accounts and setup are in `SCRIPT-v2.md`, shot lists R1-R4.

**Format.** 1920 x 1080, 30 fps CFR, H.264 `.mp4`, light theme, clean Chrome profile, no audio needed
(the film's mix carries VO + music; slots are muted). Trim each clip so the action starts at 0 s and
lasts the planned duration; +1 s handle at the tail is fine. If a clip has to start late, set
`trimBefore` (seconds) on the shot in `src/scenes-v2/S06Demo.tsx` / `S07Claude.tsx` / `S10Proof.tsx`.
Speed-ramp wallet and proving waits to under 0.5 s; never fake a state the app did not reach.

**Punch-ins.** Each slot has punch-ins (1.4-1.7x, 12 f ease) timed to the voice-over. Their regions
are first guesses in normalised coordinates (`cx`, `cy`); after recording, adjust them in the scene
file so they land on the UI element named in the label. The placeholder draws each region as a
dashed box, so their timing can be reviewed now.

## R1 · live website (S06, 3:24.0-4:26.0, frames 6120-7979)

| Shot id | File | Scene / film frames | Planned duration | Must be on screen |
|---|---|---|---:|---|
| R1-01 | `public/footage/R1-01.mp4` | S06 D1 · 6120-6239 | 4.0 s | `/` landing hero; header with network + health pill; one scroll notch to the track bar |
| R1-02 | `public/footage/R1-02.mp4` | S06 D2 · 6240-6509 | 9.0 s | `/exporter` wizard: Shipment → Cold-chain policy (Pharma template chip, 2-8 °C, humidity, shock) → Financing (I have a financier, 20 / 5 / 3%, hint "5 tranches of about 4 USDG") → Sign; three wallet confirmations at 6x; three ticks + toasts |
| R1-03 | `public/footage/R1-03.mp4` | S06 D3 · 6510-6659 | 5.0 s | `/financier` facility card with settlement preview (financier 20.6, exporter 9.4); Approve 20 USDG → Deposit 20 USDG; toast "Facility funded" |
| R1-04 | `public/footage/R1-04.mp4` | S06 D4 · 6660-6869 | 7.0 s | `/ebl` Issue a bill (document fingerprint, named consignee) → "Bill of lading issued" / bill page; then the shipment title card: Bind bill of lading → "In escrow" |
| R1-05 | `public/footage/R1-05.mp4` | S06 D5 · 6870-7079 | 7.0 s | Start transit; Submit readings (`leg-1-healthy.csv`) result table with two "Passed: milestone released"; map with live position; M1, M2 released |
| R1-06 | `public/footage/R1-06.mp4` | S06 D6 · 7080-7289 | 7.0 s | `leg-2-excursion.csv` out-of-band warning → "Failed: facility paused"; amber Paused pill; temperature chart with probe-1 above 8 °C; ExplainPanel "Where it stands" + "What each party does now" |
| R1-07 | `public/footage/R1-07.mp4` | S06 D7 · 7290-7499 | 7.0 s | Bell "Proof ready" → Review and sign → Resume with a proof → "Facility resumed by zero-knowledge proof"; proof card "Groth16 proof verified on-chain"; pill Active |
| R1-08 | `public/footage/R1-08.mp4` | S06 D8 · 7500-7718 | 7.3 s | Wei Lin: Continue with passkey → Sign in with an existing passkey → OS passkey sheet; passkey account chip; Confirm delivery; Approve 30 / Pay; "Invoice paid and settled"; Settled pill; title card "With the buyer" |
| R1-09 | `public/footage/R1-09.mp4` | S06 D9 · 7719-7823 | 3.5 s | Download certificate → settlement certificate PDF open in the browser viewer, scroll once |
| R1-10 | `public/footage/R1-10.mp4` | S06 D10 · 7824-7979 | 5.2 s | `/market` open requests; `CF-SG-VAX-MKT1` → Review offers → offer modal with the Suggested fee band (low / mid / high with reasons) |

## R2 · claude.ai MCP (S07, 4:26.0-4:46.0, frames 7980-8579) · recorded by the lead

| Shot id | File | Scene / film frames | Planned duration | Must be on screen |
|---|---|---|---:|---|
| R2-01 | `public/footage/R2-01.mp4` | S07 M1 · 7980-8063 | 2.8 s | CargoFlow `/developers` "Use CargoFlow in Claude" → Copy URL; `cargoflow-mcp.adoranto737.workers.dev/mcp` + copy confirmation |
| R2-02 | `public/footage/R2-02.mp4` | S07 M2 · 8064-8219 | 5.2 s | claude.ai Settings → Connectors → Add custom connector (name CargoFlow, URL) → Add; new chat → tools menu → CargoFlow on |
| R2-03 | `public/footage/R2-03.mp4` | S07 M3 · 8220-8309 | 3.0 s | Prompt "Using CargoFlow, summarise the fleet risk and explain any paused shipment." → `fleet_risk_summary` + `explain_shipment` chips → answer |
| R2-04 | `public/footage/R2-04.mp4` | S07 M4 · 8310-8459 | 5.0 s | Prompt "Prepare the deposit for CF-SG-VAX-0202." → `prepare_deposit` → answer with two unsigned transactions + CargoFlow link; click → app opens the shipment ready to sign (do not sign) |
| R2-05 | `public/footage/R2-05.mp4` | S07 M5 · 8460-8579 | 4.0 s | Expanded `prepare_deposit` tool result: `{to, data, value, chainId}`, "Nothing has been sent." |

## R3 · developer pages (S08)

| Shot id | File | Scene / film frames | Planned duration | Must be on screen |
|---|---|---|---:|---|
| R3-02 | `public/footage/R3-02.mp4` | S08 tile 1 · from 8608 to 8909 | 10.0 s (first 3.3 s carry the beat; the tile stays up for the rest of the scene) | `/docs` Scalar API reference (OpenAPI 3.1) loads; scroll to a wallet-signed write and expand it so `x-cargoflow-signed-message` shows |

(R3 step 1, `/developers` top, is covered by R2-01 and is not used as a separate slot.)

## R4 · proof (S10, 5:10.0-5:20.0, frames 9300-9599)

| Shot id | File | Scene / film frames | Planned duration | Must be on screen |
|---|---|---|---:|---|
| R4-01 | `public/footage/R4-01.mp4` | S10 · 9300-9440 | 4.7 s | `/track/0xc57490f8b1f0190b00197db978963899f55314865c0059eddaf8cfecdc8ff9e5`: `CF-LIVE-1791029236301`, Settled pill, five milestones released |
| R4-02 | `public/footage/R4-02.mp4` | S10 · 9441-9476 | 1.2 s | Explorer `tx/0x37571b49186b43f2f02df4d2034cd495ac7095766d113c20060cdecf4e365a35`, Status Success |
| R4-03 | `public/footage/R4-03.mp4` | S10 · 9477-9599 | 4.1 s (visible ~1.5 s before the counter grid covers it) | `/deployments`: v3 contract list with copy buttons and verified links; scroll through |

Total: 19 clips (10 R1, 5 R2, 1 R3, 3 R4).
