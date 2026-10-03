// A typed client for the CargoFlow REST API. Reads need no credentials. Writes that a party authorizes take a
// `signMessage(message) => Promise<Hex>` callback (EIP-191 personal_sign), so any wallet works: viem's
// walletClient.signMessage, wagmi's signMessageAsync, ethers' signer.signMessage, a hardware or contract wallet.
// The SDK builds the exact message (see ../messages.ts), asks for the signature and sends both; it never sees a key.
import { createPublicClient, http, type Chain, type Hex, type PublicClient } from "viem";
import type { z } from "zod";
import { DEFAULT_API_URL, robinhoodTestnet } from "../chains.js";
import { nowSec as defaultNow } from "../encoding.js";
import { CargoFlowApiError } from "../errors.js";
import {
  alertsMessage, alertsOffMessage, acceptMessage, closeRequestMessage, deviceMessage, documentMessage, gasMessage, notificationsReadMessage,
  offerMessage, recoveryMessage, requestMessage, vesselMessage, type AlertChannel,
} from "../messages.js";
import * as S from "./schemas.js";

/** Signs a plain-text message with EIP-191 personal_sign and returns the 65-byte signature as hex. */
export type SignMessage = (message: string) => Promise<Hex>;

export interface ClientOptions {
  /** API base URL; default the live deployment */
  apiUrl?: string;
  /** chain for on-chain reads; default Robinhood Chain Testnet */
  chain?: Chain;
  /** RPC URL for on-chain reads; default the chain's public RPC */
  rpcUrl?: string;
  /** custom fetch (tests, proxies); default globalThis.fetch */
  fetch?: typeof fetch;
  /** extra headers on every request */
  headers?: Record<string, string>;
  /** per-request timeout; default 30 s (the free-tier API can take a while to wake up) */
  timeoutMs?: number;
  /** clock for `issuedAt`, unix seconds; default Date.now */
  now?: () => number;
}

export interface ShipmentFilter {
  /** an address that is a party (exporter, financier, buyer) */
  party?: string;
  /** exact external reference, case-insensitive */
  ref?: string;
  /** one or more statuses: ACTIVE, PAUSED, DISPUTED, DELIVERED, SETTLED, DEFAULTED, ... */
  status?: string | string[];
  /** up to 200 */
  limit?: number;
  offset?: number;
}

export interface MirrorInput {
  shipmentId: string;
  externalRef: string;
  route: S.RoutePoint[];
  /** display names for milestone places, by index */
  placeLabels?: string[];
}

/** Options common to every wallet-signed write. */
export interface SignedOptions {
  /** unix seconds; default now. Must be within 10 minutes of the server clock. */
  issuedAt?: number;
}

type RequestOptions = { body?: unknown; raw?: string; headers?: Record<string, string>; accept?: number[]; query?: Record<string, string | number | undefined> };

/** A gateway's device attestation: an X.509 chain for a secure element's P-256 key, or a WebAuthn registration. */
export type GatewayAttestation =
  | { format: "x509"; chain: string[] }
  | { format: "webauthn"; attestationObject: string; clientDataJSON: string };

export interface GatewayRegistration {
  label?: string;
  /** base64url: a 32-byte Ed25519 key; for p256 and webauthn a SEC1 P-256 point or DER SubjectPublicKeyInfo */
  publicKey: string;
  sensorIds: string[];
  /** default "ed25519"; any other type is signed with a `key type:` line */
  keyType?: "ed25519" | "p256" | "webauthn";
  attestation?: GatewayAttestation;
}

const SHIPMENT_ID = /^0x[0-9a-fA-F]{64}$/;
const BYTES32 = SHIPMENT_ID;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function checkId(id: string): string {
  if (!SHIPMENT_ID.test(id)) throw new CargoFlowApiError(0, "invalid_request", "A shipment id is 0x followed by 64 hex characters.");
  return id.toLowerCase();
}
function checkAddress(a: string): string {
  if (!ADDRESS.test(a)) throw new CargoFlowApiError(0, "invalid_request", "An address is 0x followed by 40 hex characters.");
  return a.toLowerCase();
}

export function createClient(opts: ClientOptions = {}) {
  const apiUrl = (opts.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const now = opts.now ?? defaultNow;
  const chain = opts.chain ?? robinhoodTestnet;
  let publicClient: PublicClient | undefined;

  async function request<T extends z.ZodTypeAny>(method: string, path: string, schema: T, ro: RequestOptions = {}): Promise<z.infer<T>> {
    const qs = ro.query
      ? Object.entries(ro.query)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&")
      : "";
    const url = `${apiUrl}${path}${qs ? `?${qs}` : ""}`;
    const body = ro.raw ?? (ro.body === undefined ? undefined : JSON.stringify(ro.body));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...opts.headers, ...ro.headers },
        body,
        signal: ctrl.signal,
      });
    } catch (e) {
      const timedOut = ctrl.signal.aborted;
      throw new CargoFlowApiError(
        0,
        timedOut ? "timeout" : "unreachable",
        timedOut ? `The CargoFlow API did not answer within ${Math.round(timeoutMs / 1000)} s (${path}).` : `The CargoFlow API at ${apiUrl} could not be reached.`,
        path,
        timedOut ? undefined : String(e),
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok && !(ro.accept ?? []).includes(res.status)) {
      const e = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
      const fallback = res.status === 404 ? `Not found: ${path} (this deployment may not offer it).` : `Request failed with status ${res.status} (${path}).`;
      throw new CargoFlowApiError(res.status, e?.code ?? "http_error", e?.message ?? fallback, path);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new CargoFlowApiError(res.status, "bad_response", `Unexpected response from ${path}.`, path, parsed.error.issues);
    return parsed.data;
  }

  const get = <T extends z.ZodTypeAny>(path: string, schema: T, query?: RequestOptions["query"]) => request("GET", path, schema, { query });
  const post = <T extends z.ZodTypeAny>(path: string, body: unknown, schema: T) => request("POST", path, schema, { body });

  /** Signs `build(issuedAt)` and returns `{ issuedAt, signature }` for the request body. */
  async function sign(signMessage: SignMessage, build: (issued: number) => string, o?: SignedOptions) {
    const issuedAt = o?.issuedAt ?? now();
    const signature = await signMessage(build(issuedAt));
    return { issuedAt, signature };
  }

  const shipments = {
    list: (f: ShipmentFilter = {}) =>
      get("/v1/shipments", S.ShipmentList, {
        party: f.party?.toLowerCase(),
        ref: f.ref,
        status: Array.isArray(f.status) ? f.status.join(",") : f.status,
        limit: f.limit,
        offset: f.offset,
      }),
    /** The combined view: shipment, milestones, facility (on-chain), latest evidence, and cover on v2. */
    get: async (id: string) => get(`/v1/shipments/${checkId(id)}`, S.ShipmentView),
    epochs: async (id: string) => get(`/v1/shipments/${checkId(id)}/epochs`, S.EpochList),
    track: async (id: string) => get(`/v1/shipments/${checkId(id)}/track`, S.Track),
    telemetry: async (id: string) => get(`/v1/shipments/${checkId(id)}/telemetry`, S.TelemetrySummary),
    audit: async (id: string) => get(`/v1/shipments/${checkId(id)}/audit`, S.AuditList),
    explanation: async (id: string) => get(`/v1/shipments/${checkId(id)}/explanation`, S.Explanation),
    /** v2 default cover; a 404 on a v1 deployment */
    cover: async (id: string) => get(`/v1/shipments/${checkId(id)}/cover`, S.CoverState),
    documents: async (id: string) => get(`/v1/shipments/${checkId(id)}/documents`, S.DocumentList),
    sources: async (id: string) => get(`/v1/shipments/${checkId(id)}/sources`, S.GatewayList),
    /** The shipment as a GS1 EPCIS 2.0 JSON-LD document. */
    epcis: async (id: string) => get(`/v1/shipments/${checkId(id)}/epcis`, S.EpcisDocument),
    subscriptions: async (id: string, address: string) => get(`/v1/shipments/${checkId(id)}/subscriptions`, S.SubscriptionList, { address: checkAddress(address) }),
    /** The named vessel, or null when none is named. */
    vessel: async (id: string) => {
      try {
        return await get(`/v1/shipments/${checkId(id)}/vessel`, S.Vessel);
      } catch (e) {
        if (e instanceof CargoFlowApiError && e.status === 404 && e.code === "not_found") return null;
        throw e;
      }
    },

    /** Mirror a shipment that exists on chain (public, 30/min per client; nothing the chain does not confirm is stored). */
    mirror: async (input: MirrorInput) =>
      post("/v1/shipments/mirror", { shipmentId: checkId(input.shipmentId), externalRef: input.externalRef, route: input.route, placeLabels: input.placeLabels }, S.Shipment),

    /** A party attests a document by its hashes (the file is never uploaded). Hash with `hashDocument`. */
    attestDocument: async (
      id: string,
      doc: { kind: string; name: string; sizeBytes: number; sha256: string; keccak256: string },
      signMessage: SignMessage,
      o?: SignedOptions,
    ) => {
      const sid = checkId(id);
      const s = await sign(signMessage, (t) => documentMessage(sid, doc.kind, doc.sha256, t), o);
      return post(`/v1/shipments/${sid}/documents`, { ...doc, sha256: doc.sha256.toLowerCase(), keccak256: doc.keccak256.toLowerCase(), ...s }, S.AttestedDocument);
    },

    /** Subscribe to alerts by webhook, Telegram (target "") or email. */
    subscribe: async (id: string, sub: { channel: AlertChannel; target: string; events?: string[] }, signMessage: SignMessage, o?: SignedOptions) => {
      const sid = checkId(id);
      const s = await sign(signMessage, (t) => alertsMessage(sid, sub.channel, sub.target, t), o);
      return post(`/v1/shipments/${sid}/subscriptions`, { channel: sub.channel, target: sub.target, events: sub.events ?? [], ...s }, S.Subscription);
    },

    unsubscribe: async (id: string, subscriptionId: string, signMessage: SignMessage, o?: SignedOptions) => {
      const sid = checkId(id);
      const s = await sign(signMessage, (t) => alertsOffMessage(subscriptionId, t), o);
      return request("DELETE", `/v1/shipments/${sid}/subscriptions/${encodeURIComponent(subscriptionId)}`, S.Deleted, { body: s });
    },

    /** The exporter names the vessel by MMSI. */
    setVessel: async (id: string, v: { mmsi: string; name?: string }, signMessage: SignMessage, o?: SignedOptions) => {
      const sid = checkId(id);
      const s = await sign(signMessage, (t) => vesselMessage(sid, v.mmsi, t), o);
      return post(`/v1/shipments/${sid}/vessel`, { mmsi: v.mmsi, name: v.name ?? "", ...s }, S.Created);
    },

    /**
     * The exporter registers an evidence gateway (gateway.newGatewayKey, gateway.newP256GatewayKey, or a passkey). On
     * v3 the response carries `deviceTx`, the DeviceRegistry registration.
     */
    registerGateway: async (id: string, g: GatewayRegistration, signMessage: SignMessage, o?: SignedOptions) => {
      const sid = checkId(id);
      const keyType = g.keyType ?? "ed25519";
      const s = await sign(signMessage, (t) => deviceMessage(sid, g.publicKey, keyType, g.sensorIds, t), o);
      return post(
        `/v1/shipments/${sid}/sources`,
        {
          label: g.label ?? "", publicKey: g.publicKey, sensorIds: g.sensorIds,
          ...(keyType === "ed25519" ? {} : { keyType }), ...(g.attestation ? { attestation: g.attestation } : {}), ...s,
        },
        S.GatewaySource,
      );
    },

    /**
     * The exporter asks for a ZK recovery of a paused facility, bound to `submitter` (who must be the signer). Returns
     * the proof; send it with contracts.prepareResumeWithProof. 3 per minute per shipment.
     */
    prepareRecovery: async (id: string, r: { sensorId: string; submitter: string }, signMessage: SignMessage, o?: SignedOptions) => {
      const sid = checkId(id);
      const submitter = checkAddress(r.submitter);
      const s = await sign(signMessage, (t) => recoveryMessage(sid, r.sensorId, submitter, t), o);
      return post(`/v1/shipments/${sid}/recovery`, { sensorId: r.sensorId, submitter, ...s }, S.RecoveryProof);
    },

    /** The same recovery request with a signature produced elsewhere (the message is recoveryMessage(...issuedAt)). */
    prepareRecoveryWithSignature: async (id: string, r: { sensorId: string; submitter: string; issuedAt: number; signature: string }) =>
      post(`/v1/shipments/${checkId(id)}/recovery`, { sensorId: r.sensorId, submitter: checkAddress(r.submitter), issuedAt: r.issuedAt, signature: r.signature }, S.RecoveryProof),
  };

  const market = {
    list: (f: { status?: S.RequestStatus; exporter?: string } = {}) => get("/v1/requests", S.RequestList, { status: f.status, exporter: f.exporter?.toLowerCase() }),

    /** The exporter posts a financing request (amount in USDG base units). */
    createRequest: async (
      r: { shipmentId: string; amount: bigint | string; maxFeeBps: number; milestoneCount: number; note?: string },
      signMessage: SignMessage,
      o?: SignedOptions,
    ) => {
      const sid = checkId(r.shipmentId);
      const amount = String(r.amount);
      const s = await sign(signMessage, (t) => requestMessage(sid, amount, r.maxFeeBps, r.milestoneCount, t), o);
      return post("/v1/requests", { shipmentId: sid, amount, maxFeeBps: r.maxFeeBps, milestoneCount: r.milestoneCount, note: r.note ?? "", ...s }, S.Created);
    },

    /** A financier offers a fee. `address` names a contract wallet whose signature verifies through EIP-1271. */
    offer: async (requestId: string, r: { feeBps: number; address?: string }, signMessage: SignMessage, o?: SignedOptions) => {
      const s = await sign(signMessage, (t) => offerMessage(requestId, r.feeBps, t), o);
      return post(`/v1/requests/${encodeURIComponent(requestId)}/offers`, { feeBps: r.feeBps, ...(r.address ? { address: r.address.toLowerCase() } : {}), ...s }, S.Created);
    },

    accept: async (requestId: string, offerId: string, signMessage: SignMessage, o?: SignedOptions) => {
      const s = await sign(signMessage, (t) => acceptMessage(requestId, offerId, t), o);
      return post(`/v1/requests/${encodeURIComponent(requestId)}/accept`, { offerId, ...s }, S.Created);
    },

    close: async (requestId: string, signMessage: SignMessage, o?: SignedOptions) => {
      const s = await sign(signMessage, (t) => closeRequestMessage(requestId, t), o);
      return post(`/v1/requests/${encodeURIComponent(requestId)}/close`, s, S.Created);
    },
  };

  const notifications = {
    /** A wallet's in-app notifications, newest first, with the unread count. */
    list: async (address: string, f: { unread?: boolean; limit?: number } = {}) =>
      get("/v1/notifications", S.NotificationList, { address: checkAddress(address), unread: f.unread ? "true" : undefined, limit: f.limit }),
    /** The notified wallet marks `ids` (at most 100), or all of its notifications, read. */
    read: async (address: string, ids: readonly string[] | "all", signMessage: SignMessage, o?: SignedOptions) => {
      const a = checkAddress(address);
      const list = ids === "all" ? [] : ids.map((i) => i.trim().toLowerCase());
      const s = await sign(signMessage, (t) => notificationsReadMessage(a, list, t), o);
      return post("/v1/notifications/read", { address: a, ...(list.length ? { ids: list } : {}), ...s }, S.NotificationsReadResult);
    },
  };

  const ebl = {
    /** Electronic bills of lading (contracts v3 EBLRegistry), optionally only those `holder` holds. 404 without a registry. */
    list: (f: { holder?: string } = {}) => get("/v1/ebl", S.BillList, { holder: f.holder ? checkAddress(f.holder) : undefined }),
    get: async (tokenId: bigint | number | string) => {
      const t = String(tokenId);
      if (!/^[0-9]+$/.test(t)) throw new CargoFlowApiError(0, "invalid_request", "A bill's token id is a decimal number.");
      return get(`/v1/ebl/${t}`, S.Bill);
    },
  };

  return {
    apiUrl,
    chain,
    /** The OpenAPI 3.1 document describing every endpoint. */
    openapi: () => get("/v1/openapi.json", S.OpenApiDocument),
    health: () => request("GET", "/v1/health", S.Health, { accept: [503] }),
    config: () => get("/v1/config", S.Config),
    stats: () => get("/v1/stats", S.Stats),
    shipments,
    parties: { get: async (address: string) => get(`/v1/parties/${checkAddress(address)}`, S.Party) },
    market,
    notifications,
    /** A device key (0x + keccak256 of the stored public key; gateway.deviceKeyHash): class, attestation, on-chain record. */
    devices: {
      get: async (keyHash: string) => {
        if (!BYTES32.test(keyHash)) throw new CargoFlowApiError(0, "invalid_request", "A device key hash is 0x followed by 64 hex characters.");
        return get(`/v1/devices/${keyHash.toLowerCase()}`, S.Device);
      },
    },
    ebl,
    /** Fee guidance for a shipment: a low / mid / high band in bps with the reasons behind it. */
    pricing: { suggest: async (shipmentId: string) => get("/v1/pricing/suggest", S.PricingSuggestion, { shipment: checkId(shipmentId) }) },
    /** Ask the gas drip for a little native currency (once per address per 24 h). */
    requestGas: async (address: string, signMessage: SignMessage, o?: SignedOptions) => {
      const a = checkAddress(address);
      const s = await sign(signMessage, (t) => gasMessage(a, t), o);
      return post("/v1/gas", { address: a, ...s }, S.GasResult);
    },
    /** A viem public client for on-chain reads (created on first use). */
    publicClient: (): PublicClient => (publicClient ??= createPublicClient({ chain, transport: http(opts.rpcUrl) }) as PublicClient),
    /** Low-level access for endpoints the client does not wrap yet. */
    request,
  };
}

export type CargoFlowClient = ReturnType<typeof createClient>;
