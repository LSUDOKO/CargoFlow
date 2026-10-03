import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { contracts, gateway, hashDocument, messages } from "@cargoflow/sdk";
import { decodeFunctionData, erc20Abi } from "viem";
import { describe, expect, it } from "vitest";
import { createCargoFlowServer, parseArgs, type ServerOptions } from "../src/index.js";

const ID = "0x" + "ab".repeat(32);
const EXPORTER = "0x8e6877a28d51a6c2b1699154cc17f3ebf682102f";
const FINANCIER = "0x2198ab4e7755510a6a94ee298cf70f44e0f86414";
const BUYER = "0x6248101b50364011f12174cdb9d5305faf671d4a";
const invoiceBytes = new TextEncoder().encode("INVOICE CF-TEST-1: 30,000 USDG");
const invoiceHash = hashDocument(invoiceBytes).keccak256;

const configV1 = {
  chainId: 46630, usdgDecimals: 6,
  contracts: {
    usdg: "0x7e955252e15c84f5768b83c41a71f9eba181802f", access: "0x5ed4f105e3c3c0a67f916c0fc339b261e3de81d7", evidenceRegistry: "0x4ad47799586b4793b7952ba849013f5d0ec2e66a",
    financingController: "0xa2e708376cddf0eb8fa746c43089611b4d49e210", policyEngine: "0x93f2cd67f404f62ff34f729aad1118ea9e1582d0", receivableVault: "0x5298dcdbdf6ec799475b09c2ecd0f089bd4d6902",
    shipmentRegistry: "0x2f7cac603654ec106da242cd0b16044b31f7608d",
  },
};
const configV2 = { ...configV1, contracts: { ...configV1.contracts, coverPool: "0x00000000000000000000000000000000000000c0" } };

const policy = { minTempX100: 200, maxTempX100: 800, maxGapSec: 1800, maxRouteDeviationM: 25000, minEvidenceScore: 75, maxConflictBps: 3000, maxRiskBps: 3500, requiresZk: false, minSensors: 2 };
const shipment = {
  id: ID, externalRef: "CF-TEST-1", exporter: EXPORTER, buyer: BUYER, financier: FINANCIER, invoiceHash, routeCommitment: "0x7e", policyCommitment: "0x52",
  invoiceValue: "30000000", policy, route: [{ latE6: 18950000, lonE6: 72950000 }], status: "ACTIVE", createdAt: "2026-10-02T10:29:21Z", updatedAt: "2026-10-02T10:30:36Z",
};
const facility = (status: string, over: Record<string, unknown> = {}) => ({
  status, exporter: EXPORTER, financier: FINANCIER, buyer: BUYER, committed: "20000000", drawn: "8000000", remaining: "12000000", feeBps: 300,
  nextMilestone: 2, milestoneCount: 5, pausedAt: 0, pauseCount: 0, funded: true, vaultPaused: false, closed: false, ...over,
});
const milestone = (i: number) => ({ index: i, description: "", allocatedUsdg: "4000000", evidenceThreshold: 75, checkpointCommitment: "0x00", released: i < 2 });
const view = (f: unknown) => ({ shipment, milestones: [0, 1, 2, 3, 4].map(milestone), facility: f, latestEvidence: null, quarantinedReadings: 0, usdgDecimals: 6 });

function api(o: { facility?: unknown; config?: unknown; calls?: string[] } = {}) {
  const f = "facility" in o ? o.facility : facility("ACTIVE");
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    o.calls?.push(`${key}${init?.body ? ` ${init.body}` : ""}`);
    const j = (v: unknown, s = 200) => new Response(JSON.stringify(v), { status: s });
    switch (key) {
      case "GET /v1/config": return j(o.config ?? configV1);
      case "GET /v1/shipments": return j({ shipments: [shipment], limit: 20, offset: 0 });
      case `GET /v1/shipments/${ID}`: return j(view(f));
      case `GET /v1/shipments/${ID}/explanation`:
        return j({ status: "PAUSED", headline: "Paused: probe-1 read 11.7 °C, above the 8 °C limit.", causes: ["Evidence score 48 is below the policy's 75."], nextSteps: [{ role: "exporter", action: "Prove recovery with fresh readings." }], forecast: null, source: "rules" });
      case `GET /v1/shipments/${ID}/documents`: return j({ documents: [{ id: "d1", kind: "invoice", name: "invoice.pdf", sizeBytes: invoiceBytes.length, sha256: hashDocument(invoiceBytes).sha256, keccak256: invoiceHash, signer: EXPORTER, role: "exporter", createdAt: "2026-10-02T10:00:00Z", matchesInvoiceHash: true }] });
      case `GET /v1/shipments/${ID}/epochs`:
        return j({ epochs: [{ sequence: 1, milestoneIndex: 2, epochId: "0x01", root: "0x02", readingCount: 16, startTime: 1, endTime: 2, score: 100, conflictBps: 100, riskBps: 400, compliant: true, penalties: null, decisionPass: true, decisionAction: "APPROVE_ADVANCE", reasons: null, commitTx: "0xc0", proofVerified: false, createdAt: "t" }] });
      case `GET /v1/shipments/${ID}/cover`: return new Response("404 page not found", { status: 404 });
      case `POST /v1/shipments/${ID}/recovery`:
        return j({ milestoneIndex: 2, sequence: 2, epochId: "0x03", root: "0x04", score: 100, commitTx: "0xc1", submitter: EXPORTER, a: ["1", "2"], b: [["3", "4"], ["5", "6"]], c: ["7", "8"] });
      default: return j({ error: { code: "not_found", message: `no route ${key}` } }, 404);
    }
  }) as typeof fetch;
}

async function connect(opts: ServerOptions) {
  const server = createCargoFlowServer({ rpcUrl: "http://127.0.0.1:9", now: () => 1_800_000_000, ...opts });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
    return { isError: !!r.isError, text: r.content.map((c) => c.text).join("\n\n") };
  };
  return { client, call };
}
const txsOf = (t: string) => JSON.parse(t.slice(t.indexOf("```json") + 7, t.lastIndexOf("```"))).transactions as { to: string; data: `0x${string}`; value: string; chainId: number }[];

describe("tools", () => {
  it("lists read and prepare tools, and the gateway tool only with a key file", async () => {
    const { client } = await connect({ fetch: api() });
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "explain_shipment", "fleet_risk_summary", "get_audit", "get_cover", "get_documents", "get_ebl", "get_epcis", "get_evidence", "get_party", "get_pricing",
      "get_shipment", "get_track", "list_market_requests", "list_shipments", "prepare_accept_cover", "prepare_cancel", "prepare_deposit", "prepare_mark_delivered",
      "prepare_offer_cover", "prepare_open_dispute", "prepare_release", "prepare_resume_with_proof", "prepare_settle", "prepare_trigger_parametric", "verify_document",
    ]);
    const withKey = await connect({ fetch: api(), gatewayKeyFile: "/nonexistent/key.json" });
    expect((await withKey.client.listTools()).tools.map((t) => t.name)).toContain("submit_readings_csv");
  });

  it("list_shipments and get_shipment answer in plain text with ids and a dashboard link", async () => {
    const { call } = await connect({ fetch: api(), appUrl: "https://app.example" });
    const l = await call("list_shipments", { status: ["active"] });
    expect(l.text).toContain("CF-TEST-1 · ACTIVE · invoice 30 USDG");
    expect(l.text).toContain(`id ${ID}`);
    const g = await call("get_shipment", { shipmentId: ID });
    expect(g.text).toContain("Facility: committed 20 USDG, drawn 8 USDG");
    expect(g.text).toContain(`Dashboard: https://app.example/track/${ID}`);
  });

  it("explain_shipment lists causes and next steps", async () => {
    const { call } = await connect({ fetch: api() });
    const r = await call("explain_shipment", { shipmentId: ID });
    expect(r.text).toContain("PAUSED: Paused: probe-1 read 11.7 °C");
    expect(r.text).toContain("exporter: Prove recovery with fresh readings.");
  });

  it("verify_document hashes a local file and matches the invoice hash and the attestation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-mcp-"));
    const file = join(dir, "invoice.pdf");
    await writeFile(file, invoiceBytes);
    const { call } = await connect({ fetch: api() });
    const r = await call("verify_document", { shipmentId: ID, path: file });
    expect(r.isError).toBe(false);
    expect(r.text).toContain(`keccak256 ${invoiceHash}`);
    expect(r.text).toContain("MATCH: its keccak256 equals the shipment's on-chain invoice hash");
    expect(r.text).toContain("Attested as: invoice.pdf (invoice) by exporter");
    const missing = await call("verify_document", { shipmentId: ID, path: join(dir, "nope.pdf") });
    expect(missing).toMatchObject({ isError: true });
    expect(missing.text).toMatch(/No readable file/);
  }, 20_000);

  it("rejects malformed ids before calling the API", async () => {
    const { call } = await connect({ fetch: api() });
    const r = await call("get_shipment", { shipmentId: "0x123" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/0x followed by 64 hex/);
  });
});

describe("prepare tools", () => {
  it("prepare_deposit returns approve + depositCapital for a CREATED facility", async () => {
    const { call } = await connect({ fetch: api({ facility: facility("CREATED", { drawn: "0", remaining: "20000000", nextMilestone: 0, funded: false }) }) });
    const r = await call("prepare_deposit", { shipmentId: ID });
    expect(r.isError).toBe(false);
    expect(r.text).toContain(`Sign with the financier's wallet (${FINANCIER})`);
    const [approve, deposit] = txsOf(r.text);
    expect(approve!.to.toLowerCase()).toBe(configV1.contracts.usdg);
    expect(decodeFunctionData({ abi: erc20Abi, data: approve!.data }).args).toEqual([expect.stringMatching(/^0x5298/i), 20_000_000n]);
    expect(deposit).toMatchObject({ value: "0x0", chainId: 46630 });
    expect(decodeFunctionData({ abi: contracts.financingControllerAbi, data: deposit!.data }).functionName).toBe("depositCapital");
  });

  it("refuses a deposit when the facility is not CREATED, in plain words", async () => {
    const { call } = await connect({ fetch: api({ facility: facility("SETTLED") }) });
    const r = await call("prepare_deposit", { shipmentId: ID });
    expect(r).toEqual({ isError: true, text: "CF-TEST-1 is SETTLED; it can be funded only when CREATED." });
    const none = await (await connect({ fetch: api({ facility: null }) })).call("prepare_settle", { shipmentId: ID });
    expect(none.text).toMatch(/has no facility yet/);
  });

  it("prepare_release picks the newest passing committed epoch of the next milestone", async () => {
    const { call } = await connect({ fetch: api() });
    const r = await call("prepare_release", { shipmentId: ID });
    expect(r.isError).toBe(false);
    const [tx] = txsOf(r.text);
    expect(decodeFunctionData({ abi: contracts.financingControllerAbi, data: tx!.data }).args).toEqual([ID, 2, 1]);
    expect((await call("prepare_release", { shipmentId: ID, milestoneIndex: 3 })).text).toMatch(/strictly in order/);
  });

  it("prepare_mark_delivered waits for the last milestone", async () => {
    const { call } = await connect({ fetch: api() });
    expect((await call("prepare_mark_delivered", { shipmentId: ID })).text).toMatch(/Only 2 of 5 milestones are released/);
  });

  it("cover tools explain that v1 has no CoverPool", async () => {
    const { call } = await connect({ fetch: api() });
    const r = await call("prepare_offer_cover", { shipmentId: ID, amountUsdg: "1000", premiumBps: 150 });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/contracts v1, which has no CoverPool/);
    expect((await call("get_cover", { shipmentId: ID })).text).toMatch(/contracts v1, which has no default cover/);
  });

  it("prepare_offer_cover on v2 approves the pool for the amount", async () => {
    const { call } = await connect({ fetch: api({ config: configV2 }) });
    const r = await call("prepare_offer_cover", { shipmentId: ID, amountUsdg: "2,500.5", premiumBps: 150 });
    const [approve, offer] = txsOf(r.text);
    expect(decodeFunctionData({ abi: erc20Abi, data: approve!.data }).args?.[1]).toBe(2_500_500_000n);
    expect(decodeFunctionData({ abi: contracts.coverPoolAbi, data: offer!.data }).args).toEqual([ID, 2_500_500_000n, 150]);
    expect(r.text).toContain("premium of 37.5075 USDG");
  });

  it("prepare_resume_with_proof without a signature only explains, with the exact message to sign", async () => {
    const calls: string[] = [];
    const { call } = await connect({ fetch: api({ facility: facility("PAUSED", { pauseCount: 1 }), calls }) });
    const r = await call("prepare_resume_with_proof", { shipmentId: ID, sensorId: "probe-2" });
    expect(r.isError).toBe(false);
    expect(r.text).toContain(messages.recoveryMessage(ID, "probe-2", EXPORTER, 1_800_000_000));
    expect(r.text).toContain("Nothing has been sent");
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
  });

  it("prepare_resume_with_proof with the exporter's signature returns resumeWithProof", async () => {
    const calls: string[] = [];
    const { call } = await connect({ fetch: api({ facility: facility("PAUSED", { pauseCount: 1 }), calls }) });
    const r = await call("prepare_resume_with_proof", { shipmentId: ID, sensorId: "probe-2", issuedAt: 1_800_000_000, signature: "0x" + "11".repeat(65) });
    expect(r.isError).toBe(false);
    expect(calls.find((c) => c.startsWith("POST"))).toContain('"issuedAt":1800000000');
    const [tx] = txsOf(r.text);
    expect(decodeFunctionData({ abi: contracts.financingControllerAbi, data: tx!.data }).functionName).toBe("resumeWithProof");
    const other = await call("prepare_resume_with_proof", { shipmentId: ID, sensorId: "probe-2", submitter: BUYER });
    expect(other.text).toMatch(/Only the exporter/);
  });
});

describe("gateway tool", () => {
  it("parses a CSV against the key's sensors and previews a dry run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-gw-"));
    const seed = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const keyFile = join(dir, "key.json");
    await writeFile(keyFile, gateway.encodeKeyFile({ shipmentId: ID, label: "Reefer 7", sensorIds: ["probe-1"], seed }));
    const csvFile = join(dir, "log.csv");
    await writeFile(csvFile, "timestamp,sensor_id,temperature_c,humidity_pct,latitude,longitude,shock_g\n1799999000,probe-1,4.5,60,1.29,103.85,0\n1799999600,probe-1,9.1,60,1.29,103.85,0\n");
    const { call } = await connect({ fetch: api(), gatewayKeyFile: keyFile });
    const r = await call("submit_readings_csv", { path: csvFile, dryRun: true });
    expect(r.text).toContain("Parsed 2 reading(s)");
    expect(r.text).toContain("1 reading(s) outside the policy band");
    expect(r.text).toContain("Dry run: nothing was sent.");
    expect(r.text).not.toContain(gateway.toBase64Url(seed));
    await writeFile(csvFile, "timestamp,sensor_id,temperature_c,humidity_pct,latitude,longitude,shock_g\n1799999000,probe-9,4.5,60,1.29,103.85,0\n");
    expect((await call("submit_readings_csv", { path: csvFile })).text).toMatch(/Nothing was sent: 1 row\(s\) need fixing[\s\S]*probe-9 is not one of this gateway's sensors/);
  });
});

describe("resources and prompts", () => {
  it("serves the config resource and both prompts", async () => {
    const { client } = await connect({ fetch: api() });
    const res = await client.readResource({ uri: "cargoflow://config" });
    expect(JSON.parse((res.contents[0] as { text: string }).text)).toMatchObject({ chainId: 46630, contractsVersion: "v1" });
    const sh = await client.readResource({ uri: `cargoflow://shipment/${ID}` });
    expect(JSON.parse((sh.contents[0] as { text: string }).text).shipment.externalRef).toBe("CF-TEST-1");
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name).sort();
    expect(prompts).toEqual(["daily-risk-review", "explain-pause"]);
    const p = await client.getPrompt({ name: "explain-pause", arguments: { shipmentId: ID } });
    expect((p.messages[0]!.content as { text: string }).text).toContain(ID);
  });
});

describe("parseArgs", () => {
  it("reads env and flags, and refuses wallet keys", () => {
    const a = parseArgs(["--http", "8787", "--api-url=http://localhost:8080"], { CARGOFLOW_APP_URL: "https://app", CARGOFLOW_GATEWAY_KEY_FILE: "/k.json" });
    expect(a).toMatchObject({ http: 8787, host: "127.0.0.1", options: { apiUrl: "http://localhost:8080", appUrl: "https://app", gatewayKeyFile: "/k.json" } });
    expect(() => parseArgs(["--private-key", "0x1"])).toThrow(/never accepts wallet keys/);
    expect(() => parseArgs(["--http", "x"])).toThrow(/port/);
  });
});

describe("platform and v3 tools", () => {
  const configV3 = { ...configV2, contracts: { ...configV2.contracts, eblRegistry: "0x00000000000000000000000000000000000000e0" } };
  const ep = (seq: number, compliant: boolean) => ({
    sequence: seq, milestoneIndex: 2, epochId: "0x" + seq.toString(16).padStart(64, "0"), root: "0x02", readingCount: 16, startTime: seq, endTime: seq + 1, score: compliant ? 100 : 40,
    conflictBps: 100, riskBps: 400, compliant, penalties: null, decisionPass: compliant, decisionAction: compliant ? "APPROVE_ADVANCE" : "PAUSE_FACILITY", reasons: null,
    commitTx: "0xc" + seq, proofVerified: false, createdAt: `2026-10-02T10:0${seq}:00Z`,
  });
  const v3api = (cover: unknown, epochs: unknown[] = []) => {
    const base = api({ config: configV3, facility: facility("PAUSED") });
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const j = (v: unknown, s = 200) => new Response(JSON.stringify(v), { status: s });
      switch (url.pathname) {
        case `/v1/shipments/${ID}/cover`: return j(cover);
        case `/v1/shipments/${ID}/epochs`: return j({ epochs });
        case "/v1/pricing/suggest":
          return j({ shipmentId: ID, lowBps: 250, midBps: 300, highBps: 400, reasons: [{ factor: "base", bps: 300, detail: "base fee" }, { factor: "cargo", bps: 50, detail: "chilled" }], inputs: { exporterGrade: "new", routeExcursionRate: 120, routeConflictRate: 0, cargoTemplate: "chilled", coverStatus: "none", tenorDays: 21, corridorShipments: 2, corridorEpochs: 9 }, model: "cargoflow-fee-v1" });
        case `/v1/shipments/${ID}/epcis`:
          return j({ "@context": [], type: "EPCISDocument", schemaVersion: "2.0", creationDate: "t", epcisBody: { eventList: [{ type: "ObjectEvent", bizStep: "shipping" }, { type: "ObjectEvent", bizStep: "sensor_reporting" }, { type: "ObjectEvent", bizStep: "sensor_reporting" }, { type: "ObjectEvent", bizStep: "https://cargoflow.app/epcis/bizstep/financing_paused" }] } });
        case "/v1/ebl/3":
          return j({ tokenId: "3", documentHash: "0xdd", issuer: "0xc", shipper: EXPORTER, consignee: "0x0000000000000000000000000000000000000000", holder: EXPORTER, status: "ISSUED", issuedAt: "t", closedAt: null, transfers: 1, history: [{ from: "0xc", to: EXPORTER, txHash: "0xt", at: "t" }], boundShipmentId: ID });
        case "/v1/ebl": return j({ bills: [] });
        default: return base(input, init);
      }
    }) as typeof fetch;
  };

  it("get_pricing, get_epcis and get_ebl read the new endpoints", async () => {
    const { call } = await connect({ fetch: v3api(null) });
    const p = await call("get_pricing", { shipmentId: ID });
    expect(p.text).toContain("2.5% to 4% (mid 3%)");
    expect(p.text).toContain("cargo: +50 bps (chilled)");
    const e = await call("get_epcis", { shipmentId: ID });
    expect(e.text).toContain("4 event(s)");
    expect(e.text).toContain("sensor_reporting 2");
    expect(e.text).toContain("financing_paused 1");
    const b = await call("get_ebl", { tokenId: "3" });
    expect(b.text).toContain("Bill #3 · ISSUED");
    expect(b.text).toContain("consignee to order");
    expect(b.text).toContain(`collateral for shipment ${ID}`);
    expect((await call("get_ebl", { holder: BUYER })).text).toContain("holds no bills");
  });

  it("prepare_cancel refuses after transit and encodes cancelFacility before it", async () => {
    const paused = await connect({ fetch: api({ facility: facility("ACTIVE") }) });
    expect((await paused.call("prepare_cancel", { shipmentId: ID })).text).toBe("CF-TEST-1 is ACTIVE; it can be cancelled only when CREATED or FINANCED.");
    const { call } = await connect({ fetch: api({ facility: facility("FINANCED", { drawn: "0" }) }) });
    const r = await call("prepare_cancel", { shipmentId: ID, signer: "financier" });
    expect(r.isError).toBe(false);
    expect(r.text).toContain(`Sign with the financier's wallet (${FINANCIER})`);
    expect(r.text).toContain("14 days after funding");
    const [tx] = txsOf(r.text);
    expect(decodeFunctionData({ abi: contracts.financingControllerAbi, data: tx!.data })).toEqual({ functionName: "cancelFacility", args: [ID] });
  });

  it("prepare_trigger_parametric picks the newest run of N consecutive failed committed epochs", async () => {
    const cover = { offers: [], cover: { insurer: "0x1", financier: FINANCIER, amount: "5000000", premium: "0", status: "ACTIVE", parametric: { consecutiveFailedEpochs: 2, salvageToExporter: "1000000", epochFloor: 0 } } };
    const { call } = await connect({ fetch: v3api(cover, [ep(1, false), ep(2, true), ep(3, false), ep(4, false), ep(5, false)]) });
    const r = await call("prepare_trigger_parametric", { shipmentId: ID });
    expect(r.isError).toBe(false);
    const [tx] = txsOf(r.text);
    expect(tx!.to.toLowerCase()).toBe(configV3.contracts.coverPool);
    expect(decodeFunctionData({ abi: contracts.coverPoolAbi, data: tx!.data }).args).toEqual([ID, [ep(4, false).epochId, ep(5, false).epochId]]);
    expect(r.text).toContain("RPC unavailable");
    expect((await call("prepare_trigger_parametric", { shipmentId: ID, epochIds: [ep(4, false).epochId] })).text).toMatch(/exactly 2 consecutive/);

    const few = await connect({ fetch: v3api(cover, [ep(1, false), ep(2, true), ep(3, false)]) });
    expect((await few.call("prepare_trigger_parametric", { shipmentId: ID })).text).toMatch(/needs 2 consecutive committed non-compliant epochs/);
    const plain = await connect({ fetch: v3api({ offers: [], cover: { ...cover.cover, parametric: null } }) });
    expect((await plain.call("prepare_trigger_parametric", { shipmentId: ID })).text).toMatch(/plain default cover/);
  });
});
