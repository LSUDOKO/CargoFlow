"use client";

// The financing marketplace, party track records and the gas drip: zod schemas mirroring the plan's API contract
// (docs/superpowers/plans/2026-10-03-next-level.md), the exact messages each wallet signs, pure helpers and hooks.
// Every signed message joins its lines with "\n", lower-cases ids and addresses and has no trailing newline; the
// backend rebuilds the same string, so each one is pinned byte for byte in market.test.ts.

import { useQueries, useQuery } from "@tanstack/react-query";
import { parseUnits } from "viem";
import { z } from "zod";
import { ApiError, apiGet, apiPost } from "./client";
import { Policy, RoutePoint } from "./schemas";

const list = <T extends z.ZodTypeAny>(item: T) => z.array(item).nullish().transform((v) => v ?? []);
// USDG base units: a decimal string on the wire, tolerated as a number
const amount = z.union([z.string(), z.number()]).transform((v) => String(v));
const count = z.number().nullish().transform((v) => v ?? 0);

// ---------------------------------------------------------------------------------------------------- schemas

export const Offer = z.object({
  id: z.string(),
  financier: z.string(),
  feeBps: z.number(),
  createdAt: z.string(),
  accepted: z.boolean().nullish().transform((v) => v ?? false),
});
export type Offer = z.infer<typeof Offer>;

/** Fee guidance (GET /v1/pricing/suggest and each request's `pricing`): a band in basis points with its reasons. */
export const Pricing = z.object({
  lowBps: z.number(),
  midBps: z.number(),
  highBps: z.number(),
  reasons: list(z.object({ factor: z.string(), bps: z.number(), detail: z.string().nullish().transform((v) => v ?? "") })),
  model: z.string().optional(),
});
export type Pricing = z.infer<typeof Pricing>;

export const REQUEST_STATUSES = ["open", "accepted", "funded", "closed"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const MarketRequest = z.object({
  id: z.string(),
  shipmentId: z.string(),
  externalRef: z.string(),
  exporter: z.string(),
  buyer: z.string(),
  invoiceValue: amount,
  amount,
  maxFeeBps: z.number(),
  milestoneCount: z.number(),
  note: z.string().nullish().transform((v) => v ?? ""),
  route: list(RoutePoint),
  // a request is a policy-set shipment, but tolerate a partial policy rather than hide the request
  policy: Policy.partial().nullish().transform((v) => v ?? {}),
  status: z.string().transform((s) => s.toLowerCase()),
  offers: list(Offer),
  createdAt: z.string(),
  pricing: Pricing.nullish().catch(null).transform((v) => v ?? null),
});
export type MarketRequest = z.infer<typeof MarketRequest>;
export const RequestList = z.object({ requests: list(MarketRequest) });

export const Party = z.object({
  address: z.string(),
  exporter: z.object({
    shipments: count, settled: count, active: count, paused: count, disputed: count, defaulted: count, recoveries: count,
    cancelled: count, // contracts v3
    avgEvidenceScore: z.number().nullish().transform((v) => v ?? null),
    volume: amount.nullish().transform((v) => v ?? "0"),
  }),
  financier: z.object({
    facilities: count,
    committed: amount.nullish().transform((v) => v ?? "0"),
    drawn: amount.nullish().transform((v) => v ?? "0"),
    inEscrow: amount.nullish().transform((v) => v ?? "0"),
    feesEarned: amount.nullish().transform((v) => v ?? "0"),
    settled: count,
    defaulted: count,
    cancelled: count, // contracts v3
  }),
  buyer: z.object({ shipments: count, settled: count, paidVolume: amount.nullish().transform((v) => v ?? "0") }),
  // default cover written (contracts v2); absent on older backends
  insurer: z
    .object({
      offered: count,
      active: count,
      released: count,
      claimed: count,
      triggered: count, // contracts v3 parametric payouts
      coverWritten: amount.nullish().transform((v) => v ?? "0"),
      premiumsEarned: amount.nullish().transform((v) => v ?? "0"),
      paidOut: amount.nullish().transform((v) => v ?? "0"),
    })
    .nullish()
    .transform((v) => v ?? { offered: 0, active: 0, released: 0, claimed: 0, triggered: 0, coverWritten: "0", premiumsEarned: "0", paidOut: "0" }),
  grade: z.enum(["A", "B", "C", "new"]).catch("new"),
  since: z.union([z.string(), z.number()]).nullish().transform((v) => (v === undefined || v === null || v === "" ? null : v)),
});
export type Party = z.infer<typeof Party>;
export type Grade = Party["grade"];

/** Only the /v1/config fields this module needs (the shared Config schema in schemas.ts strips them). */
export const ConfigExtras = z.object({ chainId: z.number().optional(), gasDrip: z.boolean().nullish().transform((v) => v ?? false) });

/** POST responses are not pinned by the contract beyond an id or a transaction: accept anything object-shaped. */
export const Created = z.object({ id: z.string().optional() }).passthrough().nullish();
export const GasResult = z
  .object({ txHash: z.string().optional(), hash: z.string().optional(), amount: amount.optional(), amountWei: amount.optional() })
  .passthrough()
  .nullish();

// ---------------------------------------------------------------------------------------------------- messages

const lower = (s: string) => s.trim().toLowerCase();

export function requestMessage(shipmentId: string, amountBase: bigint | string, maxFeeBps: number, milestoneCount: number, issued: number): string {
  return `CargoFlow financing request\nshipment: ${lower(shipmentId)}\namount: ${String(amountBase)}\nmax fee bps: ${maxFeeBps}\nmilestones: ${milestoneCount}\nissued: ${issued}`;
}

export function offerMessage(requestId: string, feeBps: number, issued: number): string {
  return `CargoFlow offer\nrequest: ${lower(requestId)}\nfee bps: ${feeBps}\nissued: ${issued}`;
}

export function acceptMessage(requestId: string, offerId: string, issued: number): string {
  return `CargoFlow accept\nrequest: ${lower(requestId)}\noffer: ${lower(offerId)}\nissued: ${issued}`;
}

/** The plan names the close endpoint but not its message; this follows the same shape as the others. */
export function closeMessage(requestId: string, issued: number): string {
  return `CargoFlow close request\nrequest: ${lower(requestId)}\nissued: ${issued}`;
}

export function gasMessage(address: string, issued: number): string {
  return `CargoFlow gas\naddress: ${lower(address)}\nissued: ${issued}`;
}

export const nowSec = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------------------------------- pure helpers

/** A USDG amount typed by a person ("40,000.5") in base units, or undefined when it is not a number. */
export function parseUsdg(v: string): bigint | undefined {
  const t = v.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{0,6})?$/.test(t)) return undefined;
  try {
    return parseUnits(t, 6);
  } catch {
    return undefined;
  }
}

/** A fee typed as a percentage ("2.75") in basis points, or undefined when it is not a valid percentage. */
export function parsePctToBps(v: string): number | undefined {
  const t = v.trim();
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return undefined;
  return Math.round(Number(t) * 100);
}

/** Basis points as a compact percentage: 250 -> "2.5%", 300 -> "3%", 275 -> "2.75%". */
export function pct(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

export const MAX_FEE_BPS = 1000; // the exporter wizard's ceiling: 10%
export const NOTE_MAX = 280;

export type RequestForm = { amount: string; maxFeePct: string; milestones: string; note: string };
export type RequestErrors = Partial<Record<keyof RequestForm, string>>;

/** Field errors for a financing request; empty when it can be signed. The invoice must cover the amount plus the fee. */
export function validateRequest(f: RequestForm, invoiceValue: bigint): RequestErrors {
  const e: RequestErrors = {};
  const amt = parseUsdg(f.amount);
  const bps = parsePctToBps(f.maxFeePct);
  const n = Number(f.milestones);
  if (bps === undefined || bps > MAX_FEE_BPS) e.maxFeePct = "Use a fee from 0% to 10%, up to two decimals.";
  if (!Number.isInteger(n) || n < 1 || n > 8 || f.milestones.trim() === "") e.milestones = "Use 1 to 8 milestones.";
  if (amt === undefined || amt <= 0n) e.amount = "Enter how much capital to raise, in USDG.";
  else {
    const fee = (amt * BigInt(bps ?? 0)) / 10_000n;
    if (amt + fee > invoiceValue) e.amount = "The invoice must cover the amount plus the maximum fee.";
    else if (Number.isInteger(n) && n >= 1 && amt < BigInt(n)) e.amount = "The amount is too small to split into that many milestones.";
  }
  if (f.note.length > NOTE_MAX) e.note = `Keep the note under ${NOTE_MAX} characters.`;
  return e;
}

/** Why an offer at this fee cannot be made, or null when it can. */
export function validateOffer(feePct: string, maxFeeBps: number): string | null {
  const bps = parsePctToBps(feePct);
  if (bps === undefined) return "Enter the fee as a percentage, up to two decimals.";
  if (bps > maxFeeBps) return `The exporter accepts at most ${pct(maxFeeBps)}.`;
  return null;
}

/** Offers cheapest first; equal fees keep the earlier offer ahead. */
export function rankOffers(offers: Offer[]): Offer[] {
  return [...offers].sort((a, b) => a.feeBps - b.feeBps || Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export const acceptedOffer = (r: Pick<MarketRequest, "offers">) => r.offers.find((o) => o.accepted);

export type MarketSort = "newest" | "amount" | "fee";

export function sortRequests(rs: MarketRequest[], sort: MarketSort): MarketRequest[] {
  const by: Record<MarketSort, (a: MarketRequest, b: MarketRequest) => number> = {
    newest: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    amount: (a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : BigInt(b.amount) < BigInt(a.amount) ? -1 : 0),
    fee: (a, b) => b.maxFeeBps - a.maxFeeBps,
  };
  return [...rs].sort(by[sort]);
}

/** "just now", "12 min", "3 h", "4 d" since an RFC 3339 time. */
export function age(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "–";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

const bands: { name: string; min: number; max: number }[] = [
  { name: "Pharma", min: 200, max: 800 },
  { name: "Frozen", min: -2500, max: -1500 },
  { name: "Chilled produce", min: 0, max: 400 },
  { name: "Bananas", min: 1300, max: 1500 },
  { name: "Ambient electronics", min: 500, max: 3500 },
];

const deg = (x100: number) => {
  const v = x100 / 100;
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace("-", "−");
};

/** The cargo band a policy fixes, named after the matching template when there is one: "Pharma · 2 to 8 °C". */
export function cargoBand(p: { minTempX100?: number; maxTempX100?: number }): { name: string | null; range: string } {
  if (p.minTempX100 === undefined || p.maxTempX100 === undefined) return { name: null, range: "Band not set" };
  const name = bands.find((b) => b.min === p.minTempX100 && b.max === p.maxTempX100)?.name ?? null;
  return { name, range: `${deg(p.minTempX100)} to ${deg(p.maxTempX100)} °C` };
}

/** How much of the invoice the request asks for, in whole percent. */
export function advanceRate(amountBase: string, invoice: string): number {
  const inv = BigInt(invoice || "0");
  return inv === 0n ? 0 : Number((BigInt(amountBase || "0") * 100n) / inv);
}

export type Role = "exporter" | "buyer" | "financier" | "viewer";

/** The connected wallet's role on a request: exporter, buyer, any other wallet (a would-be financier) or nobody. */
export function roleOn(r: Pick<MarketRequest, "exporter" | "buyer">, address: string | undefined): Role {
  if (!address) return "viewer";
  const a = address.toLowerCase();
  if (a === r.exporter.toLowerCase()) return "exporter";
  if (a === r.buyer.toLowerCase()) return "buyer";
  return "financier";
}

/** 404, 405, 501 and 503 mean the endpoint is not deployed (or not configured) yet: show that, not an error. */
export function isUnavailable(err: unknown): boolean {
  return err instanceof ApiError && [404, 405, 501, 503].includes(err.status);
}

// ---------------------------------------------------------------------------------------------------- hooks

const fetchStatus = (status: RequestStatus) => apiGet(`/v1/requests?status=${status}`, RequestList).then((r) => r.requests);

/** Every request in every state (one query per state, so the tabs have counts and a detail page finds any request). */
export function useMarket() {
  const qs = useQueries({
    queries: REQUEST_STATUSES.map((status) => ({
      queryKey: ["requests", status],
      queryFn: () => fetchStatus(status),
      refetchInterval: 20_000,
      retry: (n: number, e: unknown) => !isUnavailable(e) && n < 1,
    })),
  });
  const byStatus = Object.fromEntries(REQUEST_STATUSES.map((s, i) => [s, qs[i]?.data ?? []])) as Record<RequestStatus, MarketRequest[]>;
  // a request's status field is authoritative even if a backend filter is looser than asked
  const seen = new Map<string, MarketRequest>();
  for (const s of REQUEST_STATUSES) for (const r of byStatus[s]) seen.set(r.id, r);
  const all = [...seen.values()];
  const error = qs.find((q) => q.error)?.error ?? null;
  return {
    all,
    byStatus: Object.fromEntries(REQUEST_STATUSES.map((s) => [s, all.filter((r) => r.status === s)])) as Record<RequestStatus, MarketRequest[]>,
    isPending: qs.some((q) => q.isPending),
    error,
    unavailable: qs.every((q) => q.isError && isUnavailable(q.error)),
    refetch: () => Promise.all(qs.map((q) => q.refetch())),
  };
}

export const useParty = (address: string | undefined) =>
  useQuery({
    queryKey: ["party", address?.toLowerCase()],
    queryFn: () => apiGet(`/v1/parties/${address!.toLowerCase()}`, Party),
    enabled: !!address && /^0x[0-9a-fA-F]{40}$/.test(address),
    staleTime: 60_000,
    retry: (n, e) => !isUnavailable(e) && n < 1,
  });

/** Live fee guidance for a shipment; null when this backend has no pricing endpoint. */
export const usePricing = (shipmentId: string | undefined) =>
  useQuery({
    queryKey: ["pricing", shipmentId?.toLowerCase()],
    queryFn: async () => {
      try {
        return await apiGet(`/v1/pricing/suggest?shipment=${shipmentId!.toLowerCase()}`, Pricing);
      } catch (e) {
        if (isUnavailable(e)) return null;
        throw e;
      }
    },
    enabled: !!shipmentId && /^0x[0-9a-fA-F]{64}$/.test(shipmentId),
    staleTime: 60_000,
    retry: (n, e) => !isUnavailable(e) && n < 1,
  });

/** Plain words for a pricing factor id. */
export const PRICING_FACTOR: Record<string, string> = {
  base: "Base rate",
  grade: "Exporter track record",
  excursion: "Route temperature excursions",
  conflict: "Sensor disagreement on the route",
  cargo: "Cargo band",
  cover: "Default cover",
  tenor: "Voyage length",
  spread: "Uncertainty",
};

export const useConfigExtras = () =>
  useQuery({ queryKey: ["config", "extras"], queryFn: () => apiGet("/v1/config", ConfigExtras), staleTime: 5 * 60_000 });

// ---------------------------------------------------------------------------------------------------- writes

export const postRequest = (body: { shipmentId: string; amount: string; maxFeeBps: number; milestoneCount: number; note: string; issuedAt: number; signature: string }) =>
  apiPost("/v1/requests", body, Created);

export const postOffer = (rid: string, body: { feeBps: number; issuedAt: number; signature: string }) => apiPost(`/v1/requests/${rid}/offers`, body, Created);

export const postAccept = (rid: string, body: { offerId: string; issuedAt: number; signature: string }) => apiPost(`/v1/requests/${rid}/accept`, body, Created);

export const postClose = (rid: string, body: { issuedAt: number; signature: string }) => apiPost(`/v1/requests/${rid}/close`, body, Created);

export const postGas = (body: { address: string; issuedAt: number; signature: string }) => apiPost("/v1/gas", body, GasResult);

/** A failed marketplace write in words. */
export function writeError(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  if (err.code === "replayed") return "That signature was already used. Try again to sign a fresh one.";
  if (isUnavailable(err)) return "The marketplace is not available on this backend yet.";
  return err.message || fallback;
}
