// "CargoFlow Demo Wallet": an EIP-1193 provider injected into the page and announced through EIP-6963, one entry per
// demo role. Every request is forwarded to Node through a Playwright binding; signing happens in Node with viem, so
// the page (and therefore the recording) never sees a private key. Transactions are estimated, signed locally and
// sent raw to the testnet RPC. Only transaction hashes are logged.
import fs from "node:fs";
import path from "node:path";
import { viem } from "./deps.mjs";
import { CHAIN_ID, ROLE_LABEL, address, publicClient, walletFor } from "./chain.mjs";
import { RECORDER } from "./deps.mjs";

const TXLOG = path.join(RECORDER, "txlog.jsonl");
export const txHashes = [];
let currentShot = null;
export const setShot = (id) => (currentShot = id);

const ICON =
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0B2545"/><path d="M14 40h36l-5 8H19z" fill="#2EC4B6"/><rect x="20" y="22" width="11" height="14" rx="1.5" fill="#fff"/><rect x="33" y="17" width="11" height="19" rx="1.5" fill="#fff" opacity=".85"/></svg>`,
  ).toString("base64");

/** Simulated confirmation delay so the app's "confirm in your wallet" state is visible (ms). */
export const walletDelay = { ms: 700 };

async function handle(role, method, params) {
  const acct = address(role);
  switch (method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [acct];
    case "eth_chainId":
      return viem.toHex(CHAIN_ID);
    case "net_version":
      return String(CHAIN_ID);
    case "wallet_switchEthereumChain":
    case "wallet_addEthereumChain": {
      const id = Number(params?.[0]?.chainId);
      if (id && id !== CHAIN_ID) throw Object.assign(new Error("Only Robinhood Chain Testnet is available in the demo wallet."), { code: 4902 });
      return null;
    }
    case "wallet_requestPermissions":
    case "wallet_getPermissions":
      return [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [acct] }] }];
    case "wallet_revokePermissions":
      return null;
    case "personal_sign": {
      await new Promise((r) => setTimeout(r, walletDelay.ms));
      const [data, from] = viem.isAddress(params[0]) && !viem.isAddress(params[1]) ? [params[1], params[0]] : params;
      if (from && from.toLowerCase() !== acct.toLowerCase()) throw Object.assign(new Error("Unknown account"), { code: 4100 });
      const message = viem.isHex(data) ? { raw: data } : data;
      return walletFor(role).signMessage({ message });
    }
    case "eth_signTypedData_v4":
    case "eth_signTypedData": {
      await new Promise((r) => setTimeout(r, walletDelay.ms));
      const typed = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
      const { EIP712Domain, ...types } = typed.types;
      return walletFor(role).signTypedData({ domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message });
    }
    case "eth_sendTransaction": {
      await new Promise((r) => setTimeout(r, walletDelay.ms));
      const t = params[0];
      const req = { to: t.to, data: t.data, value: t.value ? BigInt(t.value) : undefined };
      if (t.gas) req.gas = BigInt(t.gas);
      const hash = await walletFor(role).sendTransaction(req);
      const entry = { at: new Date().toISOString(), shot: currentShot, role, to: t.to, selector: t.data?.slice(0, 10), hash };
      txHashes.push(entry);
      fs.appendFileSync(TXLOG, JSON.stringify(entry) + "\n");
      console.log(`  tx ${role} ${entry.selector ?? ""} ${hash}`);
      return hash;
    }
    case "eth_sign":
      throw Object.assign(new Error("eth_sign is not supported"), { code: 4200 });
    case "wallet_getCapabilities":
    case "wallet_sendCalls":
      throw Object.assign(new Error("Method not supported"), { code: 4200 });
    default:
      return publicClient.request({ method, params });
  }
}

/** Install the binding (once per context) and the in-page provider for the given roles. */
export async function installWallet(context, roles) {
  await context.exposeBinding("__cfWalletRpc", async (_src, role, method, params) => {
    try {
      const result = await handle(role, method, params ?? []);
      return { ok: JSON.parse(JSON.stringify(result ?? null, (_k, v) => (typeof v === "bigint" ? viem.toHex(v) : v))) };
    } catch (e) {
      return { error: { code: e.code ?? e.cause?.code ?? 4001, message: (e.shortMessage || e.message || "error").split("\n")[0] } };
    }
  });
  const entries = roles.map((r) => ({ role: r, address: address(r), name: `CargoFlow Demo Wallet · ${ROLE_LABEL[r]}`, rdns: `dev.cargoflow.demo.${r}`, uuid: `6f1c2f3e-0000-4000-8000-${(roles.indexOf(r) + 1).toString().padStart(12, "0")}` }));
  await context.addInitScript(
    ({ entries, icon, chainHex }) => {
      const make = (e) => {
        const listeners = {};
        const provider = {
          isCargoFlowDemo: true,
          request: async ({ method, params }) => {
            // like a real extension: the site sees the account only after the person approved a connection
            const authKey = `__cfdemo_auth_${e.role}`;
            let authed = false;
            try { authed = localStorage.getItem(authKey) === "1"; } catch {}
            if (method === "eth_accounts" && !authed) return [];
            if (method === "wallet_revokePermissions") { try { localStorage.removeItem(authKey); } catch {} return null; }
            const r = await window.__cfWalletRpc(e.role, method, params);
            if (!r.error && (method === "eth_requestAccounts" || method === "wallet_requestPermissions")) { try { localStorage.setItem(authKey, "1"); } catch {} }
            if (r.error) {
              const err = new Error(r.error.message);
              err.code = r.error.code;
              throw err;
            }
            if (method === "eth_requestAccounts") setTimeout(() => (listeners.connect || []).forEach((f) => f({ chainId: chainHex })), 0);
            return r.ok;
          },
          on: (ev, fn) => ((listeners[ev] ||= []).push(fn), provider),
          removeListener: (ev, fn) => ((listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn)), provider),
          off: (ev, fn) => provider.removeListener(ev, fn),
          once: (ev, fn) => provider.on(ev, function w(...a) { provider.removeListener(ev, w); fn(...a); }),
        };
        return Object.freeze({ info: Object.freeze({ uuid: e.uuid, name: e.name, icon, rdns: e.rdns }), provider });
      };
      const details = entries.map(make);
      const announce = () => details.forEach((d) => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: d })));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { entries, icon: ICON, chainHex: viem.toHex(CHAIN_ID) },
  );
}
