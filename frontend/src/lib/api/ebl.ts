// Backend views for contracts v3 (bills of lading, devices). Every endpoint is optional: a backend without it answers
// 404/405/501 and the callers fall back to reading the chain directly, so the pages work before the backend lands.
import { z } from "zod";
import { eblStatus } from "@/lib/ebl";
import { ApiError, apiGet } from "./client";
import { DeviceClass } from "./schemas";

const list = <T extends z.ZodTypeAny>(item: T) => z.array(item).nullish().transform((v) => v ?? []);
/** unix seconds from a number of seconds or an ISO timestamp; 0 when absent */
const time = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "number") return v;
    if (/^\d+$/.test(v)) return Number(v);
    const t = Date.parse(v);
    return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
  });

export const BillMove = z.object({ from: z.string(), to: z.string(), txHash: z.string().nullish().transform((v) => v ?? ""), at: time });
export type BillMove = z.infer<typeof BillMove>;

export const BillView = z.object({
  tokenId: z.union([z.string(), z.number()]).transform((v) => String(v)),
  documentHash: z.string(),
  issuer: z.string(),
  shipper: z.string(),
  consignee: z.string().nullish().transform((v) => v ?? "0x0000000000000000000000000000000000000000"),
  holder: z.string(),
  status: z.union([z.string(), z.number()]).transform((v) => eblStatus(v)),
  issuedAt: time,
  closedAt: time,
  transfers: z.number().nullish().transform((v) => v ?? 0),
  history: list(BillMove),
  boundShipmentId: z.string().nullish().transform((v) => v || null),
});
export type BillView = z.infer<typeof BillView>;
export const BillList = z.object({ bills: list(BillView) });

export const DeviceView = z.object({
  keyHash: z.string(),
  keyType: z.string().optional().default(""),
  deviceClass: DeviceClass,
  label: z.string().optional().default(""),
  attested: z.boolean().optional().default(false),
  onChain: z
    .object({
      registered: z.boolean().optional(),
      active: z.boolean().optional(),
      revoked: z.boolean().optional(),
      deviceClass: DeviceClass.optional(),
      class: DeviceClass.optional(),
      txHash: z.string().optional(),
    })
    .nullish()
    .transform((v) => (v ? { registered: v.registered ?? true, revoked: v.revoked ?? v.active === false, txHash: v.txHash ?? "" } : null)),
});
export type DeviceView = z.infer<typeof DeviceView>;

const optional = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError && [0, 404, 405, 501, 503].includes(e.status)) return null;
    throw e;
  }
};

/** GET /v1/ebl/{tokenId}; null when the backend does not serve bills (or does not know this one). */
export const fetchBill = (tokenId: string) => optional(apiGet(`/v1/ebl/${tokenId}`, BillView));
/** GET /v1/ebl?holder=; null when the backend does not serve bills. */
export const fetchBills = (holder: string) => optional(apiGet(`/v1/ebl?holder=${holder.toLowerCase()}`, BillList));
/** GET /v1/devices/{keyHash}; null when unknown or not served. */
export const fetchDevice = (keyHash: string) => optional(apiGet(`/v1/devices/${keyHash.toLowerCase()}`, DeviceView));
