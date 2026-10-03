// Registering a gateway key on its shipment. The backend accepts a key only with the shipment exporter's wallet
// signature (EIP-191 personal_sign) over sourceAuthorizationMessage, issued within the last 10 minutes.
import { DEFAULT_API_URL, USER_AGENT } from "./sender.js";
import { sourceAuthorizationMessage, type KeyFile } from "./signing.js";

export const DEFAULT_SITE_URL = "https://cargoflow.adoranto737.workers.dev";

export interface RegisteredSource {
  id: string;
  shipmentId: string;
  label: string;
  publicKey: string;
  sensorIds: string[];
  createdAt: string;
}

export function shipmentPageUrl(shipmentId: string, siteUrl = DEFAULT_SITE_URL): string {
  return `${siteUrl.replace(/\/+$/, "")}/track/${shipmentId.toLowerCase()}`;
}

export function registrationMessage(key: KeyFile, issuedAt: number): string {
  return sourceAuthorizationMessage(key.shipmentId, key.publicKey, key.sensorIds, issuedAt);
}

async function api<T>(apiUrl: string, path: string, init?: { method: string; body: string }): Promise<{ status: number; body: T | { error?: { message?: string } } }> {
  const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/${path}`, {
    method: init?.method ?? "GET",
    headers: { "User-Agent": USER_AGENT, ...(init ? { "Content-Type": "application/json" } : {}) },
    body: init?.body,
  });
  const text = await res.text();
  let body: unknown = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: { message: text.slice(0, 200) } };
  }
  return { status: res.status, body: body as T };
}

/** The shipment's registered gateways, to tell whether this key is one of them. */
export async function registeredSources(shipmentId: string, apiUrl = DEFAULT_API_URL): Promise<RegisteredSource[]> {
  const r = await api<{ sources: RegisteredSource[] }>(apiUrl, `v1/shipments/${shipmentId.toLowerCase()}/sources`);
  if (r.status !== 200) throw new Error((r.body as { error?: { message?: string } }).error?.message ?? `HTTP ${r.status}`);
  return (r.body as { sources: RegisteredSource[] }).sources ?? [];
}

export async function registerKey(key: KeyFile, issuedAt: number, signature: string, apiUrl = DEFAULT_API_URL): Promise<RegisteredSource> {
  const r = await api<RegisteredSource>(apiUrl, `v1/shipments/${key.shipmentId}/sources`, {
    method: "POST",
    body: JSON.stringify({ label: key.label, publicKey: key.publicKey, sensorIds: key.sensorIds, issuedAt, signature: signature.trim() }),
  });
  if (r.status !== 200 && r.status !== 201) throw new Error(`registration refused (${r.status}): ${(r.body as { error?: { message?: string } }).error?.message ?? "unknown error"}`);
  return r.body as RegisteredSource;
}
