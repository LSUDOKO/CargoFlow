import { addresses, createClient, DEFAULT_API_URL, DEFAULT_APP_URL, type CargoFlowAddresses, type CargoFlowClient, type Config } from "@cargoflow/sdk";

export interface ServerOptions {
  /** CargoFlow API; default the live deployment (CARGOFLOW_API_URL) */
  apiUrl?: string;
  /** web app used for "open to sign" links (CARGOFLOW_APP_URL) */
  appUrl?: string;
  /** path to a gateway key file; enables submit_readings_csv (CARGOFLOW_GATEWAY_KEY_FILE) */
  gatewayKeyFile?: string;
  /** RPC for on-chain reads (CARGOFLOW_RPC_URL); default the chain's public RPC */
  rpcUrl?: string;
  /** custom fetch, for tests */
  fetch?: typeof fetch;
  /** clock, unix seconds, for tests */
  now?: () => number;
  /** per-request API timeout in ms (SDK default 30 s; the hosted server uses 25 s) */
  timeoutMs?: number;
  /**
   * Hosted (remote) mode: no local file system. verify_document takes hashes or base64 content instead of a path,
   * and the gateway tool is never registered.
   */
  hosted?: boolean;
}

/** Reads a local file for verify_document (stdio/Node only; absent in hosted mode). */
export type LocalFileReader = (path: string, maxBytes: number) => Promise<{ name: string; bytes: Uint8Array }>;

export interface Ctx {
  client: CargoFlowClient;
  apiUrl: string;
  appUrl: string;
  gatewayKeyFile?: string;
  hosted: boolean;
  /** local file access for verify_document (path mode); undefined in hosted mode */
  readLocalFile?: LocalFileReader;
  now: () => number;
  /** /v1/config, cached for 5 minutes */
  config(): Promise<Config>;
  addresses(): Promise<CargoFlowAddresses>;
  shipmentUrl(id: string): string;
  portalUrl(role: "exporter" | "financier" | "buyer" | "arbiter" | "market"): string;
}

export function makeContext(o: ServerOptions = {}, readLocalFile?: LocalFileReader): Ctx {
  const apiUrl = (o.apiUrl || DEFAULT_API_URL).replace(/\/+$/, "");
  const appUrl = (o.appUrl || DEFAULT_APP_URL).replace(/\/+$/, "");
  const client = createClient({ apiUrl, fetch: o.fetch, rpcUrl: o.rpcUrl, now: o.now, timeoutMs: o.timeoutMs });
  let cached: { at: number; v: Promise<Config> } | undefined;
  const config = () => {
    if (!cached || Date.now() - cached.at > 5 * 60_000) {
      cached = { at: Date.now(), v: client.config() };
      cached.v.catch(() => (cached = undefined));
    }
    return cached.v;
  };
  return {
    client,
    apiUrl,
    appUrl,
    gatewayKeyFile: o.hosted ? undefined : o.gatewayKeyFile || undefined,
    hosted: !!o.hosted,
    readLocalFile: o.hosted ? undefined : readLocalFile,
    now: o.now ?? (() => Math.floor(Date.now() / 1000)),
    config,
    addresses: async () => addresses(await config()),
    shipmentUrl: (id) => `${appUrl}/track/${id.toLowerCase()}`,
    portalUrl: (role) => `${appUrl}/${role}`,
  };
}
