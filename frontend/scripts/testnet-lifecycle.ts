// A live smoke test of the real-user flows against a deployed backend and the public testnet: one shipment from
// registration to settlement, every step signed by the party that would sign it in the web app (keys from the
// repository's gitignored .env), using the app's own ABIs, policy builder and gateway signer.
//
//   node --experimental-strip-types scripts/testnet-lifecycle.ts https://cargoflow-api-….onrender.com
//
// It spends testnet gas from each party and a small amount of testnet USDG (facility 20, invoice 30).
//
// Partial runs for demo data: STOP=paused ends after the excursion (a live paused facility for the automatic
// recovery worker), MODE=request registers a shipment with its policy and opens a market financing request.
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { controllerAbi, policiesAbi, registryAbi, usdgAbi } from "../src/lib/chain/abis.ts";
import { buildMilestones, buildPolicy, defaultPolicyForm, routeCommitment, ROUTES } from "../src/lib/exporter.ts";
import { requestMessage } from "../src/lib/api/market.ts";
import { newGatewayKey, recoveryAuthorizationMessage, signRequest, sourceAuthorizationMessage, sourceIdFor } from "../src/lib/gateway.ts";

const API = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!API) throw new Error("usage: testnet-lifecycle.ts <backend url>");
const env = Object.fromEntries(
  readFileSync(new URL("../../.env", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => [m[1], m[2]!.trim().replace(/^["']|["']$/g, "")]),
) as Record<string, string>;
const key = (n: string) => privateKeyToAccount((env[n]!.startsWith("0x") ? env[n] : `0x${env[n]}`) as Hex);

const chain = defineChain({ id: 46630, name: "Robinhood Chain Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } });
const pub = createPublicClient({ chain, transport: http() });
const wallet = (n: string) => createWalletClient({ account: key(n), chain, transport: http() });
const exporter = wallet("EXPORTER_KEY"), financier = wallet("FINANCIER_KEY"), buyer = wallet("BUYER_KEY");

async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, raw?: string): Promise<T> {
  const res = await fetch(API + path, { method, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), headers: { "Content-Type": "application/json", ...headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

async function tx(label: string, w: typeof exporter, address: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[]) {
  const hash = await w.writeContract({ address, abi: abi as never, functionName: functionName as never, args: args as never, chain, account: w.account! });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`  ${label}: ${hash}`);
  return hash;
}

type Outcome = { epochs: { sequence: number; milestoneIndex: number; pass: boolean; action: string; skipped?: string; releaseTx?: string; pauseTx?: string; commitTx?: string; error?: string }[]; accepted: number; rejected: unknown[] };

async function main() {
  const cfg = await api<{ contracts: Record<string, Address> }>("GET", "/v1/config");
  const c = cfg.contracts;
  const ref = `CF-LIVE-${Date.now()}`;
  const route = ROUTES[0]!.points;
  const policy = buildPolicy(defaultPolicyForm);
  const total = 20_000_000n, invoice = 30_000_000n; // 20 and 30 USDG
  console.log(`shipment ${ref}`);

  // 1. the exporter registers the shipment, its policy and the facility (the wizard's three transactions)
  const refHash = keccak256(toBytes(ref));
  const id = (await pub.readContract({ address: c.shipmentRegistry!, abi: registryAbi, functionName: "shipmentIdFor", args: [exporter.account!.address, refHash] })) as Hex;
  const commitment = (await pub.readContract({ address: c.policyEngine!, abi: policiesAbi, functionName: "hashPolicy", args: [policy] })) as Hex;
  await tx("register shipment", exporter, c.shipmentRegistry!, registryAbi, "registerShipment", [refHash, buyer.account!.address, keccak256(toBytes(`invoice:${ref}:${invoice}`)), routeCommitment(route), commitment, invoice]);
  await tx("set policy", exporter, c.policyEngine!, policiesAbi, "setPolicy", [id, policy]);
  if (process.env.MODE !== "request") await tx("create facility", exporter, c.financingController!, controllerAbi, "createFacility", [id, financier.account!.address, 300, buildMilestones(total, 5, Number(defaultPolicyForm.minScore), ref)]);
  if (process.env.MODE === "request") {
    await api("POST", "/v1/shipments/mirror", { shipmentId: id, externalRef: ref, route, maxGapSec: 1800, minSensors: 2 });
    const at = Math.floor(Date.now() / 1000);
    const msig = await exporter.account!.signMessage!({ message: requestMessage(id, total, 400, 5, at) });
    const r = await api<{ id: string }>("POST", "/v1/requests", { shipmentId: id, amount: total.toString(), maxFeeBps: 400, milestoneCount: 5, note: "Vaccines, 2-8 °C, Nhava Sheva to Singapore", issuedAt: at, signature: msig });
    console.log(`  market request ${r.id} for ${id}`);
    return;
  }
  await api("POST", "/v1/shipments/mirror", { shipmentId: id, externalRef: ref, route, maxGapSec: 1800, minSensors: 2 });
  console.log(`  dashboard id ${id}`);

  // 2. the financier funds it
  await tx("approve vault (financier)", financier, c.usdg!, usdgAbi, "approve", [c.receivableVault!, total]);
  await tx("deposit capital", financier, c.financingController!, controllerAbi, "depositCapital", [id]);

  // 3. the exporter starts transit and adds the data logger as a gateway (wallet-signed authorization)
  await tx("start transit", exporter, c.financingController!, controllerAbi, "startTransit", [id]);
  const g = newGatewayKey();
  const sensors = ["probe-1", "probe-2"];
  const issuedAt = Math.floor(Date.now() / 1000);
  const signature = await exporter.account!.signMessage!({ message: sourceAuthorizationMessage(id, g.publicKey, sensors, issuedAt) });
  const src = await api<{ id: string }>("POST", `/v1/shipments/${id}/sources`, { label: "Reefer logger", publicKey: g.publicKey, sensorIds: sensors, issuedAt, signature });
  if (src.id !== sourceIdFor(g.publicKey)) throw new Error("source id mismatch");
  console.log(`  gateway ${src.id}`);

  // 4. the logger's readings, signed with the gateway key like the browser upload does
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  let t = Math.floor(Date.now() / 1000) - 900;
  const leg = (steps: number, hot: number[] = []) => {
    const pts = [];
    for (let i = 0; i < steps; i++, t += 5) {
      const h = i - (steps - hot.length);
      for (const s of sensors) {
        // real probes are never flat: a perfectly constant sensor is itself a tampering signal, so add the
        // noise a reefer probe shows (±0.2 °C, ±3 % humidity, a few metres of GNSS jitter, small shocks)
        const base = s === "probe-1" ? 5.0 : 5.1;
        const temp = h >= 0 ? (s === "probe-1" ? hot[h]! : 4.6) : base + (rand() - 0.5) * 0.4;
        pts.push({
          timestamp: t, sensorId: s, temperatureX100: Math.round(temp * 100), humidityX100: 6500 + Math.round((rand() - 0.5) * 600),
          latitudeE6: Math.round((18.95 - i * 0.0004) * 1e6) + Math.round((rand() - 0.5) * 100),
          longitudeE6: Math.round((72.95 + i * 0.0004) * 1e6) + Math.round((rand() - 0.5) * 100), shockX100: 5 + Math.floor(rand() * 21),
        });
      }
    }
    return pts;
  };
  const send = async (label: string, points: unknown[]) => {
    const path = `/v1/shipments/${id}/telemetry`;
    const raw = JSON.stringify({ points });
    const ts = Math.floor(Date.now() / 1000);
    const r = await api<Outcome>("POST", path, undefined, { "X-Source-Id": src.id, "X-Timestamp": String(ts), "X-Signature": signRequest(g.seed, "POST", path, ts, raw) }, raw);
    console.log(`  ${label}: ${r.accepted} accepted, ${r.rejected.length} quarantined; epochs: ${r.epochs.map((e) => `#${e.sequence} M${e.milestoneIndex === 255 ? "-" : e.milestoneIndex + 1} ${e.skipped ? "skipped" : e.action}${e.releaseTx ? " released" : ""}${e.pauseTx ? " PAUSED" : ""}${e.error ? ` error=${e.error}` : ""}`).join("; ")}`);
    return r;
  };
  await send("leg 1, healthy", leg(16));
  await send("leg 2, reefer fails", leg(8, [5.2, 6.8, 8.9, 10.4, 11.7]));
  await send("leg 3, probe-2 still in range", leg(8));
  if (process.env.STOP === "paused") {
    console.log(`  stopped while paused: ${id}`);
    return;
  }

  // 5. recovery: the exporter signs, the backend proves bound to the exporter, the exporter submits the proof
  const ri = Math.floor(Date.now() / 1000);
  const rsig = await exporter.account!.signMessage!({ message: recoveryAuthorizationMessage(id, "probe-2", exporter.account!.address, ri) });
  const p = await api<{ milestoneIndex: number; sequence: number; a: [string, string]; b: [[string, string], [string, string]]; c: [string, string]; commitTx: string }>("POST", `/v1/shipments/${id}/recovery`, { sensorId: "probe-2", submitter: exporter.account!.address, issuedAt: ri, signature: rsig });
  console.log(`  recovery epoch committed: ${p.commitTx}`);
  await tx("resume with proof (exporter)", exporter, c.financingController!, controllerAbi, "resumeWithProof", [id, p.milestoneIndex, p.sequence, p.a.map(BigInt), p.b.map((r) => r.map(BigInt)), p.c.map(BigInt)]);
  const f = (await pub.readContract({ address: c.financingController!, abi: controllerAbi, functionName: "getFacility", args: [id] })) as { nextMilestone: number };
  if (Number(f.nextMilestone) === p.milestoneIndex) {
    await tx(`release milestone ${p.milestoneIndex + 1}`, exporter, c.financingController!, controllerAbi, "evaluateAndReleaseMilestone", [id, p.milestoneIndex, p.sequence]);
  } else console.log(`  milestone ${p.milestoneIndex + 1} was already released by the backend`);

  // 6. the rest of the voyage, then the buyer confirms delivery and pays
  await send("leg 4, healthy", leg(16));
  await tx("confirm delivery (buyer)", buyer, c.financingController!, controllerAbi, "markDelivered", [id]);
  await tx("approve vault (buyer)", buyer, c.usdg!, usdgAbi, "approve", [c.receivableVault!, invoice]);
  await tx("pay invoice", buyer, c.financingController!, controllerAbi, "settle", [id]);

  const view = await api<{ facility: { status: string; drawn: string } }>("GET", `/v1/shipments/${id}`);
  console.log(`final status ${view.facility.status}, drawn ${Number(view.facility.drawn) / 1e6} USDG`);
  if (view.facility.status !== "SETTLED") process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
