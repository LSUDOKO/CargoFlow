# S4 demo: screen-recording shot list (1:30 to 2:45, 75 seconds)

You record one complete shipment on the live site, from registration to settlement, with three of your own wallets.
The raw take will run 12 to 20 minutes (wallet pop-ups, block confirmations, the proof takes up to a minute). The
edit cuts it to 75 seconds with jump cuts and speed ramps, and the narration below is recorded separately and laid
over it. Every line of narration is also in `video/captions.json` (scene `S4`), timed to the slots below.

- Web app: https://cargoflow.adoranto737.workers.dev
- API (Render free tier, sleeps when idle): https://cargoflow-api-75ul.onrender.com
- Chain: Robinhood Chain Testnet, id `46630`, RPC `https://rpc.testnet.chain.robinhood.com`,
  explorer `https://explorer.testnet.chain.robinhood.com`
- USDG (testnet, 6 decimals): `0x7E955252E15c84f5768B83c41a71F9eba181802F`

Demo-scale numbers (all amounts scale together, so the waterfall is the same shape as the 40,000 / 100,000 story):

| | USDG |
|---|---:|
| Invoice | 30 |
| Facility | 20, in 5 tranches of 4 |
| Fee | 3% = 0.6 |
| Financier gets back at settlement | 20.6 |
| Exporter receives | 20 in tranches + 9.4 residual = 29.4 |
| Left in the vault | 0 |

Small amounts are fine: the public testnet run used a 20 USDG facility and the hosted-API run used 20 / 30. The only
rule the wizard enforces is that the invoice covers the facility plus its fee (30 >= 20.6).

---

## 1. One-time setup (the day before)

### Wallets

Use one browser wallet extension (MetaMask or Rabby) in a clean Chrome profile, with three accounts. Rename them in
the wallet so the name is readable on screen:

| Account name | Role | Needs |
|---|---|---|
| `Meera - Exporter` | registers, starts transit, adds the gateway, uploads, recovers | testnet ETH only |
| `Financier` | approves and deposits the facility | testnet ETH + at least 20 USDG |
| `Buyer` | confirms delivery and pays | testnet ETH + at least 30 USDG |

The three must be different addresses (the wizard refuses a buyer or financier equal to the exporter, and a financier
equal to the buyer). When the site asks to connect, tick **all three accounts** in the wallet's connect dialog;
then switching account in the extension switches the app instantly, with no reconnect on camera.

Optional, for the arbiter glance (shot D6): the deployment's dispute-role wallet. If you want it on screen, import
that key into the wallet yourself, on your own machine and off camera. If you skip it, any wallet can open
`/arbiter` and see the queue; it just shows "This wallet is not an arbiter" above it (crop to the queue in the edit).

### Network

Add Robinhood Chain Testnet to the wallet (chain id 46630, RPC and explorer above, currency ETH), or let the app add
it: when a wallet is on the wrong chain the app shows a **Switch network** button. Add the USDG token address above
to each account so balances are visible in the wallet.

### Funding

1. Gas: request testnet ETH for each of the three accounts at the Robinhood faucet,
   https://faucet.testnet.chain.robinhood.com/ . Measured cost is about 0.000002 ETH per transaction (a settlement
   used 128,646 gas at 0.01 gwei), so one drip lasts many takes.
2. USDG: request testnet USDG at the Paxos faucet, https://faucet.paxos.com/?network=robinhood . A drip was 100 USDG
   when the project was tested. Send it to the `Financier` account, then send 30 USDG from `Financier` to `Buyer`
   with the wallet's normal Send. That leaves 70 for the financier: enough for three takes.
   Testnet USDG has no value.

If a wallet is short, the app says so on the payment step ("This wallet needs N more USDG") with a link to the Paxos
faucet. That is fine to fix off camera, not on it.

### Addresses ready to paste

Keep a small text file (on a second screen or a hidden window) with the `Buyer` and `Financier` addresses. Paste,
never type, on camera.

---

## 2. Recording settings

| Setting | Value |
|---|---|
| Canvas and output | 1920 x 1080, 30 fps (constant frame rate) |
| Recorder | OBS Studio, **Display Capture** (not Window Capture, so wallet pop-ups are recorded too) |
| Quality | CQP/CRF about 18, or 25-40 Mbps; record to `.mkv`, remux to `.mp4` (File > Remux) |
| Browser | Chrome, clean profile, only the wallet extension pinned; full screen with F11 |
| Zoom | 110% (Ctrl +). Check the dashboard still shows the temperature chart and the escrow panel side by side; drop to 100% if it stacks |
| Chrome chrome | Hide the bookmarks bar (Ctrl+Shift+B), close every other tab, no downloads bar left open |
| Desktop | Do Not Disturb on, no notifications, hide the clock if it shows a date you do not want in the video |
| Cursor | Make it findable: Linux `highlight-pointer` (github.com/swillner/highlight-pointer) or a larger system cursor; on macOS, Screen Studio or a cursor-highlight utility. Move slowly and pause on every button for half a second before clicking |
| Audio | Do not narrate live. Record the voice-over afterwards from the narration column below |
| Theme | Light theme in the browser and the wallet, so pop-ups match the app |

---

## 3. Thirty minutes before you press record

1. **Wake the API.** Open https://cargoflow-api-75ul.onrender.com/v1/health in a tab and wait until it answers
   (the free instance takes about a minute after a quiet spell). Then load the web app once and close the tab.
2. **Generate the logger CSVs** (from the repository root):

   ```bash
   node video/demo-csv/make-csvs.mjs
   ```

   It writes `video/demo-csv/leg-1-healthy.csv`, `leg-2-excursion.csv`, `leg-3-recovery.csv` and `leg-4-healthy.csv`
   with timestamps ending about one minute before now, and prints the latest time by which you should have uploaded
   leg 4. **Run it right before recording, and finish the take within about 25 minutes.** The default policy refuses
   to release capital on evidence older than 30 minutes ("Evidence freshness: 30 min" in the wizard), and the
   readings must be in the past (the app rejects timestamps in the future). If you run over, regenerate, register a
   new shipment with a new reference, and start again. The files are git-ignored.

   What is in them: two probes (`probe-1`, `probe-2`), one reading each every 5 s, with real-looking noise
   (about ±0.2 °C, humidity 62-68 %, a few metres of GNSS jitter on a 16-knot track out of Nhava Sheva, shocks of
   0.05-0.25 g). A perfectly flat sensor would be flagged by the evidence engine as frozen or cloned, so do not hand-edit
   the values into straight lines. Leg 2's last five probe-1 readings are exactly 5.2, 6.8, 8.9, 10.4, 11.7 °C while
   probe-2 holds at about 4.6 °C. Legs are 16, 8, 8 and 16 steps: an evidence epoch closes at 8 readings per sensor,
   so that is 2 epochs, 1, 1, 2.

   The app also has a **Download a template** link inside the Submit readings dialog. That template is only a header
   and one example row per sensor, which is useful to show the format but not enough to close an epoch. Use the
   generated files for the take.
3. **Pick a reference** you have not used: e.g. `CF-SG-VAX-0102` (the reference plus your wallet fixes the on-chain
   shipment id, so a reused reference is refused).
4. In the wallet, select `Meera - Exporter`. Open the web app's landing page. Start OBS recording.

---

## 4. The shot list

Times are positions in the final film (the S4 slot runs 1:30.0 to 2:45.0). "Raw" is roughly how long the action takes
live; the edit keeps the "Keep on screen" moments and cuts or speed-ramps the waiting.

### D1 · 1:30.0-1:36.0 (6 s) · Landing

| | |
|---|---|
| Do | Start on the landing hero ("Capital that moves with your cargo"). Slowly scroll one notch so the track bar and the live stats show. Click **Exporters** in the header. |
| Keep on screen | The hero headline; the header showing the connected wallet and the network. |
| Raw | 10 s |
| Narration | "The live app, on Robinhood Chain Testnet. I'll play Meera, the exporter." |
| Edit | Real speed. Optional lower-third: `cargoflow.adoranto737.workers.dev`. |

### D2 · 1:36.0-1:47.0 (11 s) · Exporter wizard: register, policy, facility, sign

| | |
|---|---|
| Do | Step **Shipment**: Shipment reference `CF-SG-VAX-0102`; Buyer address (paste `Buyer`); Invoice value `30`; Route stays **Nhava Sheva (IN) → Singapore (SG)**. **Continue**. Step **Cold-chain policy**: leave the defaults, hover the 2 °C and 8 °C fields for a beat. **Continue**. Step **Financing**: Financier address (paste `Financier`); Total facility `20`; Milestones `5` (hint reads "5 tranches of about 4 USDG"); Financing fee `3`. **Continue**. Step **Sign**: **Sign and submit**, then confirm the three wallet pop-ups (Register shipment, Set policy, Open facility). Wait for **View dashboard** and click it. |
| Keep on screen | The 2-8 °C fields; the "5 tranches of about 4 USDG" hint; the three-step progress list ticking; the toasts "Shipment registered on-chain", "Cold-chain policy set", "Financing facility opened". |
| Raw | 60-90 s |
| Narration | "I register the shipment: Nhava Sheva to Singapore, a thirty USDG invoice, two to eight degrees, a twenty USDG facility in five tranches." |
| Edit | Jump-cut between steps; 4-8x speed through the three confirmations; land on the three green ticks. |

### D3 · 1:47.0-1:53.0 (6 s) · Financier funds the escrow

| | |
|---|---|
| Do | In the wallet switch to `Financier`. Open **/financier** (header link). Find the card with your reference. Click **1. Approve 20 USDG**, confirm; click **2. Deposit 20 USDG**, confirm. |
| Keep on screen | The facility card with your reference and its settlement preview ("Financier receives 20.6 USDG … exporter receives 9.4 USDG at settlement"); the toast "Facility funded"; optionally the wallet's USDG balance dropping by 20. |
| Raw | 30 s |
| Narration | "Switch to the financier. Approve, deposit: twenty USDG in this shipment's escrow." |
| Edit | Cut the confirmation waits. |

### D4 · 1:53.0-2:03.0 (10 s) · Transit, sensor gateway, first readings, two releases

| | |
|---|---|
| Do | Switch the wallet back to `Meera - Exporter`. Open the shipment's dashboard (from /shipments or the browser back stack). Click **Start transit**, confirm ("Transit started"). Click **Add sensor gateway**: Name `Reefer logger, MSKU 123456-7`; Sensor ids stay `probe-1, probe-2`; click **Sign and add gateway** and sign the message (no gas). The key file downloads; the dialog says **Gateway added**; **Close**. Click **Submit readings**: the key from this browser is already selected; **Choose CSV** → `leg-1-healthy.csv`; the summary shows 32 readings, 2 sensors; click **Send 32 readings**. Wait for the Result table. |
| Keep on screen | The signature request (no gas); the Result table: "32 readings accepted" and two rows "Passed: milestone released", each with a transaction badge. Then **Close** and show the milestone timeline with milestones 1 and 2 released and the escrow panel's drawn amount at 8. |
| Raw | 90-120 s |
| Narration | "Start transit, add the reefer's logger as a gateway, upload its readings. Two epochs pass, two tranches paid." |
| Edit | Hold one second on the Result table. Click a transaction badge only if you want an explorer flash (cut it short). |

### D5 · 2:03.0-2:12.0 (9 s) · The excursion: automatic pause

| | |
|---|---|
| Do | **Submit readings** → `leg-2-excursion.csv`. The dialog warns "3 readings are outside the shipment's 2 to 8 °C band. They are evidence too". Click **Send 16 readings**. Result: one row "Failed: facility paused" with its reasons. **Close**. Scroll to the temperature chart. |
| Keep on screen | The out-of-band warning; "Failed: facility paused"; the status pill turning **Paused** (amber); the temperature chart with probe-1 above the band; the AI monitor panel. |
| Raw | 30-45 s |
| Narration | "Next leg, probe one climbs to eleven point seven degrees. The epoch fails and the facility pauses itself." |
| Edit | Real speed on the pill change. Add a soft alarm SFX here. Note on the AI panel: if the hosted backend has a model configured it shows the monitor's verdict; if it reads "Decided by the deterministic policy gate (no AI model configured)", keep it off screen and do not claim the AI in narration (the narration above does not). |

### D6 · 2:12.0-2:17.0 (5 s) · Arbiter console glance

| | |
|---|---|
| Do | Open **/arbiter** in the same tab. If you imported the dispute-role wallet, switch to it; otherwise stay as the exporter. Your shipment is in the queue as Paused, with "The exporter can resume with a zero-knowledge proof, or you can lift the pause on a verified basis." Do not click anything. Go back to the dashboard and switch back to `Meera - Exporter`. |
| Keep on screen | The queue card with your reference and the Paused status. Crop out "This wallet is not an arbiter" if you are not on the arbiter wallet. |
| Raw | 15 s |
| Narration | "The arbiter console flags it. I can fix this myself." |
| Edit | Record this while the facility is paused: once settled, the shipment leaves the queue. |

### D7 · 2:17.0-2:30.0 (13 s) · Zero-knowledge recovery from the exporter's wallet

| | |
|---|---|
| Do | **Submit readings** → `leg-3-recovery.csv` → **Send 16 readings** → **Close** (this gives probe-2 eight fresh readings after the pause). In **Resume with a proof**, set **Probe** to `probe-2`. Click **Sign and prepare proof**, sign the message ("Waiting for your signature…" then "Proving, up to a minute…"). When the text reads "The proof is ready: eight readings from probe-2, committed on chain and proven inside the band", click **Submit proof and resume** and confirm. Wait for the toast "Facility resumed by zero-knowledge proof" and the proof card "Groth16 proof verified on-chain". If a **Release milestone 3** button appears, click it and confirm ("Milestone 3 released"); if not, the backend has already released it. |
| Keep on screen | The probe selector on `probe-2`; "Proving, up to a minute…"; the proof card's "verified on-chain" state; the status pill back to **Active** (green). |
| Raw | 60-120 s |
| Narration | "Probe two stayed at four point six. I sign, CargoFlow proves it in zero knowledge, and my wallet submits the proof. Verified on chain. Releases resume." |
| Edit | Speed-ramp the proving wait to under a second. Optional on-screen tag: `Readings stay private · Groth16`. |

### D8 · 2:30.0-2:36.0 (6 s) · The rest of the voyage

| | |
|---|---|
| Do | **Submit readings** → `leg-4-healthy.csv` → **Send 32 readings**. Result: "Passed: milestone released" rows. **Close**. Show the milestone timeline. |
| Keep on screen | All five milestones marked **Released**; escrow drawn 20 of 20. |
| Raw | 45 s |
| Narration | "The rest of the voyage clears. All five tranches released." |
| Edit | Cut straight to the five green milestones. |

### D9 · 2:36.0-2:45.0 (9 s) · Buyer confirms delivery and pays; settled

| | |
|---|---|
| Do | Switch the wallet to `Buyer` (same dashboard). Click **Confirm delivery**, confirm ("Delivery confirmed"). Click **1. Approve 30 USDG**, confirm; click **2. Pay the 30 USDG invoice**, confirm. Wait for "Invoice paid and settled". Scroll to the audit trail. Then click **Buyers** (or **Financiers**) in the header: the shipment's card now shows the settled split, financier 20.6 USDG and exporter 9.4 USDG residual. |
| Keep on screen | The status pill **Settled**; the audit trail with explorer links; the portal card with the split (financier 20.6, exporter residual 9.4). End on that card. |
| Raw | 60-75 s |
| Narration | "The buyer confirms delivery and pays. One transaction: twenty point six to the financier, the rest to me." |
| Edit | Optional 1 s cutaway to the explorer page of the settle transaction (status Success), then hand over to S5 at 2:45.0. |

Narration total: 147 words over 75 s (about 147 words per minute while speaking, with room for clicks).

---

## 5. If something goes wrong on camera

| You see | What it means | Do |
|---|---|---|
| Spinner for a minute on first load | Render's free instance was asleep | Wake it first (section 3); cut the wait |
| "This reference is already used for a different shipment" | Reference reused with this wallet | New reference |
| "timestamp is in the future" in the CSV check | Computer clock is behind, or files from another machine | Sync the clock, regenerate |
| "N quarantined (older than a reading already accepted …)" | The same leg was uploaded twice, or files from two generations were mixed | Harmless for a re-upload; otherwise regenerate and use a new shipment |
| Release fails with an evidence-stale error | More than ~30 min since the readings | Regenerate, new shipment |
| Proof step says no in-range readings since the pause | leg-3 was not uploaded yet, or probe-1 was selected | Upload leg-3, choose `probe-2` |
| "This wallet needs N more USDG" | The financier or buyer is short | Paxos faucet, off camera |
| A wallet pop-up never appears | Pop-up opened behind the full-screen browser | Click the extension icon; this is why Display Capture is used |

## 6. After the take

- Copy the shipment's dashboard URL and the settle transaction hash into the video description.
- Cut to exactly 75.0 s (2,250 frames at 30 fps) and drop it into the S4 slot at 1:30.0. The captions for S4 in
  `video/captions.json` already assume the shot boundaries above (D1 1:30.0, D2 1:36.0, D3 1:47.0, D4 1:53.0,
  D5 2:03.0, D6 2:12.0, D7 2:17.0, D8 2:30.0, D9 2:36.0).
