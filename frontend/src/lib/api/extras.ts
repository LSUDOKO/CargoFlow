"use client";

// Schemas, hooks and signed-message builders for the dashboard's newer endpoints (documents, alerts, vessel,
// explanation). The message strings must stay byte-identical to the backend's (lower-cased shipment ids and
// addresses, lines joined by "\n", no trailing newline); extras.test.ts pins each one.
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { API_URL, ApiError, apiGet } from "./client";
import type { ShipmentView } from "./schemas";

const list = <T extends z.ZodTypeAny>(item: T) => z.array(item).nullish().transform((v) => v ?? []);

/* ---------- signed messages ---------- */

export const DOCUMENT_KINDS = ["invoice", "bill_of_lading", "packing_list", "certificate", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const ALERT_EVENTS = ["PAUSED", "RELEASED", "RESUMED", "DISPUTED", "DELIVERED", "SETTLED", "DEFAULTED"] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];
export type AlertChannel = "webhook" | "telegram" | "email";

export const documentMessage = (shipmentId: string, kind: DocumentKind, sha256: string, issued: number) =>
  `CargoFlow document\nshipment: ${shipmentId.toLowerCase()}\nkind: ${kind}\nsha256: ${sha256.toLowerCase()}\nissued: ${issued}`;

export const alertsMessage = (shipmentId: string, channel: AlertChannel, target: string, issued: number) =>
  `CargoFlow alerts\nshipment: ${shipmentId.toLowerCase()}\nchannel: ${channel}\ntarget: ${target}\nissued: ${issued}`;

export const alertsOffMessage = (subscriptionId: string, issued: number) => `CargoFlow alerts off\nsubscription: ${subscriptionId}\nissued: ${issued}`;

export const vesselMessage = (shipmentId: string, mmsi: string, issued: number) =>
  `CargoFlow vessel\nshipment: ${shipmentId.toLowerCase()}\nmmsi: ${mmsi}\nissued: ${issued}`;

/* ---------- schemas ---------- */

export const AttestedDocument = z.object({
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  sizeBytes: z.number(),
  sha256: z.string(),
  keccak256: z.string(),
  signer: z.string(),
  role: z.string(),
  createdAt: z.string(),
  matchesInvoiceHash: z.boolean().optional().default(false),
});
export type AttestedDocument = z.infer<typeof AttestedDocument>;
export const DocumentList = z.object({ documents: list(AttestedDocument) });

/** The parts of /v1/config this file needs; the base Config schema (schemas.ts) ignores them. */
export const ConfigExtras = z.object({
  alerts: z
    .object({
      webhook: z.boolean().optional().default(true),
      telegram: z.boolean().optional().default(false),
      email: z.boolean().optional().default(false),
      telegramBot: z.string().nullish().transform((v) => v ?? ""),
    })
    .nullish()
    .transform((v) => v ?? null),
  gasDrip: z.boolean().optional().default(false),
  ais: z.boolean().optional().default(false),
});
export type ConfigExtras = z.infer<typeof ConfigExtras>;

export const Subscription = z.object({
  id: z.string(),
  channel: z.string(),
  targetMasked: z.string().nullish().transform((v) => v ?? ""),
  events: list(z.string()),
  active: z.boolean().optional().default(true),
});
export type Subscription = z.infer<typeof Subscription>;
export const SubscriptionList = z.object({ subscriptions: list(Subscription) });

export const SubscriptionCreated = z.object({
  id: z.string(),
  channel: z.string(),
  targetMasked: z.string().nullish().transform((v) => v ?? ""),
  events: list(z.string()),
  createdAt: z.string().optional(),
  secret: z.string().optional(),
  linkUrl: z.string().optional(),
});
export type SubscriptionCreated = z.infer<typeof SubscriptionCreated>;

export const Explanation = z.object({
  status: z.string(),
  headline: z.string(),
  causes: list(z.string()),
  nextSteps: list(z.object({ role: z.string(), action: z.string() })),
  forecast: z
    .object({ sensorId: z.string(), trend: z.string(), minutesToLimit: z.number().nullable().optional().default(null) })
    .nullish()
    .transform((v) => v ?? null),
  source: z.string().optional().default("rules"),
});
export type Explanation = z.infer<typeof Explanation>;

const Fix = z.object({ latE6: z.number(), lonE6: z.number(), timestamp: z.number() });
export const Vessel = z.object({
  mmsi: z.string(),
  name: z.string(),
  live: z.boolean(),
  last: Fix.extend({ sogKnotsX10: z.number().optional().default(0), cogDegX10: z.number().optional().default(0) })
    .nullish()
    .transform((v) => v ?? null),
  track: list(Fix),
  crossCheck: z
    .object({ loggerLatE6: z.number(), loggerLonE6: z.number(), distanceM: z.number(), ageSec: z.number(), agrees: z.boolean(), comparable: z.boolean().optional().default(true) })
    .nullish()
    .transform((v) => v ?? null),
});
export type Vessel = z.infer<typeof Vessel>;

/** For writes whose response body the UI does not need (the follow-up GET is the source of truth). */
export const Accepted = z.unknown();

/* ---------- requests ---------- */

/** True for errors meaning "this deployment does not offer that endpoint or channel" rather than a failure. */
export function isUnavailable(err: unknown): boolean {
  return err instanceof ApiError && [404, 405, 501, 503].includes(err.status);
}

const noRetryWhenUnavailable = (n: number, e: unknown) => !isUnavailable(e) && n < 1;

/** DELETE with a JSON body (client.ts has no delete helper; this mirrors its error handling). */
export async function apiDelete(path: string, body: unknown): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  } catch {
    throw new ApiError(0, "unreachable", "The CargoFlow backend could not be reached.");
  }
  if (res.ok) return;
  let e: { code?: string; message?: string } | undefined;
  try {
    e = ((await res.json()) as { error?: { code?: string; message?: string } }).error;
  } catch {
    /* not JSON */
  }
  throw new ApiError(res.status, e?.code ?? "http_error", e?.message ?? `Request failed with status ${res.status}.`);
}

const valid = (id?: string) => !!id && /^0x[0-9a-fA-F]{64}$/.test(id);

// its own cache key: lib/api/market.ts reads /v1/config under ["config", "extras"] with a schema that drops `alerts`
export const useConfigExtras = () =>
  useQuery({ queryKey: ["config", "dashboard"], queryFn: () => apiGet("/v1/config", ConfigExtras), staleTime: 5 * 60_000 });

export const useDocuments = (id?: string) =>
  useQuery({
    queryKey: ["documents", id],
    queryFn: () => apiGet(`/v1/shipments/${id}/documents`, DocumentList),
    enabled: valid(id),
    retry: noRetryWhenUnavailable,
    refetchInterval: 60_000,
  });

export const useSubscriptions = (id?: string, address?: string) =>
  useQuery({
    queryKey: ["subscriptions", id, address?.toLowerCase()],
    queryFn: () => apiGet(`/v1/shipments/${id}/subscriptions?address=${address!.toLowerCase()}`, SubscriptionList),
    enabled: valid(id) && !!address,
    retry: noRetryWhenUnavailable,
  });

export const useExplanation = (id?: string) =>
  useQuery({
    queryKey: ["explanation", id],
    queryFn: () => apiGet(`/v1/shipments/${id}/explanation`, Explanation),
    enabled: valid(id),
    retry: noRetryWhenUnavailable,
    refetchInterval: 30_000,
  });

/** The registered vessel, or null when none is registered (404). */
export const useVessel = (id?: string) =>
  useQuery({
    queryKey: ["vessel", id],
    queryFn: async () => {
      try {
        return await apiGet(`/v1/shipments/${id}/vessel`, Vessel);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: valid(id),
    retry: noRetryWhenUnavailable,
    refetchInterval: 60_000,
  });

/* ---------- roles ---------- */

export type PartyRole = "exporter" | "financier" | "buyer";

/** The roles `address` holds on a shipment (an address can hold more than one on a test deployment). */
export function rolesOf(view: Pick<ShipmentView, "shipment" | "facility">, address: string | undefined): PartyRole[] {
  if (!address) return [];
  const a = address.toLowerCase();
  const out: PartyRole[] = [];
  if ((view.facility?.exporter ?? view.shipment.exporter).toLowerCase() === a) out.push("exporter");
  const financier = view.facility?.financier || view.shipment.financier;
  if (financier && financier.toLowerCase() === a) out.push("financier");
  if ((view.facility?.buyer ?? view.shipment.buyer).toLowerCase() === a) out.push("buyer");
  return out;
}

export const nowSec = () => Math.floor(Date.now() / 1000);

/* ---------- wording ---------- */

const span = (min: number) => (min < 60 ? `${Math.max(1, Math.round(min))} min` : `${Math.floor(min / 60)} h${Math.round(min % 60) ? ` ${Math.round(min % 60)} min` : ""}`);

/** "probe-1 rising, about 40 min to the limit" */
export function forecastText(f: NonNullable<Explanation["forecast"]>): string {
  const head = `${f.sensorId} ${f.trend}`;
  if (f.minutesToLimit === null || f.trend === "steady") return head;
  if (f.minutesToLimit <= 0) return `${head}, at the limit now`;
  return `${head}, about ${span(f.minutesToLimit)} to the limit`;
}

/** "8 min", "2 h 5 min", "3 d" */
export function ageText(sec: number): string {
  if (sec < 60) return `${Math.max(0, Math.round(sec))} s`;
  if (sec < 86_400) return span(sec / 60);
  return `${Math.round(sec / 86_400)} d`;
}

export const ALERT_EVENT_LABEL: Record<AlertEvent, string> = {
  PAUSED: "Paused",
  RELEASED: "Milestone released",
  RESUMED: "Resumed",
  DISPUTED: "Disputed",
  DELIVERED: "Delivered",
  SETTLED: "Settled",
  DEFAULTED: "Defaulted",
};

/** Validates an alert target before asking for a signature (plain http only on a local chain, as the backend allows). */
export function targetError(channel: AlertChannel, target: string, allowHttp = false): string | null {
  const t = target.trim();
  if (channel === "telegram") return null;
  if (!t) return channel === "email" ? "Enter an email address." : "Enter the URL to receive POST requests.";
  if (channel === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) ? null : "That doesn't look like an email address.";
  try {
    const u = new URL(t);
    return u.protocol === "https:" || (allowHttp && u.protocol === "http:") ? null : "Webhooks must use https.";
  } catch {
    return "That isn't a valid URL.";
  }
}
