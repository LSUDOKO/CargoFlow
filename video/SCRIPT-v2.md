# CargoFlow: product video v2, script and direction

**Format.** 1920 x 1080, 30 fps, **5:28.0 (9,840 frames)**. One founder voice-over, about 145 words per minute while
speaking (2.42 words per second, the rate `captions-v2.json` is timed at), 678 words in total, short sentences, a
breath at every full stop. Every scene's speech ends at least 0.3 s before its cut.

**What v2 is.** An explainer and a product demo in one film: the problem with real source pages on screen, a small
cast of flat cartoon characters who carry the story, designed animations for each mechanism, the real website
recorded after the redesign, CargoFlow inside claude.ai through the remote MCP server, the developer platform, the
sponsors as they actually stand, proof, and an outro.

**What v2 replaces.** `SCRIPT.md`, `DEMO-SHOTLIST.md` and `captions.json` (v1) stay as history. Reused from v1, because
they are good and still true: the hero numbers, the demo-scale numbers, the CSV generator (`video/demo-csv/make-csvs.mjs`),
the wallet, funding, recording-settings and troubleshooting sections of the shot list, the source list and the
claims check. **Not reused:** anything from v1's look. No AI-generated images (`public/assets/*.webp`: port-night,
reefer-close, vials) appear anywhere, and nothing is staged on v1's dark navy night sea. Every picture in v2 is one
of three things:

1. **Code-native flat illustration** from the v2 library: characters (`video/src/characters`), objects
   (`video/src/assets`), maps (`video/src/maps`).
2. **Real screen recordings** of https://cargoflow.adoranto737.workers.dev and of claude.ai.
3. **Real screenshots of the source pages**, captured for this film (`video/public/sources/`, boxes in `highlights.json`).

**Honesty rules.** Every statistic has its source tag on screen for as long as the number is visible. Meera, Daniel,
Wei Lin and the supporting cast are illustrative; Meera's name card carries a small `Illustrative` tag the first time
she appears. The explainer uses the README's reference numbers (100,000 USDG invoice, 40,000 facility, 3% fee) and says
so in a corner tag; the demo uses the real testnet numbers (30 / 20 / 3%). The film never says the telemetry came from
physical hardware, that the protocol is audited, or that testnet USDG has value. "Off Sri Lanka" and the Colombo
place are part of the illustrative story, matched to the app's default lane.

---

## Scene table

Words counted by script (`[A-Za-z0-9'-]` tokens), speaking time = words / 2.42.

| Scene | Content | In | Out | Frames | Words | Speaking time | Source of picture |
|---|---|---|---|---:|---:|---:|---|
| S00 | Cold open: the reefer and the lender's screen | 0:00.0 | 0:10.5 | 0-314 (315) | 20 | 8.3 s | illustration |
| S01 | Meera and the 52-day wait | 0:10.5 | 0:33.5 | 315-1004 (690) | 49 | 20.3 s | illustration + Atradius screenshots |
| S02 | Daniel lends blind; the $2.5T gap | 0:33.5 | 1:00.5 | 1005-1814 (810) | 58 | 24.0 s | illustration + ADB screenshots |
| S03 | The cargo is fragile; $35B | 1:00.5 | 1:14.0 | 1815-2219 (405) | 28 | 11.6 s | illustration + Air Cargo News screenshot |
| S04 | The line: evidence decides | 1:14.0 | 1:26.0 | 2220-2579 (360) | 25 | 10.3 s | README screenshot + illustration |
| S05a | Facility, escrow, place milestones | 1:26.0 | 1:41.0 | 2580-3029 (450) | 32 | 13.2 s | illustration + map |
| S05b | Signed readings, epochs, fusion, score | 1:41.0 | 2:00.0 | 3030-3599 (570) | 41 | 17.0 s | illustration |
| S05c | Release, place hold, humidity and shock | 2:00.0 | 2:12.0 | 3600-3959 (360) | 23 | 9.5 s | illustration + map |
| S05d | Excursion, conflict, pause, AI ratchet | 2:12.0 | 2:31.0 | 3960-4529 (570) | 39 | 16.1 s | illustration + map |
| S05e | Automatic ZK recovery, notification | 2:31.0 | 2:48.0 | 4530-5039 (510) | 36 | 14.9 s | illustration |
| S05f | Delivery, waterfall, eBL title under DvP | 2:48.0 | 3:07.0 | 5040-5609 (570) | 40 | 16.6 s | illustration + map |
| S05g | Default cover, parametric cover, arbiter | 3:07.0 | 3:24.0 | 5610-6119 (510) | 37 | 15.3 s | illustration |
| S06 | **Live website demo** (10 shots) | 3:24.0 | 4:26.0 | 6120-7979 (1,860) | 124 | 51.3 s | **website recording R1** |
| S07 | **CargoFlow in claude.ai** (MCP) | 4:26.0 | 4:46.0 | 7980-8579 (600) | 40 | 16.6 s | **recording R2 (claude.ai)** + R3 |
| S08 | Developer platform | 4:46.0 | 4:57.0 | 8580-8909 (330) | 24 | 9.9 s | **recording R3** + code cards |
| S09 | Sponsors, honestly | 4:57.0 | 5:10.0 | 8910-9299 (390) | 28 | 11.6 s | designed board |
| S10 | Proof | 5:10.0 | 5:20.0 | 9300-9599 (300) | 20 | 8.3 s | **recording R4** (explorer, /deployments) |
| S11 | Outro | 5:20.0 | 5:28.0 | 9600-9839 (240) | 14 | 5.8 s | illustration |
| **Total** | | | **5:28.0** | **9,840** | **678** | **280.6 s** | |

The exact spoken lines, split into 98 caption cues, are in `video/captions-v2.json` (generated and checked by script;
re-time cues there if a line changes, then update this file).

---

## Visual system (applies to every scene)

**Stage.** White (`#FFFFFF`) and paper (`#F7F9F4`) grounds only. Paper scenes carry a faint 24 px dot grid in ink at
4% opacity, like ledger paper, so the frame never looks empty. One dark moment only: the S04 statement card and the
S11 outro use the navy gradient (`#0B1B2B` → `#13293D`, top-left to bottom-right) as a deliberate change of key.

**Ink and colour.** Everything is drawn in navy ink (`#0B1B2B`) with 3 px strokes at 1080p and flat fills from the
asset palette. Colour has jobs, and nothing else gets it:

| Colour | Only for |
|---|---|
| Lime `#C6F432` | the one key word of each on-screen line; the active milestone ring; "capital available" fills; highlighter on source pages |
| Lime → emerald gradient (`#C6F432` → `#00C46A`) | money actually moving (tranche fill, payout bars) |
| Emerald `#00C46A` | something the chain verified (released, proof verified, source-verified) |
| Amber `#FFB020` | paused, held |
| Red `#E5484D` | out-of-band readings and nothing else |
| Teal `#0A5A73`, slate `#5B6B7B`, mist `#EEF2EA`, line `#DCE3DA` | secondary UI, map water tint, labels |

**Type.** Space Grotesk 600-700 for on-screen lines (max seven words, one line where possible, 64-96 px). Inter 500 for
labels and source tags. JetBrains Mono for every number, temperature, hash and amount, so numbers read as data, not
decoration. Source tags: bottom-left, Inter 18 px, ink at 60%, format `Source · publisher · document · date`, on
screen for as long as the number is.

**Camera grammar.** A 2D orthographic camera over three layers: background (paper grid or map, parallax 0.3),
midground (characters and objects, 1.0) and an unmoving overlay (captions, source tags, UI callouts). Three moves
only, each motivated by the voice-over:

- **Lean-in**: scale 1.00 → 1.06 over 60 frames, ease in-out cubic, when a number or a consequence lands.
- **Truck**: lateral move between characters or along the route, ease in-out quint, only when the subject changes.
- **Rack**: background blur 0 → 6 px over 12 frames to hand attention to a card in front.

No idle drift, no shake, no rotation, no 3D tilt. Idle life comes from the characters only (breath, blink, a weight
shift every 4-6 s).

**Transitions.** (1) **Match cut on shape**: a container door becomes a document, an LCD digit becomes a mono number,
a milestone ring becomes a UI pill. (2) **Route wipe**: the navy route line draws across the frame and the next scene
is revealed behind it (the film's through-line, see below). (3) **Hard cut** onto source screenshots and onto the
browser, on the first syllable of the line. No glitch, no light leaks, no whoosh library.

**The through-line.** One navy line runs through the whole film. In S01 it is the pencil line Meera draws from Pune
to Singapore on her desk map. In S05 it becomes the sea route on the map, then the milestone timeline under it. In S06
it is the route on the live app's map. In S11 it closes as the underline beneath the tagline. Animators: build it as
one `RouteLine` component with `progress`, `dash`, `thickness`, and `colorStops` for temperature colouring.

**Banned (founder's direction).** Glowing globes, spinning coins, matrix code, floating "blockchain" cubes, stock
handshakes, lens flares, particle bursts, neon outlines, generic data streams, isometric server racks, AI imagery.
Money is shown as flat USDG bars and stacks that **slide and fill**, never spin. "The chain" is shown as a ledger strip
of blocks drawn like ruled paper rows with a mono hash, never as cubes.

**Source screenshots (S01-S04).** Each sits in a neutral light browser frame (grey chrome, real URL in the address
bar, no CargoFlow branding) at 1280 x 720, centred-right on paper. Sequence: slide in from 40 px right with opacity
(12 f, ease out) → hold 10 f → camera pushes toward the quote box from `highlights.json` until the quote is about
1,100 px wide at frame centre (45 f, ease in-out cubic; use the `@2x` file so text stays sharp) → a paper-coloured
veil (70%) fades over everything except the quote's `lines[]` boxes (10 f) → a lime highlighter stroke (55% opacity,
multiply, 4 px taller than each line box, slightly rounded ends) sweeps each line left to right, 10 f per line,
SFX: one soft marker stroke per line → the key figure lifts out of the page as a typeset card. Never retype a quote;
the page itself is the evidence.

**Browser frame for CargoFlow recordings (S06-S10).** Light chrome: white bar 56 px, three neutral dots, URL pill
showing the real path (`cargoflow.adoranto737.workers.dev/track/...`), frame 1600 x 900 centred, radius 24, lift
shadow. Recording plays at 1:1 inside, with punch-ins to 1.5-1.8x on the UI region named in each shot (12 f ease in,
hold, 12 f ease out). Cursor: system cursor plus a lime ring (28 px, 40% fill) on click. Characters stand outside the
frame edge at 0.55 scale, cut at the hip by the frame bottom, reacting to what the UI does (poses listed per shot).
They never cover a number the voice-over is reading.

**Captions.** Burned in for the social cut only; the main cut ships with `captions-v2.json` as a sidecar. Inter 600,
36 px, ink on a white pill at 92%, bottom centre, max two lines.

**Music.** One original cue, 84 BPM, felt piano, soft mallets, upright bass, light brushed kit from S05a. No risers,
no trailer hits. Voice at -16 LUFS integrated; music bed -20 LUFS, ducked a further 6 dB under the voice; in S06-S08
the bed drops to -26 LUFS so UI sounds read. SFX are foley-like and quiet: paper slide, marker stroke, rubber stamp,
latch, a soft two-note chime for "verified", a dry tick for each epoch.

---

## Cast sheet

All characters are built from the shared rig (`video/src/characters`: `Person`, `Cast`, `rig.ts`). Poses, gestures,
expressions and props below use the rig's own vocabulary so animators can map them directly:
poses `stand | hold | crossed | hips | thinking`; gestures `none | wave | point | present | thumbsUp`;
expressions `neutral | worried | relieved | happy | determined | skeptical | confident | surprised | focused`;
props `tablet | bol | invoice | umbrella | phone | folder | vial | logger`. Gestures enter with the rig's
`gestureEnvelope` (spring in at a cue, spring out at its end); mouth uses `talkOpen` only when that character is the
subject of the line (the narrator is the founder, not a character, so mouths move only in the few "reaction" beats
marked below, never lip-synced to the VO).

| Character | Role | Look (as built in `Cast.tsx`) | Palette | Personality | Signature gesture |
|---|---|---|---|---|---|
| **Meera** (`meera`) | Exporter. Runs a mid-size vaccine export business in Pune; ships through Nhava Sheva to Singapore at 2-8 °C. Illustrative. | White lab coat over a teal top, ink trousers; long dark braid over the right shoulder with a lime tie; a lime stud earring; ID badge on the chest | white, teal, ink, lime accent | Practical, quick, a little tired of waiting for money she has earned; warms up as the evidence works for her | `present` toward the cargo with the tablet in the other hand: "look, it's fine" |
| **Daniel** (`daniel`) | Financier. Runs a credit fund that would lend against shipments if it could see them. | Ink-3 blazer, white shirt, rectangular glasses, short beard, greying temples | ink-3, white, ink | Careful, numerate, not unkind; skeptical until the evidence is in front of him, then decisive | pushes his glasses up, then `crossed` arms; later a single `thumbsUp` |
| **Wei Lin** (`weilin`) | Buyer. Pharma importer in Singapore. | Deep emerald blazer, white blouse, bob haircut, small lime pin | emerald-deep, white, ink | Composed, precise, wants the right cargo and the title papers in the same moment she pays | `hold` invoice, then a small nod and `present` palm-up when she pays |
| **Arbiter** (`arbiter`) | Holds the on-chain dispute role. | Long ink coat, white collar, silver hair and beard, a small badge on the chest | ink-2, white, silver | Calm referee; can resolve a dispute but visibly has no access to the money | `hips`, then an open-palm "stop" (use `present` with the palm facing out) at a locked vault |
| **Insurer** (`insurer`) | Offers default and parametric cover. | Ink-3 hijab, mist cardigan over a teal top | mist, teal, ink-3 | Steady, contractual, quietly confident | opens the `umbrella` prop over Daniel's stack |
| **Carrier** (`carrier`) | Ship's officer who issues the bill of lading. | Officer's uniform as built (navy, cap) | ink, white, lime piping | Formal, brisk | holds out the `bol` with both hands, a small bow of the head |

**Staging rules.** Characters stand on the desk line at y = 860 (full body) or are cropped at the waist in mid-shots.
Two characters share a frame only when they are dealing with each other (Meera-Daniel in S05a, Wei Lin-Meera-Daniel in
S05f). Eye lines always point at the object the VO is talking about. Name cards: white pill, Space Grotesk 34 px name,
Inter 18 px role, appears 6 f after the character settles, holds 2.5 s, first appearance only.

---

## Asset list (code-native, flat)

Every asset is an SVG/React component with props for its states. "States" are what the script calls for; "animation"
is the motion each state needs.

| Asset | Description | States / animation |
|---|---|---|
| **Reefer container** (`assets/Reefer.tsx`, exists) | 40 ft reefer, side elevation and 3/4 front; corrugated walls, the refrigeration unit at the front with an LCD (`ReeferDisplay`) and a status lamp (`StatusLamp`); door end with locking bars; cut-away mode showing two probes inside and vial cartons | `ok` (emerald lamp), `paused` (amber), `excursion` (red), `off`; LCD counts temperature in mono with one decimal; doors open (bars rotate 90°, doors swing 100°, 18 f); cut-away wipe 12 f; frost on walls fades in/out |
| **Feeder ship** | Side elevation container ship, white hull with ink waterline, 5 bays of containers, our reefer in bay 3 marked with a lime corner tag | bob 2 px / 4 s loop; bow wave as 3 ink strokes; moves along the route on the map at constant speed; scale for map (24 px) and stage (1,100 px) |
| **Port cranes (STS gantry)** | Nhava Sheva quay: two ship-to-shore gantry cranes, ink line drawing with mist fills | trolley travels along boom; spreader lowers, locks container (click SFX), lifts; used in S01 loading and S05f Singapore unloading |
| **Data logger** (prop `logger`) | Small white logger with an LCD, one LED, a lanyard | LCD shows temp; LED blinks each reading; **signing**: a tiny mono signature glyph (`sig`) flicks out from the logger to each reading card (6 f) |
| **Probes** | Two cables with tips inside the reefer, labelled `probe-1`, `probe-2` in mono tags | tip pulse on each reading; probe-1 tag turns red during excursion |
| **Reading card** | 120 x 64 white card: sensor id, time, temperature (mono), tiny lat/lon | drop in a row of eight; red text when out of band; flips face-down (back shows a hatched pattern) when it becomes private |
| **Epoch tray** | A ruled tray that holds 8 reading cards per sensor, two rows | fills left to right; when full, the cards compress into a **fingerprint chip** (Merkle root): a rounded chip with a mono hash `0x7e79…40c6` |
| **Ledger strip (the chain)** | A horizontal strip of ruled rows, each a "block" with a mono number and hash, drawn like a bank ledger | new row writes in from left (typewriter, 10 f); a committed chip slots into a row; an emerald tick when a contract verifies |
| **Fusion meter** | Three-segment bar per time step: fine (emerald 30%), violated (red 30%), unknown (mist) | segments re-proportion per step; a separate **conflict gauge** (semicircle, 0-100%) with a policy notch at 30% |
| **Score dial** | 0-100 dial, mono numerals, a needle | needle eases to the score; seven **penalty chips** (`physical`, `conflict`, `freshness`, `route`, `source`, `fraud`, `coverage`) drop out of a "100" block to leave the score |
| **Device badges** | Three small cards: `software key`, `passkey`, `secure element`, each with an icon (key, fingerprint, chip) and a reliability weight in mono (95.00%, 97.00%, 99.00%) | slide up in a row; the active device glows lime outline |
| **Escrow vault** | Not a bank safe cliché: a glass-fronted cabinet with five drawers, one per milestone, each holding a USDG bar stack; a small mono label `ReceivableVault` | drawers slide out to release (14 f); amber latch bar drops across all drawers on pause (stamp SFX); latch lifts on resume |
| **USDG bars** | Flat rounded bars with `USDG` in mono and the amount; stack of five | slide along paths with ease in-out; **never spin**; split into proportional bars at settlement |
| **Settlement waterfall** | One horizontal bar (invoice) that splits into labelled segments: principal, fee, residual | segments separate with 8 px gaps, labels type on; lime→emerald fill for the money moving |
| **Documents** | Invoice (A4, ruled, `INVOICE` header, mono total), paper bill of lading (`BILL OF LADING`, carrier stamp) | stacks; slide; fan out; a frosted pane can slide over them |
| **eBL title card** | The electronic bill of lading as a card: `CFEBL #12` (illustrative number), document fingerprint, shipper, consignee, a **possession history** list | card travels between holders on a dotted path; history list gains a row each move (`Issued to Meera`, `Bound into escrow`, `Released to Wei Lin`) |
| **Phone with passkey** (prop `phone`) | Modern phone, white UI; WebAuthn sheet with a fingerprint glyph and "Continue with passkey" | fingerprint ring fills (20 f), tick |
| **Notification card** | In-app notification: bell icon, `Proof ready`, `Review and sign` button; small channel icons row (in-app, Telegram, email, Slack, webhook) | drops from top-right with a 1-bounce spring; channel icons light in sequence |
| **Proof envelope** | Sealed envelope stamped `Groth16`, flap closed, eight face-down reading cards visible as a thickness inside | readings slide in face-down, flap seals, stamp lands; contract (ledger row) opens it with a tick, the cards are never shown face-up |
| **AI ratchet** | A ratchet wheel and pawl labelled `stricter` on one side; a small "monitor" eye icon on the pawl | wheel can click only toward `stricter`; a nudge toward `looser` is blocked by the pawl (tiny shake, 6 f) |
| **Cover umbrella** (prop `umbrella`) | Insurer's umbrella, ink canopy with a lime trim | opens over Daniel's USDG stack; on payout, bars fall from the canopy into his stack |
| **Calendar strip** | 60 day tiles, ink outline; days 1-52 fill one by one | fills at 4 days per 3 f during the line, ends on `52` in lime |
| **Cash gauge** | Meera's working-capital bar, emerald → amber as it drains | drains as three expense chips (`vials`, `reefer`, `freight`) stamp `PAID` |
| **Frosted pane** | A pane of frosted glass (blur 14 px + 8% white) | slides over the container in Daniel's view; in S04 it wipes clear, left to right, following the route line |
| **Browser frame** | See visual system | URL types on when a page changes |

### Map kit (`video/src/maps`)

Flat regional map, never a globe. Equirectangular projection clipped to 60°E-110°E, 8°S-26°N.

- **Land**: paper-shade fill (`#ECEFE7`), coastline 1.5 px ink at 70%; **sea**: white with a 2% teal tint and 30° hatching
  only near coasts. Countries unlabelled except `INDIA`, `SRI LANKA`, `MALAYSIA`, `SINGAPORE` in Inter 600 letter-spaced at 40% ink.
- **Ports** (from the live run's route and the app's port list): Nhava Sheva 18.95°N 72.95°E; Colombo 6.95°N 79.85°E;
  Singapore 1.264°N 103.82°E. Port marker: ink circle 10 px with a white core; label in Inter 600.
- **Route**: the through-line; sea route generated like the app's (`searoute-js`), Nhava Sheva → around Sri Lanka →
  Malacca Strait → Singapore; draws on with `progress`; in the live-track state it is coloured per epoch by
  temperature (emerald in band, red out of band), exactly like the app's map.
- **Milestone place circles**: lime ring 3 px with 12% lime fill, radius drawn to scale (illustrative 50 km at
  Colombo, labelled `M3 · within 50 km of Colombo`); number badge `M1`…`M5` on the route. Held state: ring turns amber,
  dashed, with a mono distance chip (`412 km away`).
- **Live position**: ink dot 12 px with a lime halo that breathes (scale 1.0 → 1.6, opacity 0.5 → 0, 1.5 s loop);
  a small ship glyph follows the dot when zoomed in.
- **Corridor**: the policy's route-deviation corridor as a 6% ink band either side of the route (25 km in the live run).

---

## S00 · Cold open · 0:00.0-0:10.5 (frames 0-314)

**Voice-over** (20 words)

> This reefer carries vaccines to Singapore.
> It's at five point two degrees.
> Its lenders can't see that.
> They see paperwork.

**On screen**

| In-out | Text |
|---|---|
| 0:01.0-0:05.8 | LCD only: `5.2 °C` (mono, on the reefer's own display; no other type) |
| 0:06.1-0:10.3 | Lender's screen: `CF-2026-SG01 · In transit · Documents received` with a neutral grey tick |

**Composition and camera.** A vertical split, but not 50/50. Left two thirds: paper stage, the reefer in 3/4 front
view filling the left half, its refrigeration unit facing camera, LCD at eye level; the ship's deck rail is a single
ink line under it; a sliver of white sea with three hatching strokes. Right third: a laptop screen, drawn flat, showing
a plain document portal (two PDF tiles `Invoice.pdf`, `Bill of lading.pdf`, a grey status row). The split line is the
reefer's own door edge, so the cut between "reality" and "the lender's view" is drawn by the object.

| Time | Beat |
|---|---|
| 0:00.0 | Fade from white (8 f). Reefer, status lamp `ok`. Probe ticks are audible before anything moves. |
| 0:00.5 | Camera lean-in toward the LCD (1.00 → 1.06, 90 f). LCD wakes, counts `4.8 → 5.2` (mono). |
| 0:03.3 | "five point two": LCD settles on `5.2 °C`; a single tick SFX. |
| 0:06.1 | "Its lenders": rack focus to the right third (left blurs to 6 px); the laptop slides in 30 px from the right. |
| 0:08.4 | "They see paperwork.": the two PDF tiles fan out slightly (one 6 px nudge, no bounce). Hold to the end. |
| 0:10.2 | Match cut: the PDF tile's rectangle becomes the edge of Meera's desk map in S01. |

**Characters.** None. The film starts with the object.

**Music and SFX.** No music for the first 6 s: a faint ship hum (low, filtered), the logger's single tick at each
reading. On "Its lenders", one sustained low piano note enters and carries into S01.

---

## S01 · Meera and the 52-day wait · 0:10.5-0:33.5 (frames 315-1004)

**Voice-over** (49 words)

> Meet Meera. She exports vaccines from Pune.
> She pays for the vials, the reefer and the freight today.
> Her buyer in Singapore, Wei Lin, pays later.
> In India, half of B2B sales are made on credit, with payment terms averaging fifty-two days.
> About two months of cash, at sea.

**On screen**

| In-out | Text | Source tag |
|---|---|---|
| 0:11.2-0:13.8 | Name card `Meera` / `Exporter · vaccines, Pune` + `Illustrative` chip | |
| 0:14.1-0:18.6 | three expense chips: `vials` `reefer` `freight`, each stamped `PAID` | |
| 0:18.9-0:22.3 | Name card `Wei Lin` / `Buyer · pharma importer, Singapore` | |
| 0:22.6-0:26.7 | Atradius web page (establishing), then the PDF quote | `Source · Atradius · Payment Practices Barometer, India 2025 · 29 Jul 2025` |
| 0:26.8-0:29.3 | typeset card `52 days` (mono 160 px) with `average payment terms` (Inter) | same |
| 0:29.6-0:32.5 | `About two months of cash, at sea.` (lime on "cash") | |

**Composition and camera.**

| Time | Beat |
|---|---|
| 0:10.5 | Meera's packing room, paper stage, wide. Left: Meera `stand`, `neutral`, holding the `tablet`, looking at a desk map on which she draws the through-line from Pune to Singapore with a pencil (line draws 40 f). Right: two vial cartons and a pallet. |
| 0:11.2 | Name card. Meera looks up to camera on "Meet Meera" (`look: front`, `happy` for 20 f, back to `focused`). |
| 0:14.1 | Truck right 400 px to a strip of three expense chips on the wall like price tags. Each stamps `PAID` in ink on "vials", "reefer", "freight" (stamp SFX ×3). Beneath, a **cash gauge** drains one third per stamp, emerald → amber. Meera `worried`, glances at the gauge. |
| 0:18.9 | Split screen by the through-line: the line continues off Meera's map and across the frame; Wei Lin appears on the right half in a Singapore office (window with two simple tower outlines, no skyline cliché), `hold` invoice, `neutral`. Name card. |
| 0:22.6 | **Hard cut** to the Atradius page in the browser frame: `atradius-india-top.png` (title "B2B payment practices trends in India 2025", 29 Jul 2025) for 30 f, then a paper slide to `atradius-india-pdf-terms.png`, push to the quote box, veil, highlighter sweeps the two lines (`50% of all B2B sales are currently made on credit, / with average payment terms standing at 52 days.`). |
| 0:26.8 | "fifty-two days": the `52` lifts off the page as the typeset card; behind it the **calendar strip** fills days 1-52 (4 days per 3 f), the 52nd tile lime. |
| 0:29.6 | Back to stage: the reefer on a ship at sea, small, centre; Meera's cash gauge at amber next to it, tied to the container by a dotted line. Lean-in on "cash". |

**Characters.** Meera `stand` → `worried` at the stamps, `thinking` (hand to chin) as the calendar fills. Wei Lin
`hold` invoice, calm, `neutral`; she is not the villain, she is a normal buyer on normal terms.

**Assets.** Desk map, pencil, vial cartons, expense chips, cash gauge, calendar strip, ship, reefer (small), Atradius
screenshots.

**Transition.** On "at sea" the dotted line from the gauge to the container stretches as the ship moves right, then
snaps (a soft paper-tear SFX). Cut to Daniel.

**Music and SFX.** Felt piano enters in earnest at 0:11.0, sparse. Stamp ×3, marker stroke ×2 on the highlighter, a
dry page-turn on the PDF slide.

---

## S02 · Daniel lends blind · 0:33.5-1:00.5 (frames 1005-1814)

**Voice-over** (58 words)

> Daniel runs a credit fund.
> He'd finance it, but he can't see it.
> He gets an invoice and a bill of lading: paperwork, not the container.
> So he lends blind, or not at all.
> The Asian Development Bank puts the trade finance gap at two and a half trillion dollars.
> Small firms see forty-one percent of requests rejected.

**On screen**

| In-out | Text | Source tag |
|---|---|---|
| 0:34.0-0:36.0 | Name card `Daniel` / `Financier · credit fund` | |
| 0:43.7-0:45.4 | `Paperwork, not the container.` (lime on "container") | |
| 0:45.7-0:49.0 | two stamps on the application: `BLIND` / `DECLINED` | |
| 0:49.3-0:56.0 | ADB news page, quote highlighted; then typeset `$2.5 trillion` + `about 10% of global trade` | `Source · Asian Development Bank · news release · 15 Jan 2026` |
| 0:56.3-1:00.3 | same page, SME quote highlighted; typeset `41%` + `of SME trade finance requests rejected` | same, plus `ADB Global Trade Finance Gap Survey · Dec 2025` |

**Composition and camera.**

| Time | Beat |
|---|---|
| 0:33.5 | Daniel's office: a desk, a window to his right. He sits on the desk edge (`stand` cropped mid-shot), `neutral`, reading on his `phone`. Name card. |
| 0:36.3 | "but he can't see it": through his window we see the reefer on the ship, but the **frosted pane** slides across the window (24 f); the container becomes a soft blur. Daniel turns toward it, `skeptical`. |
| 0:39.9 | An invoice and a paper bill of lading slide onto his desk from the left (paper SFX). He picks up the bill (`hold`, prop `bol`). |
| 0:43.7 | Lean-in: his glasses reflect the documents (two tiny white rectangles on the lenses). The line `Paperwork, not the container.` sets above. |
| 0:45.7 | "blind": stamp `BLIND` lands across the frosted window. "or not at all": a second stamp `DECLINED` lands on the application on his desk. Daniel pushes his glasses up, then `crossed`. |
| 0:49.3 | **Hard cut** to `adb-news-top.png` in the browser frame (both ADB quotes are on this one frame). Push to the gap quote box (`adb-news-gap` lines), highlight. |
| 0:53.1 | "two and a half trillion dollars": `$2.5 trillion` lifts out (mono, 160 px), with `about 10% of global trade` under it in Inter. The `10%` is not spoken, only shown. |
| 0:56.3 | Camera travels down the same page to the SME sentence (one continuous move, 20 f), highlight `SME rejection rates for trade finance (41%) ... (40%)`. `41%` lifts out. Optional 15 f insert of `adb-survey-gap.png` (the brief, Dec 2025) under the source tag to show the figure is the survey's. |

**Characters.** Daniel: `neutral` → `skeptical` (pane) → `focused` (documents) → `crossed` arms with a small
headshake on "or not at all". He is reasonable; the problem is what he cannot see.

**Assets.** Office window, frosted pane, invoice, paper bill of lading, application form, two stamps, ADB screenshots.

**Transition.** The `41%` card shrinks to a small chip and drops into the corner as the camera returns to the
frosted window; through the blur the reefer's lamp starts to blink. Cut to S03 on "And".

**Music and SFX.** Piano continues; on the ADB beats the bass enters, one note per bar. Two rubber stamps. Marker
strokes on the highlights.

---

## S03 · The cargo is fragile · 1:00.5-1:14.0 (frames 1815-2219)

**Voice-over** (28 words)

> And the cargo is fragile.
> Biopharma loses about thirty-five billion dollars a year to failures in temperature-controlled logistics.
> The logger records every degree.
> The money never reads it.

**On screen**

| In-out | Text | Source tag |
|---|---|---|
| 1:03.3-1:08.7 | Air Cargo News article (crop to the article column), IQVIA sentence highlighted; typeset `$35 billion a year` | `Source · IQVIA Institute, via Air Cargo News · 26 Jul 2019` |
| 1:09.0-1:13.5 | none: the logger and the ledger speak for themselves | |

**Composition and camera.**

| Time | Beat |
|---|---|
| 1:00.5 | Reefer cut-away (the wall wipes away, 12 f): two probes, vial cartons, cold frost on the walls. Vials in a tray in the foreground, crisp. |
| 1:03.3 | **Hard cut** to `aircargonews-iqvia-loss.png`, cropped to `safeCrop` (the article column only, no ads). Highlight the full sentence. `$35 billion a year` lifts out. |
| 1:06.7 | Back to the cut-away: a short warm-up shown honestly as data, not drama: probe-1's LCD climbs `6.1 → 8.4` (red past 8.0), frost recedes from one wall, the front vial tray greys by 30%. No smoke, no alarms. |
| 1:09.0 | Two-shot by split: left, the **data logger** with a scrolling trace (ink line, red above the band), LED blinking with each tick; right, Daniel's desk ledger row `CF-2026-SG01 · In transit`, static. A dashed line tries to connect them across the split and breaks in the middle (12 f). |
| 1:11.4 | "The money never reads it.": hold on the broken line; only the logger tick continues. |

**Characters.** None on screen except a Daniel cameo at frame edge in the last beat: `focused` on his ledger, he
does not look at the logger. The point is structural, not personal.

**Transition.** The broken dashed line becomes the left edge of the README screenshot (match cut on the line).

**Music and SFX.** Music thins to a single piano note and bass on "fragile"; on "The money never reads it" the music
stops and only the logger tick plays for 12 f.

---

## S04 · The line · 1:14.0-1:26.0 (frames 2220-2579)

**Voice-over** (25 words)

> A lender sees paperwork, not the container.
> CargoFlow lets the cargo's own sensor evidence decide how much capital is available.
> On chain, milestone by milestone.

**On screen**

| In-out | Text |
|---|---|
| 1:14.4-1:17.3 | CargoFlow README on GitHub, "The problem in one paragraph", the founder's sentence highlighted |
| 1:17.6-1:25.4 | Navy gradient card: `The cargo's own evidence decides how much capital is available.` (lime on "evidence") |
| 1:23.4-1:25.4 | Below it, smaller: `On chain · milestone by milestone` + CargoFlow logo lock-up (light on dark) |

**Composition and camera.**

| Time | Beat |
|---|---|
| 1:14.0 | `cargoflow-readme-lender.png` in the browser frame (crop `safeCrop` to the paragraph), highlighter sweeps `A lender advancing money against a reefer container sees paperwork, not the container, so it either lends blind or does not lend. CargoFlow lets the cargo's own sensor evidence decide how much capital is available, on-chain, milestone by milestone.` (the box covers the first two sentences' lines; extend the stroke to the paragraph end, which is on screen). |
| 1:17.6 | Change of key: the screenshot slides away and the frame becomes the navy gradient. On it, the frosted window from S02, small, centre. The through-line enters from the left and **wipes the frost clear** as it passes (24 f): behind the glass, the reefer with its LCD `4.6 °C` and a thin emerald trace. |
| 1:21.0 | The line continues right, and five milestone pips appear on it; under them a lime bar labelled `capital available` fills the first pip only. |
| 1:23.4 | Logo lock-up resolves above the line (opacity and 0.96 → 1.0 scale, 16 f). Hold. |

**Characters.** None. This is the thesis, said plainly.

**Transition.** Route wipe: the line sweeps down-right and the navy gives way to the paper map of S05a.

**Music and SFX.** A held chord under the README; the full cue (piano, bass, brushes) starts on the logo at 1:23.4,
84 BPM.

---

## S05 · How it works · 1:26.0-3:24.0

Seven beats on one map-and-stage set. The map sits in the upper 60% of the frame (route Nhava Sheva → Singapore);
characters and objects play on the desk line below it. A small corner tag top-right for the whole of S05:
`Reference numbers: 100,000 USDG invoice · 40,000 facility · 3% fee` (from the README).

### S05a · Facility, escrow, place milestones · 1:26.0-1:41.0 (frames 2580-3029)

**Voice-over** (32 words)

> Meera registers the shipment and its policy: two to eight degrees.
> Daniel escrows the facility in USDG.
> It pays out in milestones, each one optionally tied to a place on the route.

**On screen**

| In-out | Text |
|---|---|
| 1:26.4-1:31.1 | Policy card: `2.0-8.0 °C · score ≥ 75 · conflict ≤ 30% · humidity ≤ 85% · shock ≤ 3 g` (the live v3 run's policy) |
| 1:31.4-1:33.8 | `40,000 USDG → escrow` |
| 1:34.1-1:40.4 | Milestone labels `M1`…`M5` on the route; `M3 · within 50 km of Colombo` |

| Time | Beat |
|---|---|
| 1:26.0 | Map draws in: coastlines (20 f), port markers pop in order Nhava Sheva, Colombo, Singapore (6 f apart). Below, Meera `present` toward a **policy card** she has just filled on her tablet; the card slides up next to her. The band `2.0-8.0 °C` is the lime key word. A small ledger row writes `registerShipment · setPolicy` (mono) at the bottom edge: the chain is a ledger, not a cube. |
| 1:31.4 | Daniel enters from the right, `hold` with phone; a stack of five USDG bars (8,000 each) slides from beside him into the **escrow vault**'s five drawers, one drawer per bar (stagger 4 f). The vault's label `ReceivableVault` types on. Daniel `neutral` → a half smile. |
| 1:33.0 | Silent set-up for S05f (no VO about it here): the Carrier steps in at the left edge, `present` with the `bol`; the paper bill turns into the slim **eBL title card** as it leaves his hands (match cut, 8 f), Meera takes it and slots it into a narrow slot on the vault's side; the slot's label reads `title · bound`. 30 f in total, kept small so it does not compete with the money. |
| 1:34.1 | The route draws from Nhava Sheva to Singapore (the through-line, 60 f). Five milestone pips land on it. |
| 1:36.3 | "tied to a place": the camera leans into Colombo; M3's **place circle** expands from the pip to its 50 km ring (lime), label sets beside it. M1, M2, M4, M5 stay as plain pips ("optionally"). |

**Transition.** The camera follows the route back to Nhava Sheva and dives into the reefer on the quay (scale
match from the 24 px ship glyph to the stage reefer).

### S05b · Signed readings, epochs, fusion, score · 1:41.0-2:00.0 (frames 3030-3599)

**Voice-over** (41 words)

> The reefer's logger signs its readings with a device key.
> Eight per sensor close an epoch.
> CargoFlow fuses the two probes, measures their disagreement, and scores the epoch out of a hundred.
> Only a fingerprint goes on chain, with the score.

**On screen**

| In-out | Text |
|---|---|
| 1:41.4-1:45.5 | device badges `software key 95.00%` · `passkey 97.00%` · `secure element 99.00%` (reliability weight) |
| 1:45.8-1:48.3 | `8 readings × 2 probes = 1 epoch` |
| 1:48.6-1:55.3 | `conflict 1.7%` · score `100` (passing epoch) |
| 1:55.6-1:59.4 | `Readings stay off chain. Root + score go on.` |

| Time | Beat |
|---|---|
| 1:41.0 | Reefer cut-away, stage scale. The logger on the inside wall; each probe tick produces a **reading card** that pops out of the logger with a tiny `sig` glyph stamped on it (6 f each). |
| 1:41.4 | The three **device badges** slide up bottom-left; the `software key` badge outlines lime (it is the logger in this story). The passkey and secure-element badges stay neutral: present, not claimed for this shipment. |
| 1:45.8 | Cards fill the **epoch tray**, two rows of eight (probe-1 top, probe-2 bottom), a dry tick per card. Row labels in mono. |
| 1:48.6 | Above the tray, eight **fusion meter** columns (one per time step) re-proportion as the cards land: mostly emerald "fine". The **conflict gauge** needle stays low: `1.7%` (the live run's passing conflict), well under the 30% notch. |
| 1:52.0 | The **score dial** eases to `100`; the seven penalty chips sit in a neat row beside it, all at `0`, readable as the formula: `100 - physical - conflict - freshness - route - source - fraud - coverage`. |
| 1:55.6 | The sixteen cards flip face-down and compress into a **fingerprint chip** `0x…` (Poseidon root, mono). The chip and the score slot into a new row of the **ledger strip** (`commitEpoch`). The raw cards slide back into a drawer labelled `Postgres` that closes. |

**Characters.** Meera appears in a small inset bottom-right, `focused`, watching her tablet as the score lands;
a tiny `relieved` on 100.

### S05c · Release, place hold, humidity and shock · 2:00.0-2:12.0 (frames 3600-3959)

**Voice-over** (23 words)

> Pass the policy in the right place, and a tranche goes to Meera.
> Wrong place? It waits.
> Humidity and shock have limits too.

**On screen**

| In-out | Text |
|---|---|
| 2:00.4-2:05.9 | `M1 released · 8,000 USDG` (emerald) |
| 2:06.2-2:07.8 | App explanation line, verbatim from the backend: `Milestone 3 waits until the cargo is within 50 km of Colombo; it is 412 km away` (amber, `not a failure, not a pause`) |
| 2:08.1-2:10.6 | `humidity ≤ 85% · shock ≤ 3 g` |

| Time | Beat |
|---|---|
| 2:00.0 | Split: map top, vault bottom. The ledger row's emerald tick fires (chime). Drawer M1 slides out, its 8,000 bar travels along a short path to Meera (lime→emerald trail), drawer closes empty. Meera `happy`, `thumbsUp`. On the map, the live position dot moves off Nhava Sheva; M1 pip turns emerald. |
| 2:03.4 | M2 follows quickly the same way (half the time), pip emerald. |
| 2:06.2 | "Wrong place?": the camera leans to Colombo; the position dot is short of the M3 ring. Ring goes amber and dashed, a distance chip `412 km away` appears, the explanation line sets under it. The vault drawer M3 stays shut with a small amber clock icon on it; nothing else changes (no pause latch). |
| 2:08.1 | Two small gauges appear beside the epoch tray: humidity (a droplet, needle at 66% under an 85% notch) and shock (a tiny spring, needle at 0.2 g under a 3 g notch). Both emerald. |

### S05d · Excursion, conflict, pause, the AI ratchet · 2:12.0-2:31.0 (frames 3960-4529)

**Voice-over** (39 words)

> Off Sri Lanka, probe one climbs to eleven point seven degrees.
> Probe two holds at four point six.
> The sensors disagree, the score falls to forty-eight, and the facility pauses.
> An AI monitor can make things stricter.
> Never looser.

**On screen**

| In-out | Text |
|---|---|
| 2:12.4-2:17.0 | probe-1 LCD `5.2 → 6.8 → 8.9 → 10.4 → 11.7 °C` (red from 8.9) |
| 2:17.3-2:20.1 | probe-2 LCD `4.6 °C` (ink) |
| 2:20.4-2:23.8 | conflict `74.8%` vs `≤ 30%`; score `48` vs `≥ 75` (the live run's milestone-3 epoch) |
| 2:23.9-2:25.5 | `PAUSED` (amber) |
| 2:25.8-2:29.8 | `stricter only` |

| Time | Beat |
|---|---|
| 2:12.0 | Map: the position dot just past Sri Lanka's southern tip (illustrative), the route behind it emerald. Cut to the cut-away: probe-1's tip pulses faster; its LCD climbs through the five readings (the exact demo readings), turning red from 8.9. The route segment behind the dot on the map turns red in sync. |
| 2:17.3 | Probe-2's LCD stays at `4.6`, steady; frost holds on its side of the wall. |
| 2:20.4 | The epoch tray fills: probe-1 row ends in red cards, probe-2 row ink. The fusion columns for the last five steps swing to large red "violated" and the conflict needle sweeps past the 30% notch to `74.8%` (the needle overshoots 4% and settles). The score dial needle falls from 100 to `48`; the `physical` and `conflict` penalty chips drop out of the 100 block, sized to their points. |
| 2:23.9 | The vault's amber **latch bar** drops across all drawers (stamp SFX). On the map, the live dot ring turns amber. A ledger row writes `pauseFinancing`. Meera `worried` in her inset; Daniel appears in a second inset, `focused`, not alarmed: he can see it now. |
| 2:25.8 | The **AI ratchet** appears beside the vault, the monitor eye on its pawl. It clicks once toward `stricter` (a request for more proof). Then a hand-drawn arrow pushes toward `looser` and the pawl blocks it (6 f shake). |
| 2:29.0 | "Never looser.": hold on the blocked ratchet, 20 f. |

**Music and SFX.** The kit drops out for two bars at 2:20; one low muted mallet note on the pause; the latch stamp is
the loudest SFX in the film, still modest.

### S05e · Automatic zero-knowledge recovery · 2:31.0-2:48.0 (frames 4530-5039)

**Voice-over** (36 words)

> Once probe two has eight fresh readings in band, CargoFlow proves they're inside the band, in zero knowledge, without revealing any of them.
> Meera gets a notification and signs.
> The contract checks the proof.
> Releases resume.

**On screen**

| In-out | Text |
|---|---|
| 2:31.4-2:35.1 | `probe-2 · 8 fresh readings · in band` |
| 2:35.2-2:41.1 | `Groth16 · readings never revealed` |
| 2:41.4-2:43.9 | notification `Proof ready · Review and sign` + channel row `in-app · Telegram · email · Slack · webhook` |
| 2:44.2-2:46.3 | `Proof verified on chain` (emerald) |
| 2:46.6-2:47.4 | `ACTIVE` (emerald) |

| Time | Beat |
|---|---|
| 2:31.0 | Epoch tray resets; only probe-2's row fills with eight new ink cards, each with a small emerald dot (in band). Probe-1's row stays empty and greyed. |
| 2:35.2 | The eight cards flip **face-down** and slide into the **proof envelope**; flap seals; `Groth16` stamp lands. Over the envelope a thin bracket reads `bound to: chain · verifier · controller · shipment · epoch · policy · submitter · pause count` (mono, small, types on fast; it is on the README). |
| 2:41.4 | Cut to Meera, mid-shot. A **notification card** drops in beside her (`Proof ready`), the channel icons light in sequence. She lifts her `phone`, taps `Review and sign`, signs (`determined` → `relieved`). |
| 2:44.2 | The envelope travels from her phone to the ledger strip; a row writes `resumeWithProof`, the envelope opens inside the row (we never see the cards face-up) and the row's emerald tick fires (two-note chime). |
| 2:46.6 | The amber latch lifts off the vault; the map dot's ring returns to lime; drawer M3 slides out and its bar travels to Meera. |

### S05f · Delivery, settlement waterfall, eBL under documents against payment · 2:48.0-3:07.0 (frames 5040-5609)

**Voice-over** (40 words)

> In Singapore, Wei Lin confirms delivery and pays.
> That one payment repays Daniel with his fee, sends Meera the rest, and hands Wei Lin the electronic bill of lading: title to the cargo.
> Documents against payment, enforced by the contract.

**On screen**

| In-out | Text |
|---|---|
| 2:48.4-2:51.7 | `M4 · M5 released` then `Delivered` |
| 2:52.0-2:57.1 | waterfall: `100,000 invoice → 40,000 principal + 1,200 fee → Daniel · 58,800 → Meera` |
| 2:57.2-3:02.7 | eBL card `CFEBL` with possession history: `Issued to Meera · Bound into escrow · Released to Wei Lin` |
| 3:03.0-3:05.9 | `Documents against payment` (lime on "against") |

| Time | Beat |
|---|---|
| 2:48.0 | Map: the dot completes the route into Singapore; M4 and M5 pips go emerald in quick succession (drawers slide, bars to Meera). Stage: Singapore quay, the STS crane lowers the reefer onto the quay (lock click). Wei Lin `stand`, checks the reefer's LCD (`4.6 °C`), small nod, taps `Confirm delivery` on her tablet. |
| 2:52.0 | Wei Lin `present` palm-up: a single 100,000 USDG bar slides from her into the vault. The **settlement waterfall** forms in one motion beneath the vault: the bar splits into three segments with 8 px gaps: `40,000 principal` + `1,200 fee` (slides to Daniel, who gives one `thumbsUp`), `58,800 residual` (slides to Meera). Lime→emerald fills on all three as they move. A mono tag under the bar: `one transaction · settle`. |
| 2:57.2 | The slim **eBL title card** Meera slotted into the vault in S05a (label `title · bound`) is still there. Now it slides out on the same beat as the payout, follows a dotted path to Wei Lin, and its possession history gains `Released to Wei Lin` (row types on). The Carrier appears small at the left edge, `stand`, a brief nod: he issued it. |
| 3:03.0 | Lean-in on the eBL card in Wei Lin's hand and the 58,800 bar in Meera's, side by side. Line sets: `Documents against payment`. Footnote tag: `Designed around MLETR concepts; not a legal compliance claim.` |

### S05g · Default cover, parametric cover, the arbiter · 3:07.0-3:24.0 (frames 5610-6119)

**Voice-over** (37 words)

> If it goes wrong, an insurer can cover Daniel's drawn principal.
> Parametric cover pays after a set run of failed epochs, proven from the evidence on chain.
> The arbiter resolves disputes, but can never release a tranche.

**On screen**

| In-out | Text |
|---|---|
| 3:07.4-3:12.0 | `Default cover · pays min(cover, drawn principal)` |
| 3:12.3-3:19.0 | `Parametric · N failed epochs in a row → principal to Daniel + salvage to Meera` |
| 3:19.3-3:23.5 | `Dispute role · resolve, resume or default · no release` |

| Time | Beat |
|---|---|
| 3:07.0 | A "what if" set: the stage desaturates by 20% and a small `what if` tag sits top-left. The Insurer enters, opens the **cover umbrella** over Daniel's stack of drawn principal (`8,000 × 2` bars, illustrative mid-voyage default). A premium bar slides from Daniel to the Insurer (small). |
| 3:12.3 | The ledger strip shows three consecutive red rows (`failed`, `failed`, `failed`), bracketed `N = 3` (illustrative N). A mono check traces along the rows in order (`commit order verified`). The umbrella "pays": bars fall from the canopy into Daniel's stack, and a small salvage bar goes to Meera. |
| 3:19.3 | The Arbiter in front of the vault, `hips`. He can stamp a dispute card `resolved` (his `folder` prop), but when he reaches toward a vault drawer it stays locked: a small padlock with `no role` appears on the drawers; he shows an open palm (`present`, palm out), `confident`. |
| 3:23.5 | Colour returns; quick route wipe into the browser. |

---

## S06 · Live website demo · 3:24.0-4:26.0 (frames 6120-7979) · **recording R1**

The founder's screen recording of the redesigned site, framed in the browser mock, with characters at the frame edge.
The click path for every shot is in **Shot list R1** below. Narration (124 words), anchored to shot starts:

| Shot | In-out (frames) | Voice-over | UI on screen (punch-in) | Character beside the frame | Overlay (small, top-right) |
|---|---|---|---|---|---|
| D1 landing | 3:24.0-3:28.0 (6120-6239) | "Here's the live app, on Robinhood Chain testnet." (8) | landing hero; header with network + health pill | Meera, left edge, `wave` | `LIVE · Robinhood Chain Testnet` (whole S06) |
| D2 exporter wizard | 3:28.0-3:37.0 (6240-6509) | "As Meera, I register the shipment, pick the pharma template, and ask for twenty USDG in five milestones." (18) | wizard steps Shipment → Cold-chain policy (Pharma template fills 2-8 °C, humidity, shock) → Financing (20, 5, 3%) → Sign; three wallet confirmations at 6x; toasts | Meera `point` at the template chip | `Real testnet transactions` |
| D3 financier funds | 3:37.0-3:42.0 (6510-6659) | "Daniel approves and deposits twenty USDG into escrow." (8) | /financier facility card: settlement preview; `Facility funded` toast | Daniel, right edge, `hold` phone → `thumbsUp` | `20 USDG escrowed` |
| D4 carrier eBL | 3:42.0-3:49.0 (6660-6869) | "The carrier issues the bill of lading on chain, and Meera binds it to the facility." (16) | /ebl: Issue bill of lading (document fingerprint, consignee) → bill page; shipment TitleCard: Bind bill of lading → `In escrow` | Carrier `present` with the `bol`, then Meera `point` | `ERC-721 title · CFEBL` |
| D5 transit and releases | 3:49.0-3:56.0 (6870-7079) | "Transit starts. The logger's readings come in, two epochs pass, two tranches paid." (13) | Start transit; Submit readings result table (`Passed: milestone released` ×2); map with the live dot; milestone timeline M1, M2 released | Meera `focused` → `happy` | `Readings never go on chain. Only roots.` |
| D6 excursion and pause | 3:56.0-4:03.0 (7080-7289) | "Then the excursion. Paused, with the reasons in plain words, and who acts next." (14) | out-of-band warning → `Failed: facility paused`; Paused pill (amber); temperature chart with probe-1 above the band; ExplainPanel "Where it stands" + "What each party does now" | Meera `worried`; Daniel small at right, `focused` | none |
| D7 recovery | 4:03.0-4:10.0 (7290-7499) | "The proof is ready. I review, sign, and the facility is active again." (13) | notification bell `Proof ready` → `Review and sign` → Resume with a proof → `Facility resumed by zero-knowledge proof`; proof card `Groth16 proof verified on-chain`; pill Active | Meera `determined` → `relieved` | `Readings stay private · Groth16` |
| D8 buyer with passkey, settled | 4:10.0-4:17.3 (7500-7718) | "Wei Lin signs in with a passkey, no extension, gas sponsored. She confirms and pays. Settled." (16) | wallet modal: Continue with passkey → Sign in with an existing passkey → OS passkey sheet (fingerprint); `Passkey account` chip; Confirm delivery; Approve 30 / Pay; `Invoice paid and settled`; Settled pill; TitleCard `With the buyer` | Wei Lin, right edge, `hold` phone → `present` | `30 USDG in → 20.6 Daniel · 9.4 Meera (residual)` |
| D9 certificate | 4:17.3-4:20.8 (7719-7823) | "And a settlement certificate for the records." (7) | Download certificate → PDF opens in a new tab (settlement certificate) | none (clean frame) | none |
| D10 market | 4:20.8-4:26.0 (7824-7979) | "Other shipments find capital in the market, with a suggested fee." (11) | /market: open requests; Review offers; Offer modal with **Suggested fee** band (low / mid / high bps with reasons) | Daniel `thinking` → `point` at the fee band | `Financiers choose the fee` |

**Edit notes.** Jump cuts between wizard steps; speed-ramp every wallet wait and the proving wait to under 0.5 s;
never fake a state the app did not reach. When a number is spoken, punch in so it is at least 40 px tall on the final
frame. Keep the browser frame static; only the punch-ins move. Characters change pose on the UI event, not on the VO.

**If something cannot be recorded honestly**, change the line, not the picture: if gas sponsorship is not active for
the passkey account (the wallet shows "Gas sponsorship isn't on"), cut "gas sponsored" from D8 (the cue then reads
"Wei Lin signs in with a passkey, no extension."); if the notification does not arrive before the take runs out of
evidence freshness, record the manual path (Resume with a proof → Sign and prepare proof) and say "I sign, CargoFlow
proves it, and the facility is active again." (same length).

**Music and SFX.** Bed at -26 LUFS. Real UI sounds kept. The S05 latch, chime and slide SFX return, quietly, on the
real events (pause, verified, release), so the animation and the product rhyme.

---

## S07 · CargoFlow in claude.ai · 4:26.0-4:46.0 (frames 7980-8579) · **recording R2** (+ R3 for the first beat)

**Voice-over** (40 words)

> CargoFlow also works inside Claude.
> Add the remote MCP server as a custom connector, then just ask.
> It reads the fleet, explains a pause, and prepares transactions with a link to sign in the app.
> It never holds a key.

**On screen**

| In-out | Picture (shot list R2) | Overlay |
|---|---|---|
| 4:26.0-4:28.8 | M1: CargoFlow /developers, "Use CargoFlow in Claude" panel, click **Copy URL** | `cargoflow-mcp.adoranto737.workers.dev/mcp` |
| 4:28.8-4:34.0 | M2: claude.ai Settings → Connectors → Add custom connector → name `CargoFlow`, paste URL → Add; then the tools menu with CargoFlow on | `Remote MCP · Streamable HTTP · 25 tools` |
| 4:34.0-4:37.0 | M3: prompt "Using CargoFlow, summarise the fleet risk and explain any paused shipment." → `fleet_risk_summary` + `explain_shipment` tool calls → answer | none |
| 4:37.0-4:42.0 | M4: prompt "Prepare the deposit for <ref>." → `prepare_deposit` → answer with two unsigned transactions and a CargoFlow link; click the link → the app opens the shipment ready to sign | `Unsigned · you sign in your wallet` |
| 4:42.0-4:46.0 | M5: expand the tool result: `{to, data, value, chainId}`, "Nothing has been sent." | `No private keys, ever.` |

**Composition.** The claude.ai window in a neutral browser frame (claude.ai's own UI, unaltered). Daniel stands at
the right edge in this scene (he is the one asking about risk and funding): `thinking` during M3, `point` at the
link in M4, `confident` in M5. One punch-in per beat on the tool-call chip and on the answer's key sentence.

**Music and SFX.** Bed stays at -26 LUFS; a soft key-click bed under typing (real, from the recording).

---

## S08 · Developer platform · 4:46.0-4:57.0 (frames 8580-8909) · **recording R3** + designed code cards

**Voice-over** (24 words)

> For developers: an OpenAPI reference, a TypeScript SDK, a gateway agent for data loggers, a Python SDK for portfolio risk, and GS1 EPCIS export.

**Composition.** A clean four-up grid on white, each tile a card that animates in on its word (stagger on the VO).
Tile 1 is a short recording; tiles 2-4 are typeset code from the package READMEs (JetBrains Mono 20 px, ink on
mist, no fake syntax-highlight rainbow: keywords in teal only); tile 5 is a ribbon.

| In-out | Tile | Content |
|---|---|---|
| 4:46.4-4:49.7 | 1 · API reference | R3 recording of /docs (Scalar reference, OpenAPI 3.1), scroll to a wallet-signed operation |
| 4:48.0-4:49.7 | 2 · `@cargoflow/sdk` | `const cf = createClient();` / `const why = await cf.shipments.explanation(id);` / `const fee = await cf.pricing.suggest(id);` |
| 4:49.8-4:52.3 | 3 · `@cargoflow/gateway` | `cargoflow-gateway watch ./logger-exports` with a two-line log: `queued 32 readings` / `sent · signed Ed25519` (illustrative output; label it so in a 12 px tag) |
| 4:52.4-4:56.5 | 4 · `cargoflow` (Python) | `mc = cfa.simulate_default_recovery(pf, n_sims=20_000, seed=2026)` / `mc.summary()` |
| 4:54.5-4:56.5 | ribbon | `GS1 EPCIS 2.0 export and import · validated against the official 2.0.1 schema` |

Small footer tag for the whole scene: `Packages build and pass their tests in the repository; not yet published to npm or PyPI.`

---

## S09 · Sponsors, honestly · 4:57.0-5:10.0 (frames 8910-9299)

**Voice-over** (28 words)

> Built on Robinhood Chain, with Paxos USDG as the money.
> ZeroDev passkeys, Alchemy and QuickNode RPC, OpenZeppelin contracts.
> Dune analytics, and Fhenix and GMX extensions on Arbitrum Sepolia.

**Composition.** A designed board, not a logo wall: one row per partner, each row = name (Space Grotesk), what
CargoFlow uses it for (Inter, one line), and a status pill. Rows enter in VO order, 8 f apart. Logos only where the
partner's brand guidelines allow; otherwise the name in type. The status pills are the honesty: they are copied from
`docs/sponsors/README.md`.

| Partner | Line | Status pill |
|---|---|---|
| Robinhood Chain | settlement layer for every facility · testnet 46630 | `live` (emerald) |
| Paxos USDG | escrow, advances, settlement, cover | `live` (emerald) |
| ZeroDev | passkey smart accounts, sponsored gas via CargoFlow's policy webhook | `live` (emerald) |
| Alchemy | fallback RPC tier; signed webhook wakes the indexer | `RPC live · webhook awaiting token` (amber outline) |
| QuickNode | primary RPC with failover | `live` (emerald) |
| OpenZeppelin | access control, SafeERC20, reentrancy guards, Pausable, ERC-721 | `live` (emerald) |
| Dune | volume, escrow, pause and recovery rates, lender yield | `built · upload plan pending` (amber outline) |
| Fhenix | encrypted invoice margin and penalty terms | `deployed · Arbitrum Sepolia` (ink outline) |
| GMX | optional financier hedge with the financier's own collateral | `deployed · Arbitrum Sepolia` (ink outline) |

Lean-in on Robinhood Chain and Paxos USDG rows for their line (they carry the money), then pull back to the full
board for the rest.

---

## S10 · Proof · 5:10.0-5:20.0 (frames 9300-9599) · **recording R4**

**Voice-over** (20 words)

> It's live.
> A shipment settled end to end on the v3 contracts.
> Ten contracts, source-verified.
> Three hundred sixty-six contract tests.

**On screen**

| In-out | Picture | Text |
|---|---|---|
| 5:10.4-5:15.7 | R4a: the v3 run's dashboard `/track/0xc574…f9e5`, Settled pill, then a 1 s flash of the explorer page for the settle transaction (status Success) | `CF-LIVE-1791029236301 · settled` · tx badges `proof 0xadfe3b2f…1f503a9f52` and `paid 0x37571b49…cf4e365a35` |
| 5:16.0-5:17.2 | R4b: /deployments, scroll through the contract list with verified marks | `10 contracts · source-verified` |
| 5:17.5-5:19.6 | counter grid (designed), numbers roll up in 600 ms, 120 ms stagger | `366 contract tests` · `25 circuit` · `245 frontend unit` · `18 end-to-end` · `SDK 92 · MCP 27 · gateway 36 · Python 25` |

Footer tag: `Testnet only · not audited · testnet USDG has no value`.

---

## S11 · Outro · 5:20.0-5:28.0 (frames 9600-9839)

**Voice-over** (14 words)

> CargoFlow.
> Working capital that releases only when the cargo's own evidence says it should.

**On screen**

| In-out | Text |
|---|---|
| 5:20.6-5:28.0 | CargoFlow logo (light on navy gradient) |
| 5:21.8-5:28.0 | tagline, typed on word by word with the VO; the through-line draws under it as an underline |
| 5:25.0-5:28.0 | `cargoflow.adoranto737.workers.dev` · `github.com/LSUDOKO/CargoFlow` · `MCP: cargoflow-mcp.adoranto737.workers.dev/mcp` |

**Composition.** Start on the S00 framing, now in daylight: the reefer on the quay in Singapore, LCD `4.6 °C`, lamp
emerald; Meera, Daniel and Wei Lin stand in a loose row in front of it (Meera centre, `present` toward the reefer;
Daniel `crossed`, half smile; Wei Lin `hold` with the eBL card). 30 f, then the navy gradient wipes in from the right
along the through-line, and the logo resolves. Last frame is clean (logo, tagline, URLs) for the thumbnail.

**Music and SFX.** The cue resolves on "should."; the logger's single tick once, softly, as the last sound.

---

## Shot list R1 · website recording for S06 (recorder follows this)

Record after the redesign, on https://cargoflow.adoranto737.workers.dev, in one session. Labels below are the app's
labels as of 3 October 2026; **check each against the redesigned UI before the take** and tell the editor of any
renamed button (the VO does not quote button labels, so a rename does not change the script).

### Setup (the day before)

Reuse v1 `DEMO-SHOTLIST.md` sections 1-3 for wallet setup, funding, recording settings (OBS display capture, 1920 x
1080, 30 fps CFR, Chrome clean profile, light theme, cursor highlight, Do Not Disturb), waking the API and the CSV
generator. Differences for v2:

| Account | How | Needs |
|---|---|---|
| `Meera - Exporter` | browser wallet (MetaMask or Rabby) | testnet ETH |
| `Daniel - Financier` | browser wallet, same extension | testnet ETH + at least 20 USDG (+ any amount for the market offer) |
| `Carrier` | browser wallet holding `CARRIER_ROLE` on the EBLRegistry (`0x7227…68A9`) | testnet ETH; **the founder must grant the role** (admin key) |
| `Wei Lin - Buyer` | **ZeroDev passkey account** created the day before on this machine (header → Connect → Continue with passkey → Create a passkey account, name `Wei Lin`), then funded: send 30 USDG to its smart-account address | 30 USDG; gas only if sponsorship is off |

Two extra shipments must exist before the take (they make S06 D10 and S07 meaningful):

- **Market shipment** `CF-SG-VAX-MKT1`: registered by Meera with the Pharma policy, no facility, and a financing
  request posted (wizard → Financing → "From the market", or /market → Request financing). Optionally one offer from a
  second wallet, so the card shows "Best fee offered".
- **Paused shipment** for Claude to explain: any facility left paused after leg 2 (a short practice take is enough).
- **Unfunded facility** for `prepare_deposit` in S07: a facility created (wizard with "I have a financier", Daniel's
  address) but not deposited.

Policy note: do **not** set milestone places in the recorded shipment (choose "None: each milestone releases
wherever its evidence passes"); the demo CSV track only covers the first hours out of Nhava Sheva, so a place would
hold every release. Places are explained in S05; in D2, only hover the Milestone places control for half a second.

Generate the CSVs (`node video/demo-csv/make-csvs.mjs`) **right before D5** (step 4 below), not at the start: the
eBL steps take minutes and the evidence must be under 30 minutes old when releases are evaluated.

### Click path

| Step | Shot | Account | Exact path | Must be on screen | Raw |
|---|---|---|---|---|---|
| 1 | D1 | Meera | Open `/`. Hold on the hero 3 s. Scroll one notch to show the track bar. | hero headline, header with network and health pill | 10 s |
| 2 | D2 | Meera | Header → **Exporters** (`/exporter`). Step **Shipment**: reference `CF-SG-VAX-0201` (new each take), Buyer address = Wei Lin's smart-account address (paste), Invoice value `30`, route Nhava Sheva (IN) → Singapore (SG), attach any invoice PDF (fingerprinted in the browser). **Continue**. Step **Cold-chain policy**: Cargo type **Pharma** (fills 2-8 °C, humidity and shock limits); hover Milestone places, leave **None**. **Continue**. Step **Financing**: **I have a financier**; Financier address (paste Daniel); Total facility `20`; Milestones `5`; Financing fee `3`. **Continue**. Step **Sign**: **Open the financing facility** (or **Sign and submit**), confirm the three wallet pop-ups. Wait for the three ticks and the toasts "Shipment registered on-chain", "Cold-chain policy set", "Financing facility opened". | Pharma template chip; 2-8 °C; the facility hint "5 tranches of about 4 USDG"; three ticks | 90 s |
| 3 | D3 | Daniel | Switch wallet to Daniel. Header → **Financiers** (`/financier`). On the card for the reference: **1. Approve 20 USDG**, confirm; **2. Deposit 20 USDG**, confirm. | settlement preview (financier 20.6, exporter 9.4); toast "Facility funded" | 30 s |
| 4 | D4 | Carrier, then Meera | Switch to Carrier. Open `/ebl`. **Issue a bill**: Shipper = Meera's address, consignee **Named consignee** = Wei Lin's address, drop a bill-of-lading PDF ("Hashed in your browser; the file is never uploaded."), **Issue bill of lading**, confirm; open the bill's public page (number, possession history "Issued to"). Switch to Meera, open the shipment (`/shipments` → the reference), in the title card **Bind a bill of lading**: pick the bill, **Bind bill of lading**, confirm. | Document fingerprint; "Bill of lading issued"; title card "In escrow" | 90 s |
| 4b | | Meera | **Now run** `node video/demo-csv/make-csvs.mjs` (second screen, off camera). | | |
| 5 | D5 | Meera | On the dashboard: **Start transit**, confirm. **Add sensor gateway**: name `Reefer logger MSKU 123456-7`, sensors `probe-1, probe-2`, **Sign and add gateway** (message, no gas), **Close**. **Submit readings** → **Choose CSV** `leg-1-healthy.csv` → **Send 32 readings**. Wait for the result table. **Close**. Scroll to the map and the milestone timeline. | "32 readings accepted"; two rows "Passed: milestone released"; map with live position; M1 and M2 released; escrow drawn 8 of 20 | 120 s |
| 6 | D6 | Meera | **Submit readings** → `leg-2-excursion.csv` (warning: readings outside the 2 to 8 °C band) → **Send 16 readings**. Result "Failed: facility paused". **Close**. Scroll to the temperature chart, then the explanation panel ("Where it stands", "What each party does now"). | out-of-band warning; amber Paused pill; chart with probe-1 above 8 °C; explanation panel | 45 s |
| 7 | D7 | Meera | **Submit readings** → `leg-3-recovery.csv` → **Send 16 readings** → **Close**. Wait for the bell to show **Proof ready** (automatic recovery worker); open it → **Review and sign** → in **Resume with a proof**, sign, then **Submit proof and resume**, confirm. If no notification within ~2 min: Probe `probe-2` → **Sign and prepare proof** → **Submit proof and resume** (see the alternative VO line). Wait for "Facility resumed by zero-knowledge proof" and the proof card "Groth16 proof verified on-chain". If **Release milestone 3** appears, click and confirm. Then **Submit readings** → `leg-4-healthy.csv` → **Send 32 readings** → **Close** (M4, M5 released; used only as a 1 s cut). | bell + "Proof ready"; proof card verified; pill Active; all five milestones released | 150 s |
| 8 | D8 | Wei Lin | In the wallet menu, disconnect; **Connect wallet** → **Continue with passkey** → **Sign in with an existing passkey** → OS passkey sheet (touch the sensor). Header shows the passkey account chip (and "Gas paid by CargoFlow" if sponsorship is on). On the dashboard: **Confirm delivery** (passkey prompt), **1. Approve 30 USDG**, **2. Pay the 30 USDG invoice**. Wait for "Invoice paid and settled". Scroll: Settled pill; title card "With the buyer"; audit trail. | OS passkey sheet; Settled; title with the buyer | 75 s |
| 9 | D9 | Wei Lin | **Download certificate** (Settlement certificate (PDF)) → open the PDF in the browser's viewer, scroll once. | PDF title and the split | 15 s |
| 10 | D10 | Daniel | Switch to Daniel (browser wallet). Header → **Market** (`/market`). Hover the open request `CF-SG-VAX-MKT1` → **Review offers** → offer modal: the **Suggested fee** band with its reasons; type a fee inside the band; do not send (or **Sign and send offer** if you want the toast "Offer sent"). | open requests; Suggested fee low / mid / high; "Financiers choose the fee" | 30 s |

After the take: copy the dashboard URL, the settle transaction and the bill's token id into the video description.

## Shot list R2 · claude.ai MCP segment for S07

Record at 1920 x 1080 in the same clean Chrome profile, signed in to a claude.ai plan that allows custom connectors
(Pro, Max, Team or Enterprise). Wake the API first (`https://cargoflow-api-75ul.onrender.com/v1/health`); the hosted
MCP answers "the CargoFlow API is waking up" if it is asleep. Do a dry run of every prompt the day before so the
answers are known, then record fresh. Do not edit Claude's answers; cut for time only.

| Step | Beat | Path | Must be on screen |
|---|---|---|---|
| 1 | M1 | CargoFlow `/developers` → "Use CargoFlow in Claude" → **Copy URL** | the URL `https://cargoflow-mcp.adoranto737.workers.dev/mcp`, the copy confirmation |
| 2 | M2 | claude.ai → profile menu → **Settings** → **Connectors** → **Add custom connector** → Name `CargoFlow`, URL paste, auth empty → **Add**. (If it is already added from a dry run, remove it first so the add is real.) New chat → tools menu (the sliders icon) → turn **CargoFlow** on. | the connector dialog with the URL; CargoFlow listed with its tools |
| 3 | M3 | Type: **"Using CargoFlow, summarise the fleet risk and explain any paused shipment."** Send. If Claude asks to allow a tool, choose allow. | tool-call chips `fleet_risk_summary` and `explain_shipment`; the answer naming the paused shipment and its cause and next step |
| 4 | M4 | Type: **"Prepare the deposit for CF-SG-VAX-0202."** (the unfunded facility). Send. Then click the CargoFlow link in the answer; the app opens on that shipment with the deposit ready to sign. Do not sign on camera. | tool chip `prepare_deposit`; "approve … depositCapital"; "Nothing has been sent"; the link; the app page it opens |
| 5 | M5 | Back in claude.ai, expand the `prepare_deposit` tool result. | the unsigned `{to, data, value, chainId}` JSON |

Optional extra take for social cuts: **"Explain this shipment: CF-LIVE-1791029236301"** (`explain_shipment` on the settled
v3 run) and **"What fee would you suggest for CF-SG-VAX-MKT1?"** (`get_pricing`).

## Shot list R3 · developer pages (S07 M1, S08)

| Step | Path | Must be on screen |
|---|---|---|
| 1 | `/developers` top: "Use CargoFlow in Claude", starter prompts, SDK and gateway sections | panel titles |
| 2 | `/docs`: the Scalar API reference loads; scroll to a wallet-signed write (for example the financing request) and expand it so `x-cargoflow-signed-message` shows | operation and signed-message format |

## Shot list R4 · proof (S10)

| Step | Path | Must be on screen |
|---|---|---|
| 1 | `/track/0xc57490f8b1f0190b00197db978963899f55314865c0059eddaf8cfecdc8ff9e5` | `CF-LIVE-1791029236301`, Settled, five milestones released |
| 2 | Explorer: `https://explorer.testnet.chain.robinhood.com/tx/0x37571b49186b43f2f02df4d2034cd495ac7095766d113c20060cdecf4e365a35` | Status Success |
| 3 | `/deployments` | the v3 contract list with copy buttons and verified links |

---

## Claims checked

| Claim (scene) | Where it is true |
|---|---|
| 50% of B2B sales on credit, average terms 52 days (S01) | Atradius PDF p. 3, captured (`atradius-india-pdf-terms.png`) |
| $2.5 trillion gap in 2025, about 10% of global trade; SME rejection 41% vs 40% (S02) | ADB news release, 15 Jan 2026, captured (`adb-news-*.png`); brief Dec 2025 (`adb-survey-gap.png`) |
| Biopharma loses about $35 billion a year to temperature-controlled logistics failures (S03) | Air Cargo News, 26 Jul 2019, citing IQVIA, captured |
| Founder's line (S04) | README "The problem in one paragraph", captured from GitHub |
| Policy 2-8 °C, score ≥ 75, conflict ≤ 30%, humidity ≤ 85%, shock ≤ 3 g (S05a) | the v3 live run's policy, read from `GET /v1/shipments/0xc574…` on 3 Oct 2026 |
| Place milestones, held "neither a failure nor a pause", the Colombo sentence (S05a, S05c) | contracts v2 plan; `backend/README.md` "Contracts v2" (the sentence is the README's own example) |
| Logger signs with a device key; classes and weights 9500 / 9700 / 9900 bps (S05b) | `backend/README.md` "Device trust"; README "Contracts v3" |
| 8 readings close an epoch; Dempster-Shafer fusion with conflict; seven capped penalties; 0-100 score; Poseidon root on chain, readings off chain (S05b) | README "Evidence engine"; `backend/README.md` "The evidence score", "Commitments" |
| Passing conflict 1.7%; failing epoch score 48, conflict 74.8% (S05b, S05d) | README product tour (live dashboard and committed-evidence table) |
| 5.2, 6.8, 8.9, 10.4, 11.7 °C and 4.6 °C (S05d) | `video/demo-csv/make-csvs.mjs` leg 2; `cargoflow-sim -scenario conflicting_sensors` |
| AI monitor can only make outcomes stricter; pause is its only on-chain effect (S05d) | README "An AI that cannot move money", "AI monitor" |
| Automatic ZK recovery: proof prepared once a probe has 8 fresh in-range readings, exporter notified (in-app, Telegram, email, Slack, webhook), signs (S05e, D7) | `backend/README.md` "Automatic ZK recovery", "Alerts", "In-app notifications" |
| Groth16 proof bound to chain, verifier, controller, shipment, epoch, policy, submitter and pause count; readings not revealed (S05e) | README "Zero-knowledge recovery" |
| One settle transaction pays principal + fee to the financier and the residual to the exporter; 100,000 → 41,200 / 58,800 (S05f) | README sequence diagram and lifecycle figure |
| eBL as ERC-721, held by the controller when bound, moves to the buyer in the same transaction as payment; MLETR wording (S05f, D4, D8) | README "Contracts v3" |
| Default cover pays min(cover, loss = drawn); parametric after N consecutive failed epochs, principal + salvage (S05g) | contracts v2 plan; README "Contracts v3" |
| Arbiter can never release a tranche (S05g) | README "Disputes and defaults" |
| Demo numbers 30 / 20 / 5 × 4 / 3% / 20.6 / 9.4 (S06) | v1 `DEMO-SHOTLIST.md`; README v3 live run (5 x 4 USDG) |
| Passkey accounts (ZeroDev Kernel, WebAuthn), gas sponsored through the CargoFlow policy webhook (D8, S09) | README sponsors table; `docs/sponsors/README.md` status table ("live") |
| Market requests and offers; fee guidance low / mid / high with reasons; financiers choose the fee (D10) | `backend/README.md` "Financing marketplace", "Fee guidance" |
| Remote MCP, 25 tools, prepare tools return unsigned transactions and a signing link, no keys (S07) | `packages/mcp/README.md`; `tools/list` on the live endpoint returned 25 tools on 3 Oct 2026 |
| OpenAPI 3.1, SDK, gateway, Python, EPCIS 2.0 validated against 2.0.1 schema; packages not yet published (S08) | README "Developer platform"; `backend/README.md` "GS1 EPCIS 2.0" |
| Sponsor statuses (S09) | `docs/sponsors/README.md` status table, checked 3 Oct 2026 |
| v3 live run, proof and payment transactions; 10 contracts source-verified (S10) | README "A live run on v3" and "Deployed contracts, v3"; `contracts/deployments/robinhood-testnet.json` |
| 366 contract, 25 circuit, 245 frontend unit, 18 end-to-end; SDK 92, MCP 27, gateway 36, Python 25 (S10) | README "Measured, not claimed" |

What the film deliberately does not say: that the readings came from real hardware (simulated, signed), that a
secure element ran end to end (implemented and tested with test certificates only), that the protocol is audited,
that the ZK setup is production-grade (single-party, testnet), that the eBL is legally recognised, or that the Dune
tables are live.

## Sources

1. Asian Development Bank, "Demand for Trade Finance to Rise Amid Supply Chain Realignment—ADB Report", news release,
   15 January 2026. https://www.adb.org/news/demand-trade-finance-rise-amid-supply-chain-realignment-adb-report
2. Asian Development Bank, "ADB Global Trade Finance Gap Survey", ADB Brief, December 2025.
   https://www.adb.org/publications/adb-global-trade-finance-gap-survey
3. Atradius, "B2B payment practices trends in India 2025", 29 July 2025.
   https://group.atradius.com/knowledge-and-research/reports/b2b-payment-practices-trends-india-2025 and the report PDF
   https://group.atradius.com/dam/jcr:b693e087-ee4d-427e-9075-892bfa10ee04/payment-practices-barometer-asia-2025-india-en.pdf (p. 3)
4. Air Cargo News, "Failures in temperature-controlled logistics cost biopharma industry billions", 26 July 2019, citing
   the IQVIA Institute for Human Data Science.
   https://www.aircargonews.net/pharma-logistics/2019/07/failures-in-temperature-controlled-logistics-cost-biopharma-industry-billions/
5. CargoFlow README, "The problem in one paragraph". https://github.com/LSUDOKO/CargoFlow#the-problem-in-one-paragraph

All five pages were captured on 3 October 2026 (`video/public/sources/`, see `highlights.json`).
