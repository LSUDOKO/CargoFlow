// The Workers entry, called directly with web-standard Requests (no wrangler needed). The CargoFlow API is mocked by
// stubbing globalThis.fetch, which is what the hosted server uses.
import { hashDocument } from "@cargoflow/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handle } from "../src/hosted.js";
import worker from "../src/worker.js";

const ID = "0x" + "cd".repeat(32);
const EXPORTER = "0x8e6877a28d51a6c2b1699154cc17f3ebf682102f";
const BUYER = "0x6248101b50364011f12174cdb9d5305faf671d4a";
const invoiceBytes = new TextEncoder().encode("INVOICE CF-W-1: 12,000 USDG");
const inv = hashDocument(invoiceBytes);
const policy = { minTempX100: 200, maxTempX100: 800, maxGapSec: 1800, maxRouteDeviationM: 25000, minEvidenceScore: 75, maxConflictBps: 3000, maxRiskBps: 3500, requiresZk: false, minSensors: 2 };
const shipment = {
  id: ID, externalRef: "CF-W-1", exporter: EXPORTER, buyer: BUYER, financier: null, invoiceHash: inv.keccak256, routeCommitment: "0x7e", policyCommitment: "0x52",
  invoiceValue: "12000000", policy, route: [{ latE6: 18950000, lonE6: 72950000 }], status: "ACTIVE", createdAt: "2026-10-02T10:29:21Z", updatedAt: "2026-10-02T10:30:36Z",
};
const config = {
  chainId: 46630, usdgDecimals: 6,
  contracts: {
    usdg: "0x7e955252e15c84f5768b83c41a71f9eba181802f", access: "0x5ed4f105e3c3c0a67f916c0fc339b261e3de81d7", evidenceRegistry: "0x4ad47799586b4793b7952ba849013f5d0ec2e66a",
    financingController: "0xa2e708376cddf0eb8fa746c43089611b4d49e210", policyEngine: "0x93f2cd67f404f62ff34f729aad1118ea9e1582d0", receivableVault: "0x5298dcdbdf6ec799475b09c2ecd0f089bd4d6902",
    shipmentRegistry: "0x2f7cac603654ec106da242cd0b16044b31f7608d",
  },
};

const API = "https://api.example.test";
function mockApi(calls: string[] = [], over: Record<string, () => Response> = {}) {
  const j = (v: unknown, s = 200) => new Response(JSON.stringify(v), { status: s });
  vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== API) return j({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "no rpc in tests" } }); // on-chain read falls back
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    calls.push(key);
    if (over[key]) return over[key]!();
    switch (key) {
      case "GET /v1/config": return j(config);
      case "GET /v1/shipments": return j({ shipments: [shipment], limit: 20, offset: 0 });
      case `GET /v1/shipments/${ID}`: return j({ shipment, milestones: [], facility: null, latestEvidence: null, quarantinedReadings: 0, usdgDecimals: 6 });
      case `GET /v1/shipments/${ID}/documents`:
        return j({ documents: [{ id: "d1", kind: "invoice", name: "invoice.pdf", sizeBytes: invoiceBytes.length, sha256: inv.sha256, keccak256: inv.keccak256, signer: EXPORTER, role: "exporter", createdAt: "2026-10-02T10:00:00Z", matchesInvoiceHash: true }] });
      default: return j({ error: { code: "not_found", message: `no route ${key}` } }, 404);
    }
  }) as typeof fetch);
}

const env = { CARGOFLOW_API_URL: API, CARGOFLOW_RPC_URL: "https://rpc.example.test" };
const ORIGIN = "https://cargoflow-mcp.example.workers.dev";
const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" };

let nextId = 1;
async function rpc(method: string, params: Record<string, unknown> = {}) {
  const res = await handle(new Request(`${ORIGIN}/mcp`, { method: "POST", headers: MCP_HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }) }), env);
  return { res, body: (await res.json()) as { result?: any; error?: { message: string } } };
}
const toolText = (body: { result?: { content: { text: string }[] } }) => body.result!.content.map((c) => c.text).join("\n");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("worker /mcp", () => {
  it("initialize -> tools/list -> tools/call list_shipments, statelessly with JSON responses", async () => {
    const calls: string[] = [];
    mockApi(calls);
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vitest", version: "1" } });
    expect(init.res.status).toBe(200);
    expect(init.res.headers.get("content-type")).toContain("application/json");
    expect(init.res.headers.get("access-control-allow-origin")).toBe("*");
    expect(init.res.headers.get("mcp-session-id")).toBeNull();
    expect(init.body.result.serverInfo.name).toBe("cargoflow");
    expect(init.body.result.capabilities.tools).toBeDefined();

    const list = await rpc("tools/list");
    const names: string[] = list.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_shipments", "get_shipment", "explain_shipment", "fleet_risk_summary", "verify_document", "prepare_deposit", "prepare_settle"]));
    expect(names).not.toContain("submit_readings_csv");
    const verify = list.body.result.tools.find((t: { name: string }) => t.name === "verify_document");
    expect(Object.keys(verify.inputSchema.properties)).toEqual(expect.arrayContaining(["sha256", "keccak256", "contentBase64"]));
    expect(verify.inputSchema.properties.path).toBeUndefined();

    const r = await rpc("tools/call", { name: "list_shipments", arguments: {} });
    expect(r.body.result.isError).toBeFalsy();
    expect(toolText(r.body)).toContain("CF-W-1");
    expect(calls).toContain("GET /v1/shipments");
  });

  it("verify_document takes hashes or base64 content in hosted mode", async () => {
    mockApi();
    const byHash = await rpc("tools/call", { name: "verify_document", arguments: { shipmentId: ID, keccak256: inv.keccak256.slice(2).toUpperCase() } });
    expect(toolText(byHash.body)).toContain("MATCH");
    expect(toolText(byHash.body)).toContain("Attested as: invoice.pdf");

    const b64 = btoa(String.fromCharCode(...invoiceBytes));
    const byContent = await rpc("tools/call", { name: "verify_document", arguments: { shipmentId: ID, contentBase64: b64, name: "inv.pdf" } });
    expect(toolText(byContent.body)).toContain(`sha256 ${inv.sha256}`);
    expect(toolText(byContent.body)).toContain("MATCH");

    const shaOnly = await rpc("tools/call", { name: "verify_document", arguments: { shipmentId: ID, sha256: inv.sha256 } });
    expect(toolText(shaOnly.body)).toContain("pass keccak256 or the file content");
    expect(toolText(shaOnly.body)).toContain("Attested as");

    const none = await rpc("tools/call", { name: "verify_document", arguments: { shipmentId: ID } });
    expect(none.body.result.isError).toBe(true);
  });

  it("says the API is waking up when Render answers 503 or times out", async () => {
    mockApi([], { "GET /v1/shipments": () => new Response("<html>Service Unavailable</html>", { status: 503 }) });
    const r = await rpc("tools/call", { name: "list_shipments", arguments: {} });
    expect(r.body.result.isError).toBe(true);
    expect(toolText(r.body)).toContain("The CargoFlow API is waking up");
  });

  it("GET /mcp without text/html is 405 (no SSE stream); with text/html it is the landing page; DELETE is accepted", async () => {
    const sse = await handle(new Request(`${ORIGIN}/mcp`, { headers: { accept: "text/event-stream" } }), env);
    expect(sse.status).toBe(405);
    expect(sse.headers.get("allow")).toContain("POST");
    const html = await handle(new Request(`${ORIGIN}/mcp`, { headers: { accept: "text/html" } }), env);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain("Add custom connector");
    const del = await handle(new Request(`${ORIGIN}/mcp`, { method: "DELETE", headers: { "mcp-protocol-version": "2025-06-18" } }), env);
    expect(del.status).toBe(200);
  });

  it("rejects a non-JSON body as a JSON-RPC parse error", async () => {
    const res = await handle(new Request(`${ORIGIN}/mcp`, { method: "POST", headers: MCP_HEADERS, body: "not json" }), env);
    expect(res.status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("worker routes", () => {
  it("answers the CORS preflight", async () => {
    const res = await worker.fetch(
      new Request(`${ORIGIN}/mcp`, { method: "OPTIONS", headers: { origin: "https://claude.ai", "access-control-request-method": "POST", "access-control-request-headers": "content-type, mcp-protocol-version" } }),
      env,
      { waitUntil: () => {} },
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    for (const h of ["content-type", "mcp-protocol-version", "mcp-session-id", "authorization", "last-event-id"]) expect(res.headers.get("access-control-allow-headers")).toContain(h);
    expect(res.headers.get("access-control-expose-headers")).toContain("Mcp-Session-Id");
  });

  it("GET / is a JSON description (HTML for browsers) and /health is ok", async () => {
    const j = await handle(new Request(`${ORIGIN}/`), env);
    expect(j.status).toBe(200);
    const body = (await j.json()) as { mcp: string; api: string; addToClaude: Record<string, unknown> };
    expect(body.mcp).toBe(`${ORIGIN}/mcp`);
    expect(body.api).toBe(API);
    expect(body.addToClaude["Claude Code"]).toBe(`claude mcp add --transport http cargoflow ${ORIGIN}/mcp`);

    const h = await handle(new Request(`${ORIGIN}/`, { headers: { accept: "text/html,application/xhtml+xml" } }), {});
    expect(h.headers.get("content-type")).toContain("text/html");
    const page = await h.text();
    expect(page).toContain(`${ORIGIN}/mcp`);
    expect(page).toContain("https://cargoflow-api-75ul.onrender.com"); // default API when no var is set

    const health = await handle(new Request(`${ORIGIN}/health`), env);
    expect(await health.json()).toMatchObject({ ok: true, name: "cargoflow-mcp" });
  });

  it("404s unknown paths and 405s wrong methods, with CORS headers", async () => {
    const nf = await handle(new Request(`${ORIGIN}/nope`), env);
    expect(nf.status).toBe(404);
    expect(nf.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await nf.json()) as { error: string }).error).toContain("/mcp");
    expect((await handle(new Request(`${ORIGIN}/sse`, { method: "POST" }), env)).status).toBe(404);
    expect((await handle(new Request(`${ORIGIN}/health`, { method: "POST" }), env)).status).toBe(405);
    expect((await handle(new Request(`${ORIGIN}/mcp`, { method: "PUT" }), env)).status).toBe(405);
  });
});
