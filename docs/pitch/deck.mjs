// CargoFlow pitch deck: the one content model behind index.html (HTML + PDF + PNGs) and CargoFlow-pitch.pptx.
//
// Every slide is a list of absolutely positioned elements on a 1920 x 1080 canvas, so the HTML deck and the
// PowerPoint file are laid out from the same numbers (PowerPoint: 1 px = 0.5 pt, 144 px = 1 inch).
// Inline markup in text: ==lime marker==  **bold**  `mono`  [link text](https://url)  and \n for a line break.
// Facts come from the repository README, docs/ and the transaction tables; plans and assumptions are labelled.

export const W = 1920;
export const H = 1080;

export const C = {
  ink: "0B1B2B", ink2: "13293D", ink3: "1D3A55", paper: "F7F9F4", white: "FFFFFF", mist: "EEF2EA", line: "DCE3DA",
  lime: "C6F432", limeSoft: "EAF8C0", lime2: "B2E01C", emerald: "00C46A", emeraldSoft: "D6F5E5", emeraldInk: "00663A",
  amber: "FFB020", amberSoft: "FFF0D1", amberInk: "7A4B00", slate: "5B6B7B", teal: "0A5A73", mint: "8FE3B5", sky: "9FC6D6", fog: "D3DCE4",
};

export const FONT = { display: "Space Grotesk", body: "Inter", mono: "JetBrains Mono" };

const X = 120;            // left margin
const CW = 1680;          // content width
const EXPLORER = "https://explorer.testnet.chain.robinhood.com";
const tx = (h) => `${EXPLORER}/tx/${h}`;
const SITE = "https://cargoflow.adoranto737.workers.dev";

// ---------- element helpers ----------
// text styles: size in px at 1920 x 1080; lh = line height multiple; ls = letter spacing in em
const ST = {
  kicker: { f: "mono", s: 24, c: C.teal, ls: 0.12, up: true, lh: 1.2 },
  h: { f: "display", s: 76, b: true, c: C.ink, lh: 1.06, ls: -0.02 },
  lead: { f: "body", s: 32, c: C.ink2, lh: 1.4 },
  p: { f: "body", s: 30, c: C.ink2, lh: 1.4 },
  cap: { f: "body", s: 28, c: C.slate, lh: 1.35 },
  card: { f: "display", s: 36, b: true, c: C.ink, lh: 1.12, ls: -0.01 },
  num: { f: "mono", s: 96, b: true, c: C.ink, lh: 1, ls: -0.03 },
  label: { f: "mono", s: 24, c: C.teal, ls: 0.08, up: true, lh: 1.25 },
  foot: { f: "body", s: 22, c: C.slate, lh: 1.35, role: "foot" },
};
const T = (x, y, w, h, text, style = "p", o = {}) => ({ type: "text", x, y, w, h, text, ...ST[style], role: ST[style].role || style, ...o });
const I = (x, y, w, h, src, o = {}) => ({ type: "image", x, y, w, h, src, fit: "cover", pos: "top", frame: true, ...o });
const R = (x, y, w, h, o = {}) => ({ type: "rect", x, y, w, h, fill: C.white, line: C.line, r: 24, ...o });
const O = (x, y, d, o = {}) => ({ type: "circle", x, y, w: d, h: d, fill: C.ink, ...o });
const L = (x1, y1, x2, y2, o = {}) => ({ type: "line", x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), x1, y1, x2, y2, color: C.ink, width: 3, ...o });

// page chrome shared by every slide but the title
const header = (section) => [
  { type: "logo", x: X, y: 50, w: 176, h: 44, variant: "light", anim: "fade" },
  T(1180, 58, 620, 32, section, "kicker", { a: "right", c: C.slate, s: 22, anim: "fade", role: "section" }),
];
const footer = (text) => (text ? [T(X, 1000, 1480, 60, text, "foot", { anim: "fade", va: "bottom" })] : []);
const headline = (kicker, h, o = {}) => [
  T(X, 148, CW, 34, kicker, "kicker"),
  T(X, 192, o.w || CW, o.h || 90, h, "h", { s: o.s || 76 }),
];
// a white card with a soft line
const card = (x, y, w, h, o = {}) => R(x, y, w, h, { anim: "up", ...o });
// a lime numbered chip
const chip = (x, y, label, o = {}) => [
  R(x, y, o.w || 64, o.h || 64, { fill: C.lime, line: null, r: 16, anim: "pop" }),
  T(x, y, o.w || 64, o.h || 64, label, "num", { s: o.s || 30, a: "center", va: "middle", anim: "pop" }),
];

// ---------- the slides ----------
export const slides = [
  // 1 ------------------------------------------------------------------------------------------------------
  {
    id: "title", section: "CargoFlow",
    notes: "CargoFlow is working capital for physical trade that releases only when the cargo's own evidence says it should. A financier escrows Paxos USDG for one shipment, and signed sensor evidence decides, milestone by milestone, how much the exporter can draw. The production build is live on Robinhood Chain Testnet today, and the mainnet release is next.",
    els: [
      { type: "logo", x: X, y: 112, w: 360, h: 90, variant: "light", anim: "fade" },
      T(X, 270, 870, 340, "Working capital that releases only when the ==cargo's own evidence== says it should.", "h", { s: 72, lh: 1.08 }),
      T(X, 640, 860, 96, "Evidence-gated trade finance, settled in Paxos USDG on Robinhood Chain.", "lead"),
      R(X, 770, 860, 104, { fill: C.emeraldSoft, line: "9BE3C0", r: 24, anim: "up" }),
      O(X + 30, 812, 20, { fill: C.emerald, line: null, anim: "pop" }),
      T(X + 72, 770, 770, 104, "Production build live on Robinhood Chain Testnet.\nMainnet release next.", "cap", { s: 28, c: C.emeraldInk, va: "middle", b: true, lh: 1.3 }),
      T(X, 912, 1200, 40, "Arbitrum Open House Singapore · Online Buildathon · October 2026", "cap"),
      T(X, 956, 1200, 40, `[cargoflow.adoranto737.workers.dev](${SITE})   ·   [github.com/LSUDOKO/CargoFlow](https://github.com/LSUDOKO/CargoFlow)`, "cap", { f: "mono", s: 28, c: C.ink2 }),
      I(1010, 250, 860, 370, "media/hero-cast.jpg", { frame: false, fit: "contain", pos: "center", anim: "zoom", parallax: true, alt: "The cast: a carrier, Meera the exporter, Daniel the financier, Wei Lin the buyer, an insurer and an arbiter in front of a reefer container." }),
    ],
  },
  // 2 ------------------------------------------------------------------------------------------------------
  {
    id: "problem", section: "02 · The problem",
    notes: "Here is the problem. A lender advancing money against a reefer container sees invoices and a bill of lading, never the container itself, so it either lends blind or does not lend at all. Meanwhile the exporter waits about two months for cash it has already earned, and the cargo is at risk the whole way.",
    els: [
      ...header("02 · The problem"),
      ...headline("Trade finance today", "A lender sees ==paperwork==, not the container.", { w: 760, h: 250 }),
      T(X, 500, 720, 260, "So it lends blind, or does not lend at all. The exporter waits about two months for cash it has already earned, while the cargo is at risk in transit.", "lead"),
      I(940, 192, 860, 484, "media/still-problem.jpg", { gif: "../assets/v3/how-problem.gif", anim: "zoom", parallax: true, alt: "Daniel the financier at his desk; the window onto the ship is frosted over." }),
      T(940, 700, 860, 80, "Daniel, the financier, holds the documents. The reefer stays out of sight.", "cap"),
      ...footer(`Atradius Payment Practices Barometer India 2025: [average B2B payment terms of 52 days](https://group.atradius.com/knowledge-and-research/reports/b2b-payment-practices-trends-india-2025)`),
    ],
  },
  // 3 ------------------------------------------------------------------------------------------------------
  (() => {
    const q = [
      ["$2.5T", "global trade finance gap in 2025 (ADB)", "media/source-adb-gap.png", "ADB news release, highlighted: the global trade finance gap remained at $2.5 trillion in 2025, about 10% of global trade."],
      ["41%", "of SME trade finance applications rejected (ADB)", "media/source-adb-sme.png", "ADB release, highlighted: SME rejection rates for trade finance (41%)."],
      ["52 days", "average B2B payment terms in India (Atradius)", "media/source-atradius.png", "Atradius India 2025, highlighted: 50% of B2B sales on credit, average payment terms 52 days."],
      ["~$35B", "lost by biopharma each year to cold-chain failures (IQVIA)", "media/source-iqvia.png", "Air Cargo News, highlighted: biopharma loses approximately $35 billion annually from temperature-controlled logistics failures (IQVIA)."],
    ];
    const els = [...header("03 · The problem, in numbers"), ...headline("Sourced, highlighted on the original pages", "The gap is large, and it is documented.")];
    q.forEach(([n, label, src, alt], i) => {
      const x = X + (i % 2) * 860, y = 320 + Math.floor(i / 2) * 340;
      els.push(T(x, y, 820, 84, n, "num", { s: 76, count: true }));
      els.push(T(x, y + 92, 820, 40, label, "p", { s: 28, c: C.ink2 }));
      els.push(I(x, y + 148, 820, 160, src, { fit: "contain", pos: "left", frame: false, border: true, anim: "up", alt }));
    });
    els.push(...footer(`[ADB, 15 Jan 2026](https://www.adb.org/news/demand-trade-finance-rise-amid-supply-chain-realignment-adb-report) citing the [ADB Global Trade Finance Gap Survey](https://www.adb.org/publications/adb-global-trade-finance-gap-survey) · [Atradius India 2025, p. 3](https://group.atradius.com/knowledge-and-research/reports/b2b-payment-practices-trends-india-2025) · [Air Cargo News, 26 Jul 2019, citing IQVIA](https://www.aircargonews.net/pharma-logistics/2019/07/failures-in-temperature-controlled-logistics-cost-biopharma-industry-billions/)`));
    return {
      id: "numbers", section: "03 · The problem, in numbers", els,
      notes: "The numbers are sourced and highlighted on the original pages. The Asian Development Bank puts the global trade finance gap at 2.5 trillion dollars in 2025, with 41 percent of SME applications rejected. In India, average B2B payment terms are 52 days, and biopharma alone loses about 35 billion dollars a year to cold-chain failures, according to IQVIA.",
    };
  })(),
  // 4 ------------------------------------------------------------------------------------------------------
  (() => {
    const cards = [
      ["$", "Paxos USDG", "A US-dollar stablecoin from Paxos Digital Singapore. The only money CargoFlow moves."],
      ["RH", "Robinhood Chain", "An Arbitrum chain built for tokenised real-world assets, with USDG deployed."],
      ["P-256", "Passkeys on chain", "The RIP-7212 precompile lets a buyer pay with Face ID, no seed phrase."],
      ["Rs", "Arbitrum Stylus", "Evidence fusion in Rust, measured 19x cheaper than the Solidity reference."],
    ];
    const els = [...header("04 · Why now"), ...headline("Why now", "Money became programmable. Now it can answer to ==evidence==.", { h: 170 })];
    cards.forEach(([ico, t, body], i) => {
      const x = X + i * 430, y = 440;
      els.push(card(x, y, 400, 470));
      els.push(...chip(x + 36, y + 40, ico, { w: ico.length > 2 ? 120 : 72, h: 72, s: ico.length > 2 ? 28 : 30 }));
      els.push(T(x + 36, y + 140, 330, 50, t, "card"));
      els.push(T(x + 36, y + 206, 330, 230, body, "p", { s: 28 }));
    });
    els.push(...footer("USDG 0x7E95…802F on chain 46630 · 10 contracts source-verified · Stylus: 31,511 vs 611,945 gas at 128 readings (stylus/README.md)"));
    return {
      id: "why-now", section: "04 · Why now", els,
      notes: "Why now: money has become programmable, and the rails CargoFlow needs now exist on one chain. Paxos USDG is the only asset CargoFlow moves, Robinhood Chain is an Arbitrum chain built for real-world assets with USDG already deployed, and its P-256 precompile lets a buyer pay with a passkey. Stylus runs the evidence maths in Rust, measured 19 times cheaper than the Solidity reference.",
    };
  })(),
  // 5 ------------------------------------------------------------------------------------------------------
  (() => {
    const steps = [
      "A financier escrows USDG for one shipment.",
      "Tranches release only when signed sensor evidence passes an on-chain policy.",
      "The buyer's one payment repays the financier, pays the exporter and hands over the bill of lading.",
    ];
    const els = [...header("05 · The solution"), ...headline("The solution", "Capital that answers to the ==cargo's evidence==.")];
    steps.forEach((s, i) => {
      const y = 350 + i * 180;
      els.push(...chip(X, y, String(i + 1)));
      els.push(T(X + 96, y + 4, 680, 150, s, "lead", { s: 32 }));
    });
    els.push(I(920, 350, 880, 368, "media/cast.jpg", { fit: "contain", pos: "center", frame: false, anim: "zoom", parallax: true, alt: "The cast: Meera the exporter, Daniel the financier, Wei Lin the buyer, the carrier, the insurer and the arbiter, each with their role." }));
    els.push(T(920, 740, 880, 80, "Illustrative characters. Everything they do is a real contract call.", "cap"));
    els.push(...footer("PHYSICAL REALITY · CRYPTOGRAPHIC EVIDENCE · EVIDENCE CONFIDENCE · FINANCIAL RISK · AVAILABLE CAPITAL · USDG SETTLEMENT"));
    return {
      id: "solution", section: "05 · The solution", els,
      notes: "CargoFlow in three lines. A financier escrows USDG for one shipment; tranches reach the exporter only when the cargo's signed sensor evidence satisfies an on-chain policy; and the buyer's single payment repays the financier, pays the exporter and hands over the electronic bill of lading in the same transaction. Meet the cast: Meera exports, Daniel finances, Wei Lin buys.",
    };
  })(),
  // 6 ------------------------------------------------------------------------------------------------------
  (() => {
    const beats = [
      ["Escrow", "Daniel deposits the 40,000 USDG facility into the vault.", "still-facility", "how-facility"],
      ["Evidence", "Signed readings fuse into a score from 0 to 100.", "still-evidence", "how-evidence"],
      ["Release", "Evidence passes the policy: 8,000 USDG to Meera.", "still-release", "how-release"],
      ["Pause, prove", "Score 48 pauses it; a Groth16 proof resumes it.", "still-excursion", "how-excursion"],
      ["Settle", "One 100,000 USDG payment splits and moves the title.", "still-settlement", "how-settlement"],
    ];
    const els = [...header("06 · How it works"), ...headline("How it works", "Five steps, ==every one on chain==.")];
    const colW = 312, gap = 30;
    // the route line the beats sit on
    els.push(L(X + colW / 2, 340, X + 4 * (colW + gap) + colW / 2, 340, { color: C.ink, width: 4, dash: true, draw: true, anim: "draw" }));
    beats.forEach(([t, body, still, gif], i) => {
      const x = X + i * (colW + gap);
      els.push(O(x + colW / 2 - 14, 326, 28, { fill: i < 3 ? C.lime : C.white, line: C.ink, lw: 4, anim: "pop", delay: 300 + i * 160 }));
      els.push(I(x, 380, colW, 176, `media/${still}.jpg`, { gif: `../assets/v3/${gif}.gif`, anim: "up", alt: `${t}: ${body}` }));
      els.push(...chip(x, 580, String(i + 1), { w: 52, h: 52, s: 28 }));
      els.push(T(x + 68, 580, colW - 68, 52, t, "card", { s: 32, va: "middle" }));
      els.push(T(x, 652, colW, 170, body, "p", { s: 28 }));
    });
    els.push(T(X, 860, CW, 44, "Reference numbers: 100,000 USDG invoice, 40,000 USDG facility, 3% fee.", "cap"));
    els.push(...footer("createFacility · depositCapital · commitEpoch · evaluateAndReleaseMilestone · pauseFinancing · resumeWithProof · settle (contracts v3, 3 Oct 2026)"));
    return {
      id: "how-it-works", section: "06 · How it works", els,
      notes: "Five steps, every one on chain. Daniel escrows the whole facility; the logger signs each reading and the backend fuses the probes into a score; when evidence passes the policy in the right place, a tranche goes to Meera. If a probe overheats the score drops to 48 and releases stop, until a Groth16 proof of the other probe's readings resumes the facility, and Wei Lin's single payment settles everything.",
    };
  })(),
  // 7 ------------------------------------------------------------------------------------------------------
  (() => {
    const nets = [
      ["Title moves with money", "The carrier's ERC-721 bill of lading leaves escrow inside the buyer's payment.", "still-title", "how-title"],
      ["Automatic recovery", "A proof is prepared once a probe has eight fresh in-band readings. The exporter signs once.", "still-recovery", "how-recovery"],
      ["Parametric cover", "Pays out after N failed epochs in a row, proven from the commit order.", "still-cover", "how-cover"],
    ];
    const els = [...header("07 · Safety nets"), ...headline("Built into the contracts", "Safety nets are part of the ==protocol==.")];
    nets.forEach(([t, body, still, gif], i) => {
      const x = X + i * 570;
      els.push(I(x, 330, 540, 304, `media/${still}.jpg`, { gif: `../assets/v3/${gif}.gif`, anim: "up", parallax: true, alt: `${t}: ${body}` }));
      els.push(T(x, 664, 540, 50, t, "card"));
      els.push(T(x, 726, 540, 170, body, "p", { s: 28 }));
    });
    els.push(...footer("Disputes go to an arbiter role that can never release money · README \"Under the hood\" · docs/architecture.md"));
    return {
      id: "safety-nets", section: "07 · Safety nets", els,
      notes: "Three safety nets are part of the protocol, not bolted on. The bill of lading leaves escrow inside the buyer's payment, so title and money move together. Recovery is automatic once a probe has eight fresh in-band readings, and parametric cover pays after N failed epochs in a row, proven from the registry's own commit order.",
    };
  })(),
  // 8 ------------------------------------------------------------------------------------------------------
  {
    id: "product", section: "08 · The product",
    notes: "This is the product, recorded on the live site. Each shipment has a dashboard showing invoice, financing, milestones and the latest evidence score; this one is settled with five of five milestones released. The exporter wizard turns a shipment into working capital, with a pharma template that fills the 2 to 8 degree policy in one click.",
    els: [
      ...header("08 · The product"),
      ...headline("Live at cargoflow.adoranto737.workers.dev", "A product each party can use ==today==."),
      I(X, 330, 820, 461, "media/web-track-v3.jpg", { anim: "left", parallax: true, alt: "Live dashboard of a settled shipment: invoice 30 USDG, financing 20, 5 of 5 milestones released, evidence score 100." }),
      I(980, 330, 820, 461, "media/web-exporter.jpg", { anim: "right", parallax: true, alt: "Exporter wizard on the cold-chain policy step with the Pharma 2 to 8 °C template." }),
      T(X, 816, 820, 80, "Shipment dashboard: settled, five of five milestones released.", "cap"),
      T(980, 816, 820, 80, "Exporter wizard: the Pharma 2 to 8 °C template fills the policy.", "cap"),
      ...footer(`Pages: /track, /exporter, /financier, /buyer, /market, /ebl, /arbiter, /shipments, /developers, /docs, /deployments · [open the live app](${SITE})`),
    ],
  },
  // 9 ------------------------------------------------------------------------------------------------------
  {
    id: "fund-pay-ask", section: "09 · The product",
    notes: "Financiers fund requests on a market that suggests a fee band and explains it. The buyer confirms delivery and pays with a passkey through a ZeroDev smart account, no wallet extension. And anyone can ask Claude about a shipment through the remote MCP server: Claude reads 25 tools and prepares unsigned transactions, but every write is signed by the party itself.",
    els: [
      ...header("09 · The product"),
      ...headline("Every party, its own session", "Fund it, pay it, ==ask Claude== about it."),
      I(X, 330, 540, 380, "media/web-financier.jpg", { anim: "up", parallax: true, alt: "Financier portal: portfolio of five facilities, exposure by status and a deposit button per facility." }),
      I(690, 330, 540, 380, "media/web-settled.jpg", { gif: "../assets/v3/how-passkey.gif", anim: "up", parallax: true, alt: "Wei Lin signs in with a passkey, confirms delivery, approves and pays; the shipment is settled." }),
      I(1260, 330, 540, 380, "media/claude-answer.jpg", { anim: "up", parallax: true, alt: "claude.ai answering from the CargoFlow connector: fleet risk and why a shipment paused (score 48, conflict 74.8%)." }),
      T(X, 734, 540, 120, "Financier: portfolio, exposure and one-click deposits.", "cap"),
      T(690, 734, 540, 120, "Buyer: confirms delivery and pays with a passkey.", "cap"),
      T(1260, 734, 540, 120, "claude.ai: 25 tools through remote MCP. Claude never holds a key.", "cap"),
      ...footer(`Remote MCP server: [cargoflow-mcp.adoranto737.workers.dev/mcp](https://cargoflow-mcp.adoranto737.workers.dev/mcp) · every write is signed by the party in its own wallet or passkey`),
    ],
  },
  // 10 -----------------------------------------------------------------------------------------------------
  (() => {
    const phones = [
      ["media/telegram-01-alerts-on.jpg", "Alerts on", "../assets/v3/how-telegram.gif", "Telegram: the bot confirms alerts are on for shipment CF-LIVE-1791103821739."],
      ["media/telegram-02-released-paused.jpg", "Released, paused", null, "Telegram: two RELEASED alerts and a PAUSED alert, each with status, transaction hash and shipment id."],
      ["media/telegram-03-recovery-ready.jpg", "Recovery ready", null, "Telegram: RECOVERY_READY, a zero-knowledge recovery is ready to review and sign."],
      ["media/telegram-04-recovery-page.jpg", "One tap to sign", null, "The link opens CargoFlow on the phone at the zero-knowledge recovery card."],
    ];
    const els = [...header("10 · Alerts"), ...headline("Alerts", "Alerts on ==Telegram==, email, Slack and webhooks.", { w: 740, h: 250 })];
    els.push(T(X, 470, 700, 330, "Recorded on a real phone during a live testnet run. RELEASED and PAUSED arrive within seconds of the chain events; RECOVERY_READY opens the recovery card, ready to sign.", "lead", { s: 30 }));
    els.push(T(X, 830, 700, 44, "Bot: [@Cargo_FlowBot](https://t.me/Cargo_FlowBot)", "p", { b: true }));
    phones.forEach(([src, cap, gif, alt], i) => {
      const x = 880 + i * 232;
      els.push(I(x, 192, 220, 489, src, { gif, anim: "up", r: 22, delay: 200 + i * 120, alt }));
      els.push(T(x, 702, 220, 80, cap, "cap", { a: "center" }));
    });
    els.push(...footer(`Shipment CF-LIVE-1791103821739 · pause [0x2f1ad742…](${tx("0x2f1ad7420c44beaef55a15ec4fea542de25636f207703a4c144ae88869e26c9b")}) · releases [0xf0f6a44d…](${tx("0xf0f6a44d3d4af204df595e32cd97652e7ce281ad757eda252d9d04148e3d6a82")}) and [0x7d778679…](${tx("0x7d7786791b94d8b1c61015cba8b3d0cc931f985de715cdaadd2be2f56dc72af7")}) · also in-app`));
    return {
      id: "alerts", section: "10 · Alerts", els,
      notes: "Every party can subscribe a shipment's alerts to Telegram, email, Slack or a signed webhook. This was recorded on a real phone during a live testnet run: two RELEASED alerts and a PAUSED alert arrive with their transactions within seconds of the chain events. About a minute later RECOVERY_READY arrives, and its link opens the shipment straight on the recovery card for Meera to sign.",
    };
  })(),
  // 11 -----------------------------------------------------------------------------------------------------
  (() => {
    const links = [
      ["Signed readings", "Each device signs; every epoch records its source."],
      ["Fusion score", "Dempster-Shafer fusion with a published formula."],
      ["Bound ZK proof", "Groth16, bound to the contract's own signals."],
      ["Locked vault", "Only the controller's rules release USDG."],
      ["Title with payment", "The bill of lading moves inside the payment."],
    ];
    const els = [...header("11 · Technology and moat"), ...headline("Technology and moat", "Five mechanisms that ==enforce each other==.")];
    links.forEach(([t, body], i) => {
      const x = X + i * 345, y = 360, w = 300;
      els.push(card(x, y, w, 400, { delay: 150 + i * 120 }));
      if (i < 4) els.push(L(x + w + 6, y + 200, x + w + 39, y + 200, { color: C.ink, width: 4, anim: "draw", draw: true, delay: 300 + i * 120 }));
      els.push(T(x + 30, y + 32, 120, 40, `0${i + 1}`, "label", { s: 28, b: true }));
      els.push(T(x + 30, y + 86, w - 60, 90, t, "card", { s: 34 }));
      els.push(T(x + 30, y + 190, w - 60, 190, body, "p", { s: 28 }));
    });
    els.push(T(X, 810, CW, 90, "A copy needs all five, tested together: **366** contract tests and **25** circuit tests.", "lead"));
    els.push(...footer("Groth16: 13,494 constraints, about 1 s to prove, about 0.25 M gas to verify · immutable core, eight fuzzed invariants · docs/architecture.md, docs/benchmarks.md"));
    return {
      id: "moat", section: "11 · Technology and moat", els,
      notes: "The moat is not one feature but the chain of them. Signed device readings feed a published fusion score; a Groth16 proof is bound to the contract's own public signals, so it cannot be replayed; only the controller can release the vault; and title moves inside the payment. A copy needs all five working together, which is what the 366 contract tests and 25 circuit tests cover.",
    };
  })(),
  // 12 -----------------------------------------------------------------------------------------------------
  (() => {
    const big = [["10", "contracts source-verified on chain"], ["4", "packages published on npm and PyPI"], ["25", "MCP tools on a public remote server"], ["3", "extensions on Arbitrum Sepolia"]];
    const tests = [["366", "contract"], ["25", "circuit"], ["296", "frontend"], ["18", "end-to-end"], ["92", "SDK"], ["27", "MCP"], ["36", "gateway"], ["25", "Python"]];
    const els = [...header("12 · Traction"), ...headline("Traction", "Production build live on ==Robinhood Chain\u00a0Testnet==.", { h: 170 })];
    els.push(T(X, 372, CW, 44, "Mainnet release next.", "lead"));
    big.forEach(([n, l], i) => {
      const x = X + i * 430;
      els.push(card(x, 450, 400, 250));
      els.push(T(x + 32, 476, 340, 100, n, "num", { s: 96, count: true }));
      els.push(T(x + 32, 590, 340, 90, l, "p", { s: 28 }));
    });
    els.push(T(X, 736, CW, 34, "Tests, all passing", "label"));
    tests.forEach(([n, l], i) => {
      const x = X + i * 210;
      els.push(T(x, 780, 200, 64, n, "num", { s: 56, count: true }));
      els.push(T(x, 850, 200, 40, l, "cap"));
    });
    els.push(...footer(`@cargoflow/sdk, @cargoflow/mcp, @cargoflow/gateway on npm and cargoflow on PyPI (0.1.0) · Fhenix and GMX Sourcify-verified, Stylus engine · [/deployments](${SITE}/deployments)`));
    return {
      id: "traction", section: "12 · Traction", els,
      notes: "The production build is live on Robinhood Chain Testnet, and the mainnet release is next. Ten contracts are source-verified, four packages are published on npm and PyPI, a public MCP server exposes 25 tools to claude.ai, and three extensions run on Arbitrum Sepolia. Every suite passes: 366 contract tests, 25 circuit tests, 296 frontend unit tests and 18 end-to-end tests, plus the package suites.",
    };
  })(),
  // 13 -----------------------------------------------------------------------------------------------------
  (() => {
    const runs = [
      ["CF-SG-VAX-0202", "Website run: excursion, automatic ZK recovery, settlement.", ["proof 0x79c68fc0…", tx("0x79c68fc0a35fc23f08678215e858a1d16af38ce61b13307524e67802af8a232f")], ["settle 0xabba66b6…", tx("0xabba66b6f602ed9e04bbabcd1a56e118cf188ae8bd9934b3f7e405e341f6e562")]],
      ["CF-SG-VAX-0401", "The buyer paid with a passkey: three ERC-4337 user operations.", ["account 0xBCf28437…", `${EXPLORER}/address/0xBCf284379b7Ce7144d4154BCc73043A750125E56`], ["settle 0xee1d5ba8…", tx("0xee1d5ba8731c027a79c1ce68696360e694f687c7926cd36bca1a6db215815956")]],
      ["CF-LIVE-1791029236301", "v3 reference run through the hosted API, each party signing.", ["proof 0xadfe3b2f…", tx("0xadfe3b2fa8c89d30f847232b35009373b3d4163dc75b321d6490631f503a9f52")], ["paid 0x37571b49…", tx("0x37571b49186b43f2f02df4d2034cd495ac7095766d113c20060cdecf4e365a35")]],
      ["v1 hero run", "22 transactions in 116 seconds, proof verified on chain.", ["proof 0x3910c2a5…", tx("0x3910c2a5c191be43985e0a683e4fdc52a02af8d2f9b4d49749afbf79a131a3e1")], ["settle 0xcb11761c…", tx("0xcb11761ca1c1b6b302c15ee27de0090b5c379034c28e621cf3cf9563b2b5bd6c")]],
    ];
    const els = [...header("13 · Live runs"), ...headline("Live runs", "Full lifecycles settled on chain, ==with receipts==.")];
    els.push(card(X, 320, CW, 600, { anim: "fade" }));
    runs.forEach(([id, what, a, b], i) => {
      const y = 350 + i * 142;
      if (i) els.push(L(X + 40, y - 14, X + CW - 40, y - 14, { color: C.line, width: 2, anim: "fade" }));
      els.push(T(X + 40, y + 10, 500, 100, id, "p", { f: "mono", b: true, s: 30, c: C.ink }));
      els.push(T(X + 560, y + 10, 680, 100, what, "p", { s: 28 }));
      els.push(T(X + 1290, y + 4, 360, 110, `[${a[0]}](${a[1]})\n[${b[0]}](${b[1]})`, "p", { f: "mono", s: 28, c: C.teal, lh: 1.45 }));
    });
    els.push(...footer(`Every hash links to explorer.testnet.chain.robinhood.com · full transaction tables in the README, "Live on Robinhood Chain Testnet"`));
    return {
      id: "live-runs", section: "13 · Live runs", els,
      notes: "These are full lifecycles on the public chain, and every hash on the slide is a link. The film's shipment ran through the website with each party in its own session, including an excursion and an automatic ZK recovery; another shipment was paid by the buyer with a passkey. The v3 reference run went from registration to settlement through the hosted API, and the original CLI run did 22 transactions in 116 seconds.",
    };
  })(),
  // 14 -----------------------------------------------------------------------------------------------------
  (() => {
    const els = [...header("14 · Market"), ...headline("Market size, bottom-up", "Start with one corridor inside a ==$2.5T gap==.")];
    // nested rings, bottom-aligned
    const cx = X + 320, base = 960;
    els.push(O(cx - 320, base - 640, 640, { fill: C.mist, line: C.line, lw: 3, anim: "zoom" }));
    els.push(O(cx - 200, base - 400, 400, { fill: C.limeSoft, line: C.lime2, lw: 3, anim: "zoom", delay: 200 }));
    els.push(O(cx - 105, base - 210, 210, { fill: C.lime, line: null, anim: "zoom", delay: 400 }));
    els.push(T(cx - 150, base - 590, 300, 34, "TAM", "label", { a: "center" }));
    els.push(T(cx - 150, base - 552, 300, 70, "$2.5T", "num", { s: 60, a: "center", count: true }));
    els.push(T(cx - 130, base - 340, 260, 34, "SAM", "label", { a: "center" }));
    els.push(T(cx - 130, base - 302, 260, 56, "~$15.2B", "num", { s: 44, a: "center", count: true }));
    els.push(T(cx - 80, base - 158, 160, 34, "SOM", "label", { a: "center", c: C.ink }));
    els.push(T(cx - 80, base - 122, 160, 48, "~$152M", "num", { s: 34, a: "center", count: true }));
    const rows = [
      ["TAM", "$2.5T", "Unmet trade finance demand in 2025 (ADB).", null],
      ["SAM", "~$15.2B", "India's pharma exports, $30.47B, × 50% sold on credit.", "A1"],
      ["SOM", "~$152M", "1% of SAM financed through CargoFlow by year 3.", "A2"],
      ["Revenue", "$0.46–0.76M", "A planned 30 to 50 bps fee on that volume, per year.", "A3"],
      ["Capital", "~$22M", "Financier capital outstanding at 52-day terms.", "A4"],
    ];
    rows.forEach(([k, v, d, a], i) => {
      const y = 330 + i * 124;
      els.push(T(860, y, 200, 34, k, "label"));
      els.push(T(860, y + 36, 300, 60, v, "num", { s: 44 }));
      els.push(T(1180, y + 10, a ? 520 : 620, 90, d, "p", { s: 28 }));
      if (a) {
        els.push(R(1720, y + 14, 80, 40, { fill: C.mist, line: C.line, r: 20, anim: "pop" }));
        els.push(T(1720, y + 14, 80, 40, a, "label", { a: "center", va: "middle", c: C.ink2, s: 22, ls: 0.04 }));
      }
    });
    els.push(...footer(`Assumptions: A1 Atradius' India-wide B2B credit share applies to pharma · A2 1% is a target · A3 planned fee level · A4 365 / 52, about 7 turns a year · [PIB, FY 2024-25 pharma exports](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2231234) · [ADB](https://www.adb.org/news/demand-trade-finance-rise-amid-supply-chain-realignment-adb-report) · [Atradius](https://group.atradius.com/knowledge-and-research/reports/b2b-payment-practices-trends-india-2025)`));
    return {
      id: "market", section: "14 · Market", els,
      notes: "We size the market bottom-up from one corridor. India exported 30.47 billion dollars of pharmaceuticals in FY 2024-25, and half of B2B sales are made on credit, which gives a serviceable market of about 15.2 billion a year. One percent of that by year three is about 152 million financed a year, which at a planned 30 to 50 basis points is 0.46 to 0.76 million of revenue; the assumptions A1 to A4 are on the slide.",
    };
  })(),
  // 15 -----------------------------------------------------------------------------------------------------
  (() => {
    const lines = [
      ["01", "Protocol fee", "30 to 50 bps of each drawn facility, inside the settlement waterfall (A3)."],
      ["02", "Cover premiums", "A share of default and parametric cover written through the CoverPool."],
      ["03", "Software and data", "Portfolio risk, evidence API and MCP for funds and insurers."],
    ];
    const els = [...header("15 · Business model"), ...headline("Business model", "Paid when ==capital moves==, not before.")];
    lines.forEach(([n, t, body], i) => {
      const x = X + i * 570;
      els.push(card(x, 330, 540, 330));
      els.push(T(x + 36, 362, 200, 34, n, "label", { s: 28, b: true }));
      els.push(T(x + 36, 408, 470, 50, t, "card"));
      els.push(T(x + 36, 470, 470, 170, body, "p", { s: 28 }));
    });
    // the waterfall bar: 58.8 / 40 / 1.2 of one 100,000 USDG payment
    const bx = X, bw = CW, by = 740, bh = 76;
    els.push(T(X, 696, CW, 34, "One 100,000 USDG payment, split on chain (reference facility)", "label"));
    els.push(R(bx, by, bw * 0.588 - 4, bh, { fill: C.limeSoft, line: null, r: 14, anim: "grow" }));
    els.push(R(bx + bw * 0.588, by, bw * 0.40 - 4 - 120, bh, { fill: C.lime, line: null, r: 14, anim: "grow", delay: 200 }));
    els.push(R(bx + bw - 120, by, 120, bh, { fill: C.mint, line: null, r: 14, anim: "grow", delay: 400 }));
    els.push(T(bx + 24, by, bw * 0.588 - 48, bh, "58,800 to the exporter", "p", { va: "middle", b: true, c: C.ink, s: 28 }));
    els.push(T(bx + bw * 0.588 + 24, by, bw * 0.40 - 170, bh, "40,000 principal", "p", { va: "middle", b: true, c: C.ink, s: 28 }));
    els.push(T(bx + bw - 120, by, 120, bh, "1,200", "p", { va: "middle", a: "center", b: true, c: C.ink, s: 28 }));
    els.push(T(X, 846, CW, 50, "Principal and the 3% fee go to the financier. The protocol fee is one more line in this split.", "cap"));
    els.push(...footer("Non-custodial: the ReceivableVault is the sole USDG custodian · fee levels are planned (A3) · contracts/src/ReceivableVault.sol, CoverPool.sol, packages/python"));
    return {
      id: "business-model", section: "15 · Business model", els,
      notes: "CargoFlow is paid when capital moves, not before. The primary line is a protocol fee of 30 to 50 basis points on drawn volume, taken inside the settlement waterfall the contract already runs; then a share of cover premiums written through the CoverPool, and software and data for funds and insurers. The software is non-custodial: the vault is the only USDG custodian, and the protocol fee ships with the mainnet release.",
    };
  })(),
  // 16 -----------------------------------------------------------------------------------------------------
  (() => {
    const cols = ["Sees cargo condition", "Releases on evidence", "Payment and title together", "Private telemetry", "Stablecoin settlement"];
    const rows = [
      ["Bank trade finance", "letters of credit, collections", ["n", "h", "h", "n", "n"]],
      ["Factoring fintechs", "advance on the buyer's credit", ["n", "n", "n", "n", "n"]],
      ["Cold-chain monitoring", "loggers and visibility", ["y", "n", "n", "n", "n"]],
      ["On-chain RWA credit", "pooled private credit", ["n", "n", "n", "n", "y"]],
      ["CargoFlow", "a facility per shipment", ["c", "c", "c", "c", "c"]],
    ];
    const els = [...header("16 · Competition"), ...headline("Landscape, by category", "Each category solves one piece. ==CargoFlow joins them.==", { h: 170 })];
    const x0 = X, labelW = 560, colW = 224, top = 448, rowH = 88;
    cols.forEach((c, j) => els.push(T(x0 + labelW + j * colW, top - 84, colW - 16, 76, c, "cap", { s: 24, c: C.ink2, b: true, a: "center", va: "bottom", role: "label" })));
    rows.forEach(([name, sub, marks], i) => {
      const y = top + 8 + i * rowH;
      if (i === 4) els.push(R(x0 - 20, y - 8, CW + 40, rowH + 4, { fill: C.limeSoft, line: null, r: 18, anim: "fade", delay: 700 }));
      else els.push(L(x0, y + rowH - 6, x0 + CW, y + rowH - 6, { color: C.line, width: 2, anim: "fade" }));
      els.push(T(x0, y, labelW - 20, 42, name, "card", { s: 32 }));
      els.push(T(x0, y + 42, labelW - 20, 38, sub, "cap", { s: 28 }));
      marks.forEach((m, j) => {
        const cx = x0 + labelW + j * colW + (colW - 16) / 2 - 18;
        const st = { y: { fill: C.ink, line: C.ink }, h: { fill: C.amber, line: C.ink }, n: { fill: C.white, line: "B9C4BC" }, c: { fill: C.lime, line: C.ink } }[m];
        els.push(O(cx, y + 22, 36, { ...st, lw: 3, anim: "pop", delay: 300 + i * 80 + j * 40 }));
      });
    });
    els.push(O(X, 922, 26, { fill: C.ink, line: C.ink, lw: 3, anim: "fade" }));
    els.push(T(X + 40, 915, 90, 40, "yes", "cap"));
    els.push(O(X + 150, 922, 26, { fill: C.amber, line: C.ink, lw: 3, anim: "fade" }));
    els.push(T(X + 190, 915, 330, 40, "partly, on documents", "cap"));
    els.push(O(X + 550, 922, 26, { fill: C.white, line: "B9C4BC", lw: 3, anim: "fade" }));
    els.push(T(X + 590, 915, 600, 40, "not a design goal of the category", "cap"));
    els.push(...footer("Categories described by their typical design, not by any one company. Ratings are CargoFlow's assessment; individual providers may differ."));
    return {
      id: "competition", section: "16 · Competition", els,
      notes: "Each category solves one piece. Banks have the cheapest capital but work on paper; factoring fintechs underwrite the buyer, not the goods; cold-chain vendors see the cargo but their data does not move money; and on-chain credit protocols settle in stablecoins but underwrite off chain. CargoFlow is the combination: evidence that releases money, with title and payment moving together. Logger vendors are partners, not rivals.",
    };
  })(),
  // 17 -----------------------------------------------------------------------------------------------------
  (() => {
    const doors = [
      ["Door 1 · logger vendors", "Make existing loggers finance-ready", "@cargoflow/gateway signs and sends logger exports."],
      ["Door 2 · credit funds", "Short-tenor USDG yield, evidence attached", "The market suggests a fee band per request."],
      ["Door 3 · forwarders, insurers", "Reach exporters through who they use", "The Pharma template sets 2 to 8 °C in one click."],
    ];
    const els = [...header("17 · Go-to-market"), ...headline("Go-to-market", "One corridor first: ==India pharma to Singapore==.", { h: 170 })];
    els.push(I(X, 400, 780, 439, "media/still-release.jpg", { gif: "../assets/v3/how-release.gif", anim: "left", parallax: true, alt: "The route from Nhava Sheva past Kochi and Colombo toward Singapore, milestones on the map." }));
    // drawn route under the map: three ports
    const ports = [["Nhava Sheva", X + 40], ["Colombo", X + 390], ["Singapore", X + 740]];
    els.push(L(ports[0][1], 878, ports[2][1], 878, { color: C.ink, width: 4, draw: true, anim: "draw", delay: 300 }));
    ports.forEach(([n, x], i) => {
      els.push(O(x - 13, 865, 26, { fill: i === 2 ? C.lime : C.white, line: C.ink, lw: 4, anim: "pop", delay: 400 + i * 200 }));
      els.push(T(i === 0 ? x - 40 : i === 2 ? x + 40 - 240 : x - 120, 900, 240, 40, n, "cap", { a: i === 0 ? "left" : i === 2 ? "right" : "center", c: C.ink2, b: true }));
    });
    doors.forEach(([k, t, body], i) => {
      const y = 400 + i * 172;
      els.push(card(980, y, 820, 150, { delay: 200 + i * 120 }));
      els.push(T(1012, y + 20, 760, 30, k, "label"));
      els.push(T(1012, y + 56, 760, 44, t, "card", { s: 32 }));
      els.push(T(1012, y + 104, 760, 40, body, "p", { s: 28 }));
    });
    els.push(...footer("Pilot target: 3 exporters, 1 financier and 1 logger vendor on this lane, then more lanes and cold-chain categories · India pharma exports $30.47B in FY 2024-25 (PIB)"));
    return {
      id: "go-to-market", section: "17 · Go-to-market", els,
      notes: "We start with one corridor: India pharma to Singapore at 2 to 8 degrees. There are three doors: logger vendors, whose exports our gateway already signs and sends; credit funds looking for short-tenor USDG yield with evidence attached; and forwarders and insurers who already work with exporters. The pilot target is three exporters, one financier and one logger vendor on this lane.",
    };
  })(),
  // 18 -----------------------------------------------------------------------------------------------------
  (() => {
    const ms = [
      ["M1", "Security", "Independent audit and a public ZK ceremony", "35% of grant"],
      ["M2", "Real evidence", "Logger pilots and a secure-element board", "25% of grant"],
      ["M3", "Mainnet", "Real USDG on Robinhood Chain, protocol fee", "20% of grant"],
      ["M4", "Legal and title", "MLETR opinion on the bill of lading", "10% of grant"],
      ["M5", "Scale", "Calibrated scoring, a second corridor", "after the grant"],
    ];
    const els = [...header("18 · Roadmap"), ...headline("Roadmap, each milestone with an exit test", "From production build to the ==first real facility==.", { h: 170 })];
    els.push(R(X, 390, CW, 84, { fill: C.emeraldSoft, line: "9BE3C0", r: 20, anim: "up" }));
    els.push(T(X + 32, 390, CW - 64, 84, "**M0 done:** contracts v3 verified, live app, API and MCP, passkey payments, ZK recovery, four packages.", "p", { va: "middle", s: 28, c: C.ink }));
    ms.forEach(([id, t, body, share], i) => {
      const x = X + i * 342;
      els.push(card(x, 510, 312, 400, { delay: 200 + i * 100 }));
      els.push(...chip(x + 28, 540, id, { w: 84, h: 52, s: 28 }));
      els.push(T(x + 28, 616, 256, 90, t, "card", { s: 34 }));
      els.push(T(x + 28, 712, 256, 130, body, "p", { s: 28 }));
      els.push(T(x + 28, 852, 256, 36, share, "label", { c: C.ink2 }));
    });
    els.push(...footer("Exit tests: audit report published · 3 real shipments evidenced from physical loggers · first outside-financier facility settled in real USDG · written legal opinion · second corridor live"));
    return {
      id: "roadmap", section: "18 · Roadmap", els,
      notes: "M0 is done: contracts verified, the app, API and MCP live, passkey payments and ZK recovery working, four packages published. Next, M1 is an independent audit and a public ZK ceremony, M2 runs real logger pilots and a secure-element board, M3 is the mainnet release with real USDG and the protocol fee, and M4 is a legal opinion on the bill of lading. Each milestone has an exit test, listed at the bottom, so funding can follow evidence.",
    };
  })(),
  // 19 -----------------------------------------------------------------------------------------------------
  (() => {
    const uses = [
      [35, C.lime, "Security audit and public ZK ceremony", "M1", "10,500"],
      [25, C.mint, "Pilots and logger hardware", "M2", "7,500"],
      [20, C.amber, "Mainnet launch and first facilities", "M3", "6,000"],
      [10, C.sky, "Legal: MLETR opinion and structuring", "M4", "3,000"],
      [10, C.fog, "Team and infrastructure, six months", "all", "3,000"],
    ];
    const els = [...header("19 · The ask"), ...headline("The ask: the milestone-based grant", "A 30,000 USDG grant funds ==M1\u00a0to\u00a0M4==.")];
    let bx = X;
    uses.forEach(([p, col], i) => {
      const w = CW * p / 100;
      els.push(R(bx, 330, w - 6, 80, { fill: col, line: null, r: 14, anim: "grow", delay: 150 + i * 120 }));
      els.push(T(bx, 330, w - 6, 80, `${p}%`, "num", { s: 32, a: "center", va: "middle", delay: 150 + i * 120 }));
      bx += w;
    });
    uses.forEach(([p, col, what, m, amt], i) => {
      const y = 460 + i * 74;
      els.push(R(X, y + 12, 32, 32, { fill: col, line: C.ink, lw: 1.5, r: 8, anim: "pop" }));
      els.push(T(X + 60, y, 1000, 56, what, "p", { s: 30, c: C.ink, va: "middle" }));
      els.push(T(1180, y, 200, 56, m, "label", { s: 28, va: "middle", c: C.ink2 }));
      els.push(T(1400, y, 400, 56, `${amt} USDG`, "num", { s: 32, a: "right", va: "middle" }));
      if (i < 4) els.push(L(X, y + 66, X + CW, y + 66, { color: C.line, width: 2, anim: "fade" }));
    });
    els.push(T(X, 860, CW, 50, "Released like a CargoFlow facility: each tranche follows a milestone's exit test.", "lead", { s: 30, c: C.ink, b: true }));
    els.push(...footer("Arbitrum Open House Singapore Online Buildathon (HackQuest): 115,000 USDG in prizes, including up to 30,000 USDG in milestone-based grants · any prize follows the same split"));
    return {
      id: "ask", section: "19 · The ask", els,
      notes: "Our ask is the buildathon's milestone grant of up to 30,000 USDG, split across M1 to M4. Thirty-five percent goes to the security audit and ZK ceremony, 25 to pilots and logger hardware, 20 to the mainnet launch and first facilities, and 10 each to legal and to infrastructure. We propose releasing it the way CargoFlow releases capital: each tranche against a milestone's exit test.",
    };
  })(),
  // 20 -----------------------------------------------------------------------------------------------------
  (() => {
    const crit = [
      ["Deployed on an Arbitrum chain", "10 contracts verified on Robinhood Chain Testnet (46630)."],
      ["Smart contract quality", "366 tests, eight invariants, an immutable core with no proxy."],
      ["Product-market fit", "A sourced problem, five role portals, four published packages."],
      ["Innovation", "Evidence-gated capital, bound ZK recovery, a keyless Claude co-pilot."],
      ["Real problem solving", "End-to-end runs with every transaction linked."],
      ["Paxos USDG", "The only money CargoFlow moves."],
      ["Robinhood Chain", "Its RIP-7212 precompile carries the passkey flow."],
    ];
    const els = [...header("20 · Buildathon fit"), ...headline("Arbitrum Open House Singapore", "Every criterion, with ==something to click==.")];
    crit.forEach(([t, body], i) => {
      const x = X + (i % 2) * 860, y = 330 + Math.floor(i / 2) * 150;
      els.push(R(x, y + 8, 12, 108, { fill: C.lime, line: null, r: 6, anim: "grow" }));
      els.push(T(x + 36, y, 780, 44, t, "card", { s: 32 }));
      els.push(T(x + 36, y + 50, 780, 80, body, "p", { s: 28 }));
    });
    els.push(T(X + 860 + 36, 330 + 3 * 150, 780, 44, `[Read the HackQuest listing](https://www.hackquest.io/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon)`, "p", { s: 28, c: C.teal, b: true }));
    els.push(...footer(`Evidence: README "Built for Arbitrum Open House Singapore", "Live on Robinhood Chain Testnet", "Measured, not claimed" · docs/project/21-hackathon-alignment.md`));
    return {
      id: "buildathon", section: "20 · Buildathon fit", els,
      notes: "Against the buildathon's criteria: every core contract is deployed and verified on Robinhood Chain Testnet, the contract suite has 366 tests including eight invariants, and the product has portals for every party plus four published packages. USDG is the only money CargoFlow moves, and Robinhood Chain's P-256 precompile carries the passkey flow. Each line links to evidence in the README.",
    };
  })(),
  // 21 -----------------------------------------------------------------------------------------------------
  (() => {
    const contact = [
      ["Website", `[cargoflow.adoranto737.workers.dev](${SITE})`],
      ["GitHub", "[github.com/LSUDOKO/CargoFlow](https://github.com/LSUDOKO/CargoFlow)"],
      ["npm", "[@cargoflow/sdk](https://www.npmjs.com/package/@cargoflow/sdk) · [mcp](https://www.npmjs.com/package/@cargoflow/mcp) · [gateway](https://www.npmjs.com/package/@cargoflow/gateway)"],
      ["PyPI", "[pypi.org/project/cargoflow](https://pypi.org/project/cargoflow/)"],
      ["Claude", "[cargoflow-mcp.adoranto737.workers.dev/mcp](https://cargoflow-mcp.adoranto737.workers.dev/mcp)"],
    ];
    const els = [...header("21 · Team and contact"), ...headline("Team and contact", "Built by its founder, ==live and open==.")];
    els.push(I(X, 340, 340, 340, "media/founder.jpg", { round: true, frame: false, fit: "cover", pos: "center", anim: "zoom", alt: "Arpit Singh, founder of CargoFlow." }));
    els.push(T(X, 712, 640, 70, "Arpit Singh", "h", { s: 56 }));
    els.push(T(X, 790, 640, 44, "Founder", "lead", { c: C.slate }));
    els.push(T(X, 846, 640, 40, "[github.com/LSUDOKO](https://github.com/LSUDOKO)", "p", { f: "mono", s: 28, c: C.teal }));
    els.push(card(820, 340, 980, 560, { anim: "up" }));
    contact.forEach(([k, v], i) => {
      const y = 372 + i * 104;
      els.push(T(860, y + 20, 180, 40, k, "label", { s: 24 }));
      els.push(T(1050, y + 12, 720, 56, v, "p", { f: "mono", s: 28, c: C.ink, va: "middle" }));
      if (i < 4) els.push(L(860, y + 92, 1760, y + 92, { color: C.line, width: 2, anim: "fade" }));
    });
    els.push(...footer("MIT licensed · Telegram alerts: @Cargo_FlowBot · API: cargoflow-api-75ul.onrender.com"));
    return {
      id: "team-contact", section: "21 · Team and contact", els,
      notes: "CargoFlow is built by its founder, Arpit Singh, and everything is live and open source under MIT. You can try the web app, read the code on GitHub, install the SDK, MCP server and gateway from npm or the Python package from PyPI, and connect Claude to the remote MCP server. Thank you; I would be glad to walk through a live shipment.",
    };
  })(),
];
