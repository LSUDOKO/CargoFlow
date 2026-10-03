/**
 * Pure step mapping for the scroll story (no DOM, no GSAP), shared by StoryMotion and its tests.
 *
 * The pinned timeline is `n` units long, one unit per step. Step k occupies [k, k + 1): the first ENTER of the unit
 * cross-fades from step k - 1, its own animations play inside the next WINDOW, and the rest is a hold so a reader
 * can finish the caption before the next step slides in.
 */
export const ENTER = 0.14;
export const WINDOW = 0.66;
/** Where inside its unit a step counts as "settled" (all animations done). */
export const SETTLE = ENTER + WINDOW + 0.06;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** The active step for a scroll progress 0..1 through the pinned section. */
export function stepAt(progress: number, n: number): number {
  if (n <= 0) return 0;
  return Math.min(n - 1, Math.floor(clamp01(progress) * n));
}

/**
 * Timeline position and duration (in step units) of an element animation inside step `step`, from its
 * `data-at` (0..1, start within the step's window) and `data-d` (0..1, share of the window).
 */
export function animSpan(step: number, at = 0, d = 0.3): { position: number; duration: number } {
  const a = clamp01(at);
  const dur = Math.max(0.02, clamp01(d) * WINDOW);
  // never let an animation spill into the next step's cross-fade
  const position = Math.min(step + ENTER + a * WINDOW, step + 1 - dur);
  return { position, duration: dur };
}

/** The scroll position that shows step k fully played, given the pinned trigger's start and end. */
export function stepScrollY(start: number, end: number, k: number, n: number): number {
  if (n <= 0) return start;
  const kk = Math.min(n - 1, Math.max(0, Math.round(k)));
  return Math.round(start + (end - start) * Math.min(1, (kk + SETTLE) / n));
}

/** Formats an animated figure the way the scene prints it: grouped thousands, fixed decimals. */
export function formatCount(v: number, decimals = 0): string {
  const safe = Number.isFinite(v) ? v : 0;
  return safe.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Reads a scene number back ("40,000" → 40000, "9.1" → 9.1); NaN when it is not a number. */
export function parseCount(text: string): number {
  const t = text.replace(/,/g, "").trim();
  return t === "" ? Number.NaN : Number(t);
}

export type StepCopy = { id: string; short: string; eyebrow: string; title: string; body: string; hood: string };

/** The six beats, in the film's order and in plain words. `hood` is the one technical line under each. */
export const STEPS: StepCopy[] = [
  {
    id: "register",
    short: "Register",
    eyebrow: "Meera, exporter",
    title: "Meera registers her shipment",
    body: "A 40-foot refrigerated container of vaccines leaves Nhava Sheva for Singapore. Meera sets the rule it must keep, 2 to 8\u00a0°C the whole way, and splits her financing into five milestones along the route.",
    hood: "The route, the invoice and the cold-chain policy are stored on chain, and the contract enforces them.",
  },
  {
    id: "fund",
    short: "Fund",
    eyebrow: "Daniel, financier",
    title: "Daniel funds it, into a locked vault",
    body: "Daniel puts up 40,000 USDG. It does not go to Meera yet: it waits in an escrow vault with one drawer per milestone, and nobody, not even CargoFlow, can send it anywhere else.",
    hood: "A shipment-specific escrow vault holds the USDG; only the release rules can move it.",
  },
  {
    id: "release",
    short: "Release",
    eyebrow: "The data logger",
    title: "The cargo vouches for itself",
    body: "Probes inside the container sign every temperature reading. The readings are in range, so the first drawer opens and 8,000 USDG goes straight to Meera, while the ship is still at sea.",
    hood: "Every 8 signed readings become one Merkle root on chain; score, sensor conflict and freshness are checked before a release.",
  },
  {
    id: "pause",
    short: "Pause",
    eyebrow: "Off Sri Lanka",
    title: "A warm reading pauses the money",
    body: "Off Sri Lanka, the probe by the door reads 9.1\u00a0°C. Nobody has to notice or make a phone call: the next payment pauses on the spot, and everyone can see why.",
    hood: "An out-of-range evidence batch flips the facility to Paused; no tranche can release until a verified recovery.",
  },
  {
    id: "prove",
    short: "Prove",
    eyebrow: "The proof",
    title: "A private proof clears it",
    body: "The probe in the middle of the load stayed between 2 and 8\u00a0°C. A zero-knowledge proof shows exactly that without revealing a single reading. Meera gets a “Proof ready” alert, signs, and payments resume.",
    hood: "A Groth16 proof, bound to this exact pause, is verified by the contract itself.",
  },
  {
    id: "settle",
    short: "Settle",
    eyebrow: "Wei Lin, buyer",
    title: "Wei Lin pays once, everyone is settled",
    body: "The vaccines arrive and Wei Lin pays the 100,000 USDG invoice. In the same moment the vault repays Daniel his 40,000 plus a 1,200 fee and sends Meera the remaining 58,800.",
    hood: "One settle transaction runs a fixed waterfall: principal, fee, then the exporter's residual.",
  },
];
