// The hosted (remote) CargoFlow MCP server as a web-standard fetch handler: a public, stateless Streamable HTTP
// endpoint at /mcp. Every POST gets a fresh server and transport (no sessions, no Durable Objects) and a plain JSON
// response. Hosted mode has no file system and no gateway key: read and prepare tools only, and verify_document
// takes hashes or base64 content. Nothing here imports node:*, so it runs on Cloudflare Workers (see worker.ts),
// Deno, Bun or any runtime with Request/Response.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { ListToolsRequestSchema, type ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerOptions } from "./context.js";
import { buildCargoFlowServer, VERSION } from "./core.js";

export interface Env {
  CARGOFLOW_API_URL?: string;
  CARGOFLOW_APP_URL?: string;
  CARGOFLOW_RPC_URL?: string;
}

/** The subset of the Workers ExecutionContext this handler uses. */
interface WaitUntil {
  waitUntil(p: Promise<unknown>): void;
}

export const DEFAULTS = {
  apiUrl: "https://cargoflow-api-75ul.onrender.com",
  appUrl: "https://cargoflow.adoranto737.workers.dev",
  rpcUrl: "https://rpc.testnet.chain.robinhood.com",
} as const;

/** Render's free tier sleeps when idle; 25 s leaves room inside Claude's tool-call budget for a friendly retry message. */
export const API_TIMEOUT_MS = 25_000;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, accept, mcp-protocol-version, mcp-session-id, authorization, last-event-id",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export function hostedOptions(env: Env = {}, extra: Partial<ServerOptions> = {}): ServerOptions {
  return {
    apiUrl: env.CARGOFLOW_API_URL || DEFAULTS.apiUrl,
    appUrl: env.CARGOFLOW_APP_URL || DEFAULTS.appUrl,
    rpcUrl: env.CARGOFLOW_RPC_URL || DEFAULTS.rpcUrl,
    timeoutMs: API_TIMEOUT_MS,
    ...extra,
    hosted: true,
  };
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });

const rpcError = (status: number, message: string, headers: Record<string, string> = {}) =>
  jsonResponse({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, status, headers);

function info(origin: string, env: Env) {
  const o = { apiUrl: env.CARGOFLOW_API_URL || DEFAULTS.apiUrl, appUrl: env.CARGOFLOW_APP_URL || DEFAULTS.appUrl };
  return {
    name: "CargoFlow MCP",
    version: VERSION,
    description:
      "Public remote MCP server for CargoFlow (milestone financing for temperature-controlled cargo). Read shipments, evidence, cover and pricing, explain pauses, verify documents by hash, and prepare unsigned transactions for your own wallet to sign. No keys, no signing, no auth.",
    mcp: `${origin}/mcp`,
    transport: "streamable-http (stateless, JSON responses)",
    api: o.apiUrl,
    app: o.appUrl,
    addToClaude: {
      "claude.ai": `Settings -> Connectors -> Add custom connector -> URL ${origin}/mcp`,
      "Claude Code": `claude mcp add --transport http cargoflow ${origin}/mcp`,
      Cursor: { mcpServers: { cargoflow: { url: `${origin}/mcp` } } },
    },
    source: "https://github.com/LSUDOKO/CargoFlow/tree/main/packages/mcp",
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function landingHtml(origin: string, env: Env): string {
  const i = info(origin, env);
  const url = esc(i.mcp);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CargoFlow MCP</title>
<style>
:root{--bg:#f7f7f5;--fg:#1b1d1f;--muted:#5d6166;--card:#fff;--line:#e3e3df;--accent:#0b6e4f}
@media (prefers-color-scheme:dark){:root{--bg:#121416;--fg:#e8e9ea;--muted:#a0a4a8;--card:#1b1e21;--line:#2b2f33;--accent:#4fd1a1}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:40px 16px 64px}
h1{font-size:28px;margin:0 0 4px}p{margin:8px 0}.muted{color:var(--muted)}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:16px 0}
h2{font-size:17px;margin:0 0 8px}code,pre{font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;overflow-x:auto;margin:8px 0 0}
a{color:var(--accent)}ol{margin:4px 0;padding-left:20px}
</style></head><body><main>
<h1>CargoFlow MCP</h1>
<p class="muted">v${esc(i.version)} · public remote MCP server · Streamable HTTP</p>
<p>${esc(i.description)}</p>
<section><h2>Server URL</h2><pre>${url}</pre></section>
<section><h2>Add to claude.ai</h2><ol>
<li>Open <b>Settings → Connectors</b>.</li><li>Click <b>Add custom connector</b>.</li>
<li>Name it <b>CargoFlow</b> and paste the URL above. No authentication is needed.</li>
<li>In a chat, enable CargoFlow from the tools menu and ask, for example, “Give me a fleet risk summary”.</li></ol></section>
<section><h2>Claude Code</h2><pre>claude mcp add --transport http cargoflow ${url}</pre></section>
<section><h2>Cursor</h2><pre>${esc(JSON.stringify(i.addToClaude.Cursor, null, 2))}</pre></section>
<p class="muted">Data from <a href="${esc(i.api)}/v1/config">${esc(i.api)}</a> · app <a href="${esc(i.app)}">${esc(i.app)}</a> · <a href="${esc(i.source)}">source</a> · <a href="/health">health</a></p>
</main></body></html>`;
}

// tools/list converts ~25 zod schemas to JSON Schema, several ms of CPU on every call. The hosted tool set is the
// same for every request, so the first answer is kept for the life of the isolate (Workers' free plan allows 10 ms
// of CPU per request).
type RequestHandler = (request: unknown, extra: unknown) => Promise<ListToolsResult>;
let toolsListCache: Promise<ListToolsResult> | undefined;
function memoizeToolsList(server: McpServer) {
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, RequestHandler> })._requestHandlers;
  const original = handlers?.get("tools/list");
  if (!original) return; // SDK internals changed: fall back to computing it every time
  server.server.setRequestHandler(ListToolsRequestSchema, (request, extra) => {
    if (!toolsListCache) {
      toolsListCache = original(request, extra);
      toolsListCache.catch(() => (toolsListCache = undefined));
    }
    return toolsListCache;
  });
}

async function handleMcp(request: Request, env: Env, ctx?: WaitUntil): Promise<Response> {
  if (request.method === "GET") {
    // A browser opening the URL gets the landing page; MCP clients asking for an SSE stream get 405, which the
    // spec allows for servers without a standalone stream (this one is stateless and never pushes).
    if ((request.headers.get("accept") ?? "").includes("text/html")) return new Response(landingHtml(new URL(request.url).origin, env), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    return rpcError(405, "Method not allowed: this stateless server has no SSE stream; POST JSON-RPC to /mcp.", { Allow: "POST, DELETE, OPTIONS" });
  }
  if (request.method !== "POST" && request.method !== "DELETE") return rpcError(405, "Method not allowed.", { Allow: "POST, DELETE, OPTIONS" });

  const server = buildCargoFlowServer(hostedOptions(env), { mcp: { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() } });
  memoizeToolsList(server);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    // verify_document accepts up to 8 MB as base64 (~10.7 MB of JSON); the SDK's default cap is 4 MiB
    maxRequestBodySize: 12 * 1024 * 1024,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (e) {
    return rpcError(500, `Internal error: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    // JSON mode: the response body is complete by now, so the per-request server can be torn down.
    const done = Promise.allSettled([transport.close(), server.close()]);
    if (ctx) ctx.waitUntil(done);
  }
}

export async function handle(request: Request, env: Env = {}, ctx?: WaitUntil): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  let res: Response;
  if (path === "/mcp") res = await handleMcp(request, env, ctx);
  else if (path === "/" && (request.method === "GET" || request.method === "HEAD")) {
    res = (request.headers.get("accept") ?? "").includes("text/html")
      ? new Response(landingHtml(url.origin, env), { headers: { "Content-Type": "text/html; charset=utf-8" } })
      : jsonResponse(info(url.origin, env));
  } else if (path === "/health" && (request.method === "GET" || request.method === "HEAD")) res = jsonResponse({ ok: true, name: "cargoflow-mcp", version: VERSION });
  else if (path === "/" || path === "/health") res = jsonResponse({ error: "Method not allowed." }, 405, { Allow: "GET, HEAD" });
  else res = jsonResponse({ error: `Not found: ${url.pathname}. The MCP endpoint is ${url.origin}/mcp.` }, 404);
  return withCors(res);
}
