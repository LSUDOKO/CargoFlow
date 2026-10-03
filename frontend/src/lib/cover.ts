// Default cover (contracts v2, CoverPool). An insurer escrows cover in USDG; the financier accepts an offer by paying
// the premium straight to the insurer. If the facility settles, the cover returns to the insurer; if it defaults,
// the financier is paid min(cover, principal drawn) and the rest returns to the insurer. Pure helpers: what each
// wallet may do now, the amounts involved and the words for them.

import { parseUnits } from "viem";
import type { Cover, CoverOffer } from "./api/schemas";
import { formatUSDG } from "./format";

export const MAX_PREMIUM_BPS = 2_000; // CoverPool.MAX_PREMIUM_BPS (20%)
const BPS = 10_000n;

/** The premium the financier pays on accepting: amount * premiumBps / 10,000, rounded down like the contract. */
export const premiumOf = (amount: bigint | string, premiumBps: number) => (BigInt(amount) * BigInt(premiumBps)) / BPS;

/** What a claim after a default pays: the financier min(cover, loss), the insurer the remainder. */
export function claimSplit(cover: bigint | string, drawn: bigint | string): { payout: bigint; remainder: bigint } {
  const c = BigInt(cover), loss = BigInt(drawn);
  const payout = loss < c ? loss : c;
  return { payout, remainder: c - payout };
}

const usdgUnits = (v: string) => {
  try {
    const t = v.trim().replace(/,/g, "");
    return t ? parseUnits(t, 6) : undefined;
  } catch {
    return undefined;
  }
};

export type OfferForm = { amount: string; premiumPct: string };

/** Validates an insurer's offer against the facility's commitment; returns the parsed values when valid. */
export function validateOffer(f: OfferForm, committed: bigint | string): { errors: Partial<Record<keyof OfferForm, string>>; amount?: bigint; premiumBps?: number } {
  const errors: Partial<Record<keyof OfferForm, string>> = {};
  const c = BigInt(committed);
  const amount = usdgUnits(f.amount);
  if (amount === undefined || amount <= 0n) errors.amount = "Enter how much cover to escrow, in USDG.";
  else if (amount > c) errors.amount = `Cover cannot exceed the facility's ${formatUSDG(c)} USDG.`;
  const pct = f.premiumPct.trim() === "" ? NaN : Number(f.premiumPct);
  const bps = Math.round(pct * 100);
  if (!Number.isFinite(pct) || pct < 0 || bps > MAX_PREMIUM_BPS) errors.premiumPct = "Use a premium from 0% to 20%.";
  else if (Math.abs(pct * 100 - bps) > 1e-9) errors.premiumPct = "Use at most two decimals.";
  return Object.keys(errors).length ? { errors } : { errors, amount, premiumBps: bps };
}

/** Facility states in which cover can be offered and accepted (before transit starts). */
export const COVER_OPEN_STATES = ["CREATED", "FINANCED"] as const;
export const coverOpen = (status: string | undefined) => !!status && (COVER_OPEN_STATES as readonly string[]).includes(status);

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export type CoverActions = {
  /** the wallet may post an offer now */
  offer: boolean;
  /** why it may not, when that helps ("The financier cannot insure its own facility.") */
  offerBlocked: string | null;
  /** the wallet's own open offer, if any */
  myOffer: CoverOffer | null;
  /** the wallet is the financier and may accept one of the offers */
  accept: boolean;
  /** anyone may return the cover to the insurer (facility settled) */
  release: boolean;
  /** anyone may pay the cover out (facility defaulted) */
  claim: boolean;
};

/** What `address` can do with the shipment's cover right now. */
export function coverActions(input: { status: string | undefined; financier: string | undefined; cover: Cover | null; offers: CoverOffer[]; address: string | undefined }): CoverActions {
  const { status, financier, cover, offers, address } = input;
  const open = coverOpen(status);
  const myOffer = (address && offers.find((o) => same(o.insurer, address))) || null;
  const isFinancier = same(address, financier);
  const active = cover?.status === "ACTIVE";
  let offerBlocked: string | null = null;
  if (!address) offerBlocked = "Connect a wallet to offer cover.";
  else if (!open) offerBlocked = "Cover can only be offered before transit starts.";
  else if (cover) offerBlocked = "The financier has already accepted a cover.";
  else if (isFinancier) offerBlocked = "The financier cannot insure its own facility.";
  else if (myOffer) offerBlocked = "You already have an open offer. Withdraw it to change it.";
  return {
    offer: offerBlocked === null,
    offerBlocked,
    myOffer,
    accept: isFinancier && open && !cover && offers.length > 0,
    // CoverPool.release also accepts a cancelled facility (contracts v3): the cover goes back to the insurer
    release: active && (status === "SETTLED" || status === "CANCELLED"),
    claim: active && status === "DEFAULTED",
  };
}

/** One line for the overview: "Covered: 20,000 USDG by 0x12…ab (premium 400 USDG)" and so on. */
export function coverSummary(cover: Cover | null, openOffers: number, status: string | undefined, short: (a: string) => string): string {
  if (cover) {
    if (cover.status === "RELEASED") return status === "CANCELLED" ? `The ${formatUSDG(cover.amount)} USDG cover went back to the insurer when the facility was cancelled.` : `The ${formatUSDG(cover.amount)} USDG cover went back to the insurer when the invoice was paid.`;
    if (cover.status === "TRIGGERED") return `The parametric trigger was met: the financier was credited ${formatUSDG(cover.financierPayout)} USDG, the exporter ${formatUSDG(cover.parametric?.exporterSalvage ?? "0")} USDG salvage and ${formatUSDG(cover.insurerReturn)} USDG went back to the insurer.`;
    if (cover.status === "CLAIMED") return `The cover paid the financier ${formatUSDG(cover.financierPayout)} USDG after the default; ${formatUSDG(cover.insurerReturn)} USDG went back to the insurer.`;
    const trig = cover.parametric?.consecutiveFailedEpochs ? ` Parametric: pays out after ${cover.parametric.consecutiveFailedEpochs} failed evidence ${cover.parametric.consecutiveFailedEpochs === 1 ? "batch" : "batches"} in a row.` : "";
    return `Covered: ${formatUSDG(cover.amount)} USDG escrowed by ${short(cover.insurer)}, who was paid a ${formatUSDG(cover.premium)} USDG premium.${trig}`;
  }
  if (openOffers > 0) return `${openOffers} cover ${openOffers === 1 ? "offer is" : "offers are"} waiting for the financier.`;
  return coverOpen(status) ? "Not covered yet. Insurers can offer cover until transit starts." : "No default cover was taken out.";
}

/* ---------- parametric cover (contracts v3) ---------- */

export const MAX_TRIGGER_EPOCHS = 32; // CoverPool.MAX_TRIGGER_EPOCHS

/** Facility states in which a parametric trigger can be proved. */
export const TRIGGER_STATES = ["ACTIVE", "PAUSED", "DISPUTED"] as const;

export type ParametricForm = { epochs: string; salvage: string };

/** Validates parametric terms against the cover amount (1..32 epochs, salvage at most the cover). */
export function validateParametric(f: ParametricForm, cover: bigint | undefined): { errors: Partial<Record<keyof ParametricForm, string>>; epochs?: number; salvage?: bigint } {
  const errors: Partial<Record<keyof ParametricForm, string>> = {};
  const n = f.epochs.trim() === "" ? NaN : Number(f.epochs);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TRIGGER_EPOCHS) errors.epochs = `Use a whole number of batches from 1 to ${MAX_TRIGGER_EPOCHS}.`;
  const salvage = f.salvage.trim() === "" ? 0n : usdgUnits(f.salvage);
  if (salvage === undefined || salvage < 0n) errors.salvage = "Enter the salvage in USDG, or leave it at 0.";
  else if (cover !== undefined && salvage > cover) errors.salvage = `The salvage cannot exceed the ${formatUSDG(cover)} USDG cover.`;
  return Object.keys(errors).length ? { errors } : { errors, epochs: n, salvage: salvage! };
}

/** What a parametric trigger pays: the financier min(cover, drawn), the exporter min(salvage, rest), the insurer the remainder. */
export function parametricSplit(cover: bigint | string, drawn: bigint | string, salvage: bigint | string): { financier: bigint; exporter: bigint; insurer: bigint } {
  const { payout, remainder } = claimSplit(cover, drawn);
  const s = BigInt(salvage);
  const exporter = s < remainder ? s : remainder;
  return { financier: payout, exporter, insurer: remainder - exporter };
}

export type OrdinalEpoch = { epochId: string; ordinal: number; compliant: boolean };

export type TriggerCheck = {
  /** N consecutive failing epochs after the floor exist */
  met: boolean;
  /** the epoch ids to pass to triggerParametric, in commit order (empty unless met) */
  epochIds: string[];
  /** the failing epochs in a row at the end of the record, counting only those after the floor */
  streak: number;
  needed: number;
};

/**
 * Finds the proof for CoverPool.triggerParametric: `n` epoch ids whose commit ordinals are consecutive, all
 * non-compliant and all greater than `floor` (the shipment's epoch count when the cover was accepted). Picks the
 * latest such window. Epochs with an unknown ordinal (0) are ignored; a gap in the ordinals breaks a run, because an
 * epoch the list does not know about could be compliant.
 */
export function findTrigger(epochs: OrdinalEpoch[], n: number, floor: number): TriggerCheck {
  const known = epochs.filter((e) => e.ordinal > floor).sort((a, b) => a.ordinal - b.ordinal);
  let run: OrdinalEpoch[] = [];
  let best: OrdinalEpoch[] = [];
  let prev = floor;
  for (const e of known) {
    if (e.ordinal === prev) continue; // a duplicate entry for the same ordinal
    if (e.compliant || e.ordinal !== prev + 1) run = [];
    if (!e.compliant) run.push(e);
    if (run.length >= n && n > 0) best = run.slice(-n);
    prev = e.ordinal;
  }
  // the streak at the end of the record (what the "x of N" progress shows)
  const last = known.at(-1);
  const streak = last && !last.compliant ? run.length : 0;
  return { met: n > 0 && best.length === n, epochIds: best.map((e) => e.epochId), streak, needed: n };
}
