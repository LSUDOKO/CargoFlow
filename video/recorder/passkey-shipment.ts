// A small live shipment whose buyer is a passkey smart account, driven to "all milestones released" with the
// exporter's and financier's keys (the same steps as frontend/scripts/testnet-lifecycle.ts, healthy legs only), so the
// passkey buyer can confirm delivery and pay in the web app. Keys come from the repo .env at runtime; only addresses
// and transaction hashes are printed.
//   node --experimental-strip-types passkey-shipment.ts <buyer smart-account address>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { controllerAbi, policiesAbi, registryAbi, usdgAbi } from "../../frontend/src/lib/chain/abis.ts";
import { newGatewayKey, signRequest, sourceAuthorizationMessage, sourceIdFor } from "../../frontend/src/lib/gateway.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const req = createRequire(path.join(REPO, "frontend", "package.json"));
const { createPublicClient, createWalletClient, defineChain, http, keccak256, toBytes } = req("viem");
const { privateKeyToAccount } = req("viem/accounts");

const API = "https://cargoflow-api-75ul.onrender.com";
const BUYER = process.argv[2];
if (!/^0x[0-9a-fA-F]{40}$/.test(BUYER ?? "")) throw new Error("usage: passkey-shipment.ts <buyer address>");
const env: Record<string, string> = Object.fromEntries(
  fs.readFileSync(path.join(REPO, ".env"), "utf8").split("\n").map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)).filter((m): m is RegExpMatchArray => !!m).map((m) => [m[1], m[2]!.trim().replace(/^["']|["']$/g, "")]),
);
const key = (n: string) => privateKeyToAccount(env[n]!.startsWith("0x") ? env[n] : `0x${env[n]}`);
const chain = defineChain({ id: 46630, name: "Robinhood Chain Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } });
const pub = createPublicClient({ chain, transport: http(undefined, { retryCount: 3 }) });
const wallet = (n: string) => createWalletClient({ account: key(n), chain, transport: http(undefined, { retryCount: 3 }) });
const exporter = wallet("EXPORTER_KEY"), financier = wallet("FINANCIER_KEY");
const TXLOG = path.join(HERE, "txlog.jsonl");
const STATE = path.join(HERE, "tmp", "passkey-shipment.json");

async function api<T>(method: string, p: string, body?: unknown, headers: Record<string, string> = {}, raw?: string): Promise<T> {
  const res = await fetch(API + p, { method, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), headers: { "Content-Type": "application/json", ...headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${text}`);
  return JSON.parse(text) as T;
}
async function tx(label: string, w: any, role: string, address: string, abi: readonly unknown[], functionName: string, args: readonly unknown[]) {
  const hash = await w.writeContract({ address, abi, functionName, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`  ${label}: ${hash}`);
  fs.appendFileSync(TXLOG, JSON.stringify({ at: new Date().toISOString(), shot: "D8-passkey-setup", role, what: label, hash }) + "\n");
  return hash;
}

// policy and milestones exactly as the wizard builds them by default (frontend/src/lib/exporter.ts)
const policy = { minTempX100: 200, maxTempX100: 800, maxEvidenceAgeSec: 1800, maxRouteDeviationM: 25000, minEvidenceScore: 75, maxConflictBps: 3000, maxRiskBps: 3500, requiresZK: false, maxHumidityX100: 8500, maxShockX100: 300 };
const route = [{ latE6: 18_950_000, lonE6: 72_950_000 }, { latE6: 1_264_000, lonE6: 103_820_000 }];
const routeCommitment = keccak256(toBytes(JSON.stringify(route)));
const milestones = (total: bigint, n: number, ref: string) => {
  const each = total / BigInt(n);
  return Array.from({ length: n }, (_, i) => ({ allocation: i === n - 1 ? total - each * BigInt(n - 1) : each, evidenceThreshold: 75, checkpointCommitment: keccak256(toBytes(`${ref}:checkpoint:${i + 1}`)), latE6: 0, lonE6: 0, radiusM: 0 }));
};

const cfg = await api<{ contracts: Record<string, string> }>("GET", "/v1/config");
const c = cfg.contracts;
const total = 20_000_000n, invoice = 30_000_000n;

// a free reference in the demo's series
let ref = "", id = "";
for (let n = 401; n < 600; n++) {
  const r = `CF-SG-VAX-0${n}`;
  const sid = (await pub.readContract({ address: c.shipmentRegistry, abi: registryAbi, functionName: "shipmentIdFor", args: [exporter.account.address, keccak256(toBytes(r))] })) as string;
  const s = (await pub.readContract({ address: c.shipmentRegistry, abi: registryAbi, functionName: "getShipment", args: [sid] }).catch(() => null)) as { exists?: boolean } | null;
  if (!s?.exists) { ref = r; id = sid; break; }
}
console.log(`shipment ${ref} ${id} buyer ${BUYER}`);
fs.mkdirSync(path.dirname(STATE), { recursive: true });
fs.writeFileSync(STATE, JSON.stringify({ ref, shipmentId: id, buyer: BUYER }, null, 2));

const commitment = await pub.readContract({ address: c.policyEngine, abi: policiesAbi, functionName: "hashPolicy", args: [policy] });
await tx("register shipment", exporter, "exporter", c.shipmentRegistry, registryAbi, "registerShipment", [keccak256(toBytes(ref)), BUYER, keccak256(toBytes(`invoice:${ref}:${invoice}`)), routeCommitment, commitment, invoice]);
await tx("set policy", exporter, "exporter", c.policyEngine, policiesAbi, "setPolicy", [id, policy]);
await tx("create facility", exporter, "exporter", c.financingController, controllerAbi, "createFacility", [id, financier.account.address, 300, milestones(total, 5, ref)]);
await api("POST", "/v1/shipments/mirror", { shipmentId: id, externalRef: ref, route, maxGapSec: 1800, minSensors: 2 });
await tx("approve vault (financier)", financier, "financier", c.usdg, usdgAbi, "approve", [c.receivableVault, total]);
await tx("deposit capital", financier, "financier", c.financingController, controllerAbi, "depositCapital", [id]);
await tx("start transit", exporter, "exporter", c.financingController, controllerAbi, "startTransit", [id]);

const g = newGatewayKey();
const sensors = ["probe-1", "probe-2"];
const issuedAt = Math.floor(Date.now() / 1000);
const signature = await exporter.account.signMessage({ message: sourceAuthorizationMessage(id, g.publicKey, sensors, issuedAt) });
const src = await api<{ id: string }>("POST", `/v1/shipments/${id}/sources`, { label: "Reefer logger", publicKey: g.publicKey, sensorIds: sensors, issuedAt, signature });
if (src.id !== sourceIdFor(g.publicKey)) throw new Error("source id mismatch");
console.log(`  gateway ${src.id}`);

// healthy, noisy readings (±0.2 °C, humidity 62-68 %, GNSS jitter, small shocks), minutes old, 5 s apart
let t = Math.floor(Date.now() / 1000) - 600;
let step = 0;
const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const leg = (steps: number) => {
  const pts = [];
  for (let i = 0; i < steps; i++, t += 5, step++) {
    for (const s of sensors) {
      const base = s === "probe-1" ? 5.0 : 4.8;
      pts.push({
        timestamp: t, sensorId: s, temperatureX100: Math.round((base + between(-0.2, 0.2)) * 100), humidityX100: Math.round(between(62, 68) * 100),
        latitudeE6: Math.round((18.95 - step * 0.0002) * 1e6) + Math.round(between(-40, 40)), longitudeE6: Math.round((72.95 + step * 0.00035) * 1e6) + Math.round(between(-40, 40)),
        shockX100: Math.round(between(5, 25)),
      });
    }
  }
  return pts;
};
type Outcome = { epochs: { sequence: number; milestoneIndex: number; action: string; skipped?: string; releaseTx?: string; pauseTx?: string; error?: string }[]; accepted: number; rejected: unknown[] };
const send = async (label: string, points: unknown[]) => {
  const p = `/v1/shipments/${id}/telemetry`;
  const raw = JSON.stringify({ points });
  const ts = Math.floor(Date.now() / 1000);
  const r = await api<Outcome>("POST", p, undefined, { "X-Source-Id": src.id, "X-Timestamp": String(ts), "X-Signature": signRequest(g.seed, "POST", p, ts, raw) }, raw);
  console.log(`  ${label}: ${r.accepted} accepted, ${r.rejected.length} quarantined; epochs: ${r.epochs.map((e) => `#${e.sequence} M${e.milestoneIndex === 255 ? "-" : e.milestoneIndex + 1} ${e.skipped ? "skipped " + e.skipped : e.action}${e.releaseTx ? " released " + e.releaseTx : ""}${e.pauseTx ? " PAUSED" : ""}${e.error ? ` error=${e.error}` : ""}`).join("; ")}`);
  for (const e of r.epochs) if (e.releaseTx) fs.appendFileSync(TXLOG, JSON.stringify({ at: new Date().toISOString(), shot: "D8-passkey-setup", role: "backend", what: `release milestone ${e.milestoneIndex + 1}`, hash: e.releaseTx }) + "\n");
  return r;
};
const facility = async () => (await pub.readContract({ address: c.financingController, abi: controllerAbi, functionName: "getFacility", args: [id] })) as { status: number; nextMilestone: number; milestoneCount: number };
for (let i = 1; i <= 8; i++) {
  await send(`leg ${i}`, leg(16));
  const f = await facility();
  console.log(`  facility status ${f.status}, next milestone ${f.nextMilestone}/${f.milestoneCount}`);
  if (Number(f.nextMilestone) >= Number(f.milestoneCount)) break;
  if (t > Math.floor(Date.now() / 1000) - 10) await new Promise((r) => setTimeout(r, (t - Math.floor(Date.now() / 1000) + 15) * 1000));
}
const view = await api<{ facility: { status: string; drawn: string } }>("GET", `/v1/shipments/${id}`);
console.log(`dashboard status ${view.facility.status}, drawn ${Number(view.facility.drawn) / 1e6} USDG`);
console.log(`track page https://cargoflow.adoranto737.workers.dev/track/${id}`);
