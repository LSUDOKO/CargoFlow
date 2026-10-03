# CargoFlow: demo-video script

**Format.** 1920 x 1080, 30 fps, 3:25.0 (6,150 frames). Demo-day style: one founder voice, one protagonist, one
shipment. **Voice-over pace:** about 147 words per minute while speaking (the caption timings in
`video/captions.json` assume 2.45 words per second), with short sentences and a breath at every full stop.

**Protagonist.** *Meera* is an illustrative composite, not a real person: a mid-size exporter in Pune shipping
vaccines through Nhava Sheva to Singapore, the app's default lane, at 2-8 °C, which is the app's default cold-chain
band and the range most vaccines must stay in (UNEP, source 6). Put a small "Illustrative" tag under her name card the
first time she appears. Every statistic in the script is from the sources at the end; nothing is rounded up.

**Visual system** (match the app, `frontend/README.md`): navy `#0B1B2B` base, lime `#C6F432` for the key word on each
card, emerald `#00C46A` for anything verified on chain, amber `#FFB020` for pauses, red `#E5484D` only for the
excursion. Space Grotesk for headlines, Inter for body, JetBrains Mono for numbers, hashes and temperatures. Source
tags sit bottom-left in Inter 18 px at 60% opacity, on screen for as long as the stat they support.

**Mix.** Music bed at -20 LUFS under voice, ducked a further 6 dB while the voice speaks; voice at -16 LUFS integrated.
In S4 the music drops to -26 LUFS so UI clicks and wallet sounds read.

| Scene | Time | Frames | Words spoken | Speaking time |
|---|---|---|---:|---|
| S0 cold open | 0:00.0-0:08.0 | 0-239 | 17 | 7.2 s |
| S1 problem | 0:08.0-0:40.0 | 240-1199 | 73 | 31.1 s |
| S2 insight and solution | 0:40.0-0:58.0 | 1200-1739 | 39 | 16.8 s |
| S3 how it works | 0:58.0-1:30.0 | 1740-2699 | 66 | 5 beats, each inside its 6.4 s |
| S4 live demo (founder's recording) | 1:30.0-2:45.0 | 2700-4949 | 147 | see `DEMO-SHOTLIST.md` |
| S5 why Robinhood Chain + USDG | 2:45.0-3:05.0 | 4950-5549 | 44 | 18.7 s |
| S6 proof and traction | 3:05.0-3:15.0 | 5550-5849 | 19 | 7.8 s |
| S7 outro | 3:15.0-3:25.0 | 5850-6149 | 17 | 7.9 s |
| **Total** | **3:25.0** | **6,150** | **422** | |

Word counts were checked with a script, and every scene's speech ends before the scene does (the slack per scene is
listed in the caption check below). The exact spoken lines, split into caption cues, are in `video/captions.json`.

---

## S0 · Cold open · 0:00.0-0:08.0

**Voice-over** (17 words)

> Off Sri Lanka, these vaccines are three degrees from worthless.
> The money behind them can't see it.

**On screen**

| In-out | Text |
|---|---|
| 0:00.5-0:04.5 | Data-logger readout, mono, ticking: `5.2 °C` (no other text) |
| 0:04.7-0:07.8 | `In transit · All documents OK` in a bank-portal style row, emerald tick |

**Visual and motion.** Night, open sea. Slow push-in (2% scale over 4 s) on a single 40 ft reefer container on deck;
its status light breathes. Lower-right, the data logger's LCD reads `5.2 °C` and steps to `6.8 °C` at 0:03.0 (the
first two readings of the demo's excursion). At 0:04.7 hard cut to a flat, bright financing dashboard: the same
shipment shows a calm "In transit" with a green tick. It does not change. Hold. The contrast is the hook: the cargo
is warming, the money's view is still green.

**Music and SFX.** No music for the first 4 s: low sea ambience, a hull creak, the logger's soft double beep on each
reading (0:00.6, 0:03.0). At the hard cut, a single low synth note enters and sustains into S1.

---

## S1 · The problem · 0:08.0-0:40.0

**Voice-over** (73 words)

> Meet Meera. She ships vaccines from Pune to Singapore, at two to eight degrees.
> She sells on credit. In India, terms average fifty-two days.
> But the vaccines, reefer and freight are paid for today.
> Her bank can't see the container, so it lends late, expensive, or not at all.
> Worldwide, that's a two-and-a-half-trillion-dollar gap.
> Pharma loses thirty-five billion a year to temperature failures.
> Her logger records every degree. The money never reads it.

**On screen** (cards max 8 words; source tag shown with each stat)

| In-out | Card | Source tag |
|---|---|---|
| 0:08.3-0:14.0 | `Meera · vaccine exporter · Pune` + small `Illustrative` | |
| 0:12.0-0:14.0 | `2-8 °C, door to door` | |
| 0:14.2-0:18.3 | `India: 52-day average payment terms` | Atradius Payment Practices Barometer, India 2025 |
| 0:18.5-0:22.6 | `Paid upfront: product · reefer · freight` | |
| 0:22.8-0:28.9 | `The bank sees paperwork. Not the cargo.` | |
| 0:25.2-0:28.9 | small secondary line: `41% of SME trade-finance requests rejected` | ADB Global Trade Finance Gap Survey 2025 |
| 0:29.1-0:31.1 | `$2.5 trillion trade finance gap` | ADB Global Trade Finance Gap Survey 2025 |
| 0:31.3-0:35.0 | `$35B a year lost to temperature failures` | IQVIA Institute (2019), via Air Cargo News |
| 0:35.2-0:39.4 | `Sensors record. Money doesn't listen.` | |

**Visual and motion.** Story first, numbers second.
- 0:08-0:14: Meera's packing floor (illustration in the app's flat style): cartons of vials, a reefer being loaded at
  Nhava Sheva. A thin route line draws from Nhava Sheva to Singapore across the map (the app's default route).
- 0:14-0:23: A calendar strip slides in and fills day by day to day 52, while on the left three expense chips
  (`product`, `reefer`, `freight`) stamp "PAID" immediately. Cash in her account bar drains as the calendar fills.
- 0:23-0:29: Split screen. Left: the bank's view, a stack of documents (invoice, bill of lading), static. Right: the
  container at sea, live. A frosted pane drops over the right half: the bank cannot see it. Three stamps hit the
  application in sequence: `LATER`, `COSTLIER`, `DECLINED`.
- 0:29-0:31: Zoom out from Meera's single container to a world map of trade lanes; a counter rolls to `$2.5T`.
- 0:31-0:35: Back to one container; its temperature trace rises through the band's top line and turns red; a stack of
  vials fades to grey.
- 0:35-0:39.4: The logger's waveform keeps scrolling, in sync with the beep. Beside it the bank's ledger row sits
  frozen. A dashed line tries to connect the two and breaks.

**Music and SFX.** Sparse piano over a soft pulse at 84 BPM. A paper stamp on each of `LATER`, `COSTLIER`,
`DECLINED`. A low riser under `$2.5T`. The logger beep returns under the last line and is the only sound on "The money
never reads it", then a half-beat of silence.

---

## S2 · The insight and the solution · 0:40.0-0:58.0

**Voice-over** (39 words)

> What if the money could see the cargo?
> That's CargoFlow.
> A financier escrows USDG for one shipment.
> It releases in tranches, and each one unlocks only when the cargo's own signed sensor evidence passes the policy
> both sides agreed.

**On screen**

| In-out | Text |
|---|---|
| 0:40.3-0:43.6 | `What if the money could see the cargo?` (lime on "see") |
| 0:43.8-0:47.9 | CargoFlow logo lock-up |
| 0:45.0-0:47.9 | `One shipment. One USDG escrow.` |
| 0:48.1-0:57.1 | `Evidence passes policy → tranche releases` |

**Visual and motion.** The broken dashed line from S1 reconnects: the logger's waveform flows into a vault icon,
which opens a crack. The CargoFlow logo resolves out of the vault (scale 0.9 to 1, 400 ms ease-out). Then a
horizontal bar of five tranche segments appears under the container; as evidence pulses arrive from the logger, a
lime "policy" gate checks each one and the segments fill emerald one by one (only the first two fill here; S3 tells
the rest).

**Music and SFX.** Silence for the question (0:40.3-0:43.6) except a single held pad. On the logo: the full theme
enters, warm, mid-tempo. A soft mechanical unlatch on each tranche fill.

---

## S3 · How it works · 0:58.0-1:30.0

Five beats, 6.4 s each. Each beat has a numbered card and one diagram moment. Hero numbers are the full-size story
from the README (a 40,000 USDG facility against a 100,000 USDG invoice, five tranches of 8,000, 3% fee).

| Beat | Time | Voice-over | Card | Visual |
|---|---|---|---|---|
| 1 | 0:58.0-1:04.4 | "Meera opens a facility. Her financier escrows forty thousand USDG." (10 words) | `1 · 40,000 USDG into escrow` | Meera's wallet signs (small wallet pop-up); a coin stream flows from a "Financier" wallet into a vault labelled with the shipment id. |
| 2 | 1:04.4-1:10.8 | "Signed readings are scored and committed on chain. Each passing batch releases a tranche." (14) | `2 · Signed readings → Merkle root → tranche` | Readings drop into an 8-reading "epoch" tray, a signature glyph on each; the tray compresses into a single root hash that lands on a chain block (emerald); tranche 1 of 5 fills and 8,000 USDG moves to Meera. |
| 3 | 1:10.8-1:17.2 | "Overheat, and releases pause automatically. An AI monitor double-checks, and can only tighten." (13) | `3 · 11.7 °C → paused` | Probe-1 trace climbs 5.2, 6.8, 8.9, 10.4, 11.7 through the band (red). The vault's door slams to amber "PAUSED". A small AI eye icon looks at the same epoch; a one-way arrow shows it can only push toward "stricter", never toward "release". |
| 4 | 1:17.2-1:23.6 | "A backup probe stayed cold. Meera's wallet submits a zero-knowledge proof, and releases resume." (14) | `4 · Zero-knowledge proof → active again` | Probe-2's line holds flat-ish at 4.6 °C. Its readings slide into a sealed envelope stamped `Groth16`; the envelope (not the readings) goes from Meera's wallet to the chain; a verifier tick; the vault turns emerald "ACTIVE". |
| 5 | 1:23.6-1:30.0 | "The buyer pays. One transaction repays the financier, plus fee, and sends Meera the rest." (15) | `5 · Financier 41,200 · Meera 58,800` | The buyer's 100,000 USDG enters the vault and splits in one motion: 40,000 + 1,200 to the financier, 58,800 to Meera. A single transaction hash under it. |

**Music and SFX.** Theme continues with a light rhythmic pulse that steps up on each beat. Beat 3: the pulse drops
out for one bar, a muted alarm blip, the door slam. Beat 4: the pulse returns on "resume". Beat 5: a resolved chord on
the split. Transition into S4 with a quick whoosh to the browser.

---

## S4 · Live demo · 1:30.0-2:45.0 (75 s)

The founder's own screen recording of https://cargoflow.adoranto737.workers.dev. Everything for this scene (what to
click, what must be on screen, wallet setup and funding, recording settings, the CSV generator, troubleshooting) is
in [`DEMO-SHOTLIST.md`](DEMO-SHOTLIST.md). Narration (147 words, captioned in `captions.json`):

| Shot | Time | Voice-over |
|---|---|---|
| D1 landing | 1:30.0-1:36.0 | "The live app, on Robinhood Chain Testnet. I'll play Meera, the exporter." |
| D2 exporter wizard | 1:36.0-1:47.0 | "I register the shipment: Nhava Sheva to Singapore, a thirty USDG invoice, two to eight degrees, a twenty USDG facility in five tranches." |
| D3 financier funds | 1:47.0-1:53.0 | "Switch to the financier. Approve, deposit: twenty USDG in this shipment's escrow." |
| D4 gateway, readings, releases | 1:53.0-2:03.0 | "Start transit, add the reefer's logger as a gateway, upload its readings. Two epochs pass, two tranches paid." |
| D5 excursion, pause | 2:03.0-2:12.0 | "Next leg, probe one climbs to eleven point seven degrees. The epoch fails and the facility pauses itself." |
| D6 arbiter console | 2:12.0-2:17.0 | "The arbiter console flags it. I can fix this myself." |
| D7 zero-knowledge recovery | 2:17.0-2:30.0 | "Probe two stayed at four point six. I sign, CargoFlow proves it in zero knowledge, and my wallet submits the proof. Verified on chain. Releases resume." |
| D8 remaining releases | 2:30.0-2:36.0 | "The rest of the voyage clears. All five tranches released." |
| D9 buyer pays, settled | 2:36.0-2:45.0 | "The buyer confirms delivery and pays. One transaction: twenty point six to the financier, the rest to me." |

**Overlays during S4** (keep them small, top-right, so the UI stays readable): `LIVE · Robinhood Chain Testnet`
throughout; `Real testnet transactions` on D2; `Readings never go on chain. Only roots.` on D4; `Readings stay
private · Groth16` on D7; `30 USDG in → 20.6 financier · 9.4 exporter` on D9.

**Music and SFX.** Bed down to -26 LUFS. Keep the real UI sounds; add a soft click on each wallet confirmation and the
same unlatch SFX as S2 on each "milestone released".

---

## S5 · Why Robinhood Chain and USDG · 2:45.0-3:05.0

**Voice-over** (44 words)

> Why Robinhood Chain and USDG?
> USDG is a dollar stablecoin issued in Singapore, where Meera's cargo lands. It carries escrow, tranches and
> settlement.
> Blocks land in a fraction of a second, at a few millionths of an ETH per transaction.
> Every contract is source-verified.

**On screen**

| In-out | Text | Source tag |
|---|---|---|
| 2:45.3-2:47.3 | `Robinhood Chain + USDG` (both logos only if their brand guidelines allow; otherwise text) | |
| 2:47.5-2:52.4 | `USDG: issued by Paxos Digital Singapore` | Paxos USDG docs |
| 2:52.6-2:55.0 | `Escrow · tranches · settlement: all USDG` | |
| 2:55.2-2:58.5 | `~0.14 s average block interval` | Measured on the testnet RPC, 2 Oct 2026 |
| 2:58.5-3:02.2 | `~0.000002 ETH per transaction` | Measured: CargoFlow testnet receipts |
| 3:02.4-3:04.8 | `7 contracts · source-verified` | README, explorer |
| 2:45.3-3:04.8 (footer strip) | `Built for Arbitrum Open House Singapore · extra consideration for USDG` | HackQuest listing |

**Visual and motion.** Clean navy stage. A USDG coin travels the whole lifecycle along one track: financier → vault
→ five tranches to Meera → buyer → split. Then the explorer: a real page for the settle transaction scrolls by with
status "Success" and the fee field highlighted. End on the verified-contracts table (seven addresses, emerald
"verified" ticks cascading top to bottom).

**Music and SFX.** The theme builds: add drums at 2:52. A short tick per verified contract.

---

## S6 · Proof and traction · 3:05.0-3:15.0

**Voice-over** (19 words)

> It's live. A shipment just settled end to end on testnet, every step signed by its party's own wallet.

**On screen**

| In-out | Text |
|---|---|
| 3:05.3-3:09.8 | `CF-LIVE-1790936950736 · settled` with two tx badges: `proof 0xc582…1a82` and `paid 0x7898…5041` |
| 3:09.8-3:14.8 | Counter grid: `174 contract tests` · `25 circuit tests` · `78 frontend unit` · `18 browser end-to-end` · `22-transaction testnet trail` |

**Visual and motion.** The shipment's live dashboard (screenshot from the founder's recording or the README link)
slides in with the "Settled" pill, then tilts back to make room for the counter grid; each counter rolls up from 0 in
600 ms, staggered by 120 ms.

**Music and SFX.** Peak of the theme. A soft confirmation chime on "settled".

---

## S7 · Outro · 3:15.0-3:25.0

**Voice-over** (17 words)

> CargoFlow.
> Working capital that releases only when the cargo's own evidence says it should.
> Try it today.

**On screen**

| In-out | Text |
|---|---|
| 3:15.5-3:25.0 | CargoFlow logo |
| 3:16.7-3:25.0 | `Working capital that releases only when the cargo's own evidence says it should.` |
| 3:22.2-3:25.0 | `cargoflow.adoranto737.workers.dev` · `github.com/LSUDOKO/CargoFlow` |

**Visual and motion.** Return to the S0 image: the same container at sea, now at dawn, its logger reading `4.6 °C`
and an emerald link line running from it into a vault. Fade the scene to navy behind the logo; the tagline types on
word by word in sync with the voice; URL and GitHub fade up together and hold for the last 2.8 s. Last frame is clean
(logo, tagline, URL, GitHub) for the thumbnail.

**Music and SFX.** The theme resolves on "should." and rings out under the URL. The logger's double beep once,
softly, as the final sound.

---

## Claims checked against the repository

Every product claim in the narration matches what the code does:

| Claim in the script | Where it is true |
|---|---|
| Per-shipment USDG escrow, released in milestones | `ReceivableVault`, `FinancingController.createFacility` / `depositCapital` / `evaluateAndReleaseMilestone`; README "story in one picture" |
| Logger readings are signed; epochs of 8 readings per sensor; Merkle (Poseidon) root committed on chain | `frontend/src/lib/gateway.ts` (Ed25519 gateway key), `UploadReadings.tsx` ("epochs of 8 per sensor"), `EvidenceRegistry.commitEpoch` |
| Releases pause automatically on a failed epoch; the AI can only make decisions stricter | README "An AI that cannot move money"; the monitor key may only pause (`docs/runbooks/testnet.md`); `AiPanel.tsx` |
| Exporter recovers with a zero-knowledge proof from their own wallet, readings not revealed | `RecoveryPanel.tsx` (wallet signs, backend proves, wallet submits `resumeWithProof`); `Groth16Verifier` |
| Buyer's payment repays the financier with a fee and pays the exporter the rest in one transaction | `FinancingController.settle`; README testnet trail (`settle` row) |
| Arbiter resolves disputes | `ArbiterConsole.tsx`, `e2e/05-arbiter.spec.ts` |
| Hero numbers 40,000 / 100,000 / 8,000 / 3% / 41,200 / 58,800 | README sequence diagram, `docs/project/12-usdg-and-robinhood.md` |
| Demo numbers 20 / 30 / 4 / 20.6 / 9.4 | Wizard maths (`ExporterWizard.tsx`, fee default 3%, 5 milestones); `scripts/testnet-lifecycle.ts` |
| Live run CF-LIVE-1790936950736, proof and payment transactions | README "Live on Robinhood Chain Testnet"; both receipts read back from the RPC with status success |
| About 0.000002 ETH per transaction | Receipts on 2 Oct 2026: invoice payment 128,646 gas, proof 349,464 gas, both at 0.01 gwei = 0.0000013 and 0.0000035 ETH |
| Blocks in a fraction of a second | Testnet RPC on 2 Oct 2026: blocks 127,540,911 to 127,550,911 (10,000 blocks) spanned 1,439 s, about 0.14 s per block |
| Test counts 174 / 25 / 78 / 18 | Supplied by the team from the latest runs; 78 unit and 25 circuit tests confirmed by counting test cases. Note the README's "Measured, not claimed" table still says 170 / 54 / 16 and should be updated before submission so judges see the same numbers |

What the script deliberately does not say: that telemetry comes from real hardware (it is simulated, with Ed25519
signatures, not attested devices), that the protocol is audited (it is not), or that testnet USDG has value (it does
not). The `Illustrative` tag covers Meera.

---

## Alternate lines (same timing)

For a produce version of S1 (mangoes or other fruit instead of vaccines), swap two lines; word counts are equal or
lower, so the captions only need the text changed:

- "She ships vaccines from Pune to Singapore, at two to eight degrees." → "She ships fresh fruit from Nhava Sheva to
  Singapore, in a reefer." Then also drop "2-8 °C" from the card, because the app's default band is the vaccine
  band; set a produce band in the wizard for the demo.
- "Pharma loses thirty-five billion a year to temperature failures." → "A quarter of fruit and vegetables is lost
  before it reaches a shop." Card: `25.4% of fruit and veg lost before retail` (FAO, source 7).

---

## Sources

Each figure was checked on the source page on 2 October 2026.

1. **Trade finance gap, $2.5 trillion, about 10% of global trade (2025); SME rejection rate 41% (vs 40% for large and
   mid-cap corporates).** Asian Development Bank, news release "Demand for Trade Finance to Rise Amid Supply Chain
   Realignment—ADB Report", 15 January 2026.
   https://www.adb.org/news/demand-trade-finance-rise-amid-supply-chain-realignment-adb-report
2. **The gap "remains at $2.5 trillion, as in 2023".** ADB Brief, "ADB Global Trade Finance Gap Survey", December 2025.
   https://www.adb.org/publications/adb-global-trade-finance-gap-survey
3. Context: the gap was a record $2.5 trillion in 2022, up from $1.7 trillion in 2020. ADB news release, 5 September
   2023. https://www.adb.org/news/global-trade-finance-gap-expands-25-trillion-2022
4. **India: 50% of B2B sales on credit, average payment terms 52 days; overdue invoices 63% of credit-based B2B
   sales.** Atradius Payment Practices Barometer, "B2B payment practices trends in India 2025" (29 July 2025).
   https://group.atradius.com/knowledge-and-research/reports/b2b-payment-practices-trends-india-2025 and the PDF
   https://group.atradius.com/dam/jcr:b693e087-ee4d-427e-9075-892bfa10ee04/payment-practices-barometer-asia-2025-india-en.pdf
5. **Biopharma loses about $35 billion a year to failures in temperature-controlled logistics** (lost product,
   clinical-trial loss and replacement, wasted logistics, root-cause analysis). IQVIA Institute for Human Data Science,
   reported by Air Cargo News, July 2019.
   https://www.aircargonews.net/pharma-logistics/2019/07/failures-in-temperature-controlled-logistics-cost-biopharma-industry-billions/
6. **"Up to 50% of vaccines are wasted globally every year; a large part because of lack of temperature control and
   the logistics to support an unbroken cold-chain"; most vaccines must be kept at 2-8 °C.** UNEP, "Why optimized
   cold-chains could save a billion COVID vaccines", 26 June 2020, citing a WHO estimate.
   https://www.unep.org/news-and-stories/story/why-optimized-cold-chains-could-save-billion-covid-vaccines
   (Not used in the voice-over; available as an extra card if S1 is re-cut. Attribute it as "WHO estimate, via UNEP".)
7. **13.3% of food is lost between harvest and retail (2023); fruit and vegetables 25.4%.** FAO, SDG indicator 12.3.1
   (Global Food Loss Index). https://www.fao.org/sustainable-development-goals-data-portal/data/indicators/1231-global-food-losses
   (Used only in the alternate produce lines.)
8. **"Up to 80 per cent of trade is financed by credit or credit insurance."** WTO, "Trade finance and SMEs" (2016).
   https://www.wto.org/english/res_e/booksp_e/tradefinsme_e.pdf (Background; not on screen.)
9. **USDG is issued by Paxos Digital Singapore Pte. Ltd., a Major Payments Institution supervised by the Monetary
   Authority of Singapore; built for payments, settlements and treasury; redeemable 1:1.** Paxos documentation.
   https://docs.paxos.com/guides/stablecoin/usdg
10. **Hackathon fit: "Extra consideration is given to projects integrating Paxos' USDG stablecoin"; at least 1 of 3
    prizes reserved for a project building on Robinhood Chain.** HackQuest, "Arbitrum Open House Singapore: Online
    Buildathon". https://www.hackquest.io/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon
11. **Robinhood Chain is an Arbitrum Layer-2 on Ethereum with ETH as the gas token.** Robinhood Chain docs.
    https://docs.robinhood.com/chain/connecting/
12. **Block interval and transaction fees** were measured directly on `https://rpc.testnet.chain.robinhood.com` on
    2 October 2026 (see "Claims checked" above), and the transactions are public:
    https://explorer.testnet.chain.robinhood.com/tx/0xc582417abd0ce8498bab0fa4937b0a8ec8dbfbe19c47646f79646fa70ede1a82 and
    https://explorer.testnet.chain.robinhood.com/tx/0x78984fdfcefd2fa792c7170fff94b1f4b482986e96fad29193ff450251605041
