#!/usr/bin/env node
// stdio by default (for Claude Desktop, Claude Code, Cursor); Streamable HTTP with --http <port>.
import { createServer, type IncomingMessage } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { parseArgs, usage } from "./options.js";
import { createCargoFlowServer, VERSION } from "./server.js";

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2), process.env);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.http === undefined) {
    const server = createCargoFlowServer(args.options);
    await server.connect(new StdioServerTransport());
    console.error(`cargoflow-mcp ${VERSION} on stdio (API ${args.options.apiUrl ?? "default"})`);
    return;
  }
  // Stateless Streamable HTTP: a fresh server and transport per request, so requests never share state.
  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("CargoFlow MCP: POST /mcp\n");
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST", "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
      return;
    }
    try {
      const body = await readJson(req);
      const server = createCargoFlowServer(args.options);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      if (!res.headersSent) res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: (e as Error).message }, id: null }));
    }
  });
  http.listen(args.http, args.host, () => console.error(`cargoflow-mcp ${VERSION} on http://${args.host}:${args.http}/mcp`));
}

function readJson(req: IncomingMessage, limit = 4 * 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("Request body too large."));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined);
      } catch {
        reject(new Error("Parse error: the body is not JSON."));
      }
    });
    req.on("error", reject);
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
