// Runtime-neutral server factory: no node:* imports, so it bundles for Cloudflare Workers and browsers. The Node
// entry (server.ts) adds local file access and the gateway tool on top of it.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerOptions as McpServerOptions } from "@modelcontextprotocol/sdk/server/index.js";
import { makeContext, type Ctx, type LocalFileReader, type ServerOptions } from "./context.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { registerPrepareTools } from "./tools/prepare.js";
import { registerReadTools } from "./tools/read.js";

export const VERSION = "0.1.0";

const INSTRUCTIONS = `CargoFlow finances temperature-controlled cargo in milestones: sensor evidence is scored, committed on chain, and
releases, pauses and settlement follow it. Use the read tools to look things up (list_shipments, get_shipment,
explain_shipment, get_evidence, get_pricing, get_epcis, get_ebl, fleet_risk_summary, ...). The prepare_* tools never sign or send anything: they check the
shipment's state and return unsigned transactions plus a CargoFlow link, which the person signs with their own wallet.
Amounts are USDG (6 decimals); temperatures are °C.`;

export interface CoreExtras {
  /** local file access for verify_document's path mode (ignored when hosted) */
  readLocalFile?: LocalFileReader;
  /** registers extra tools (the Node entry adds the gateway tool here) */
  register?: (server: McpServer, ctx: Ctx) => void;
  /** low-level MCP server options, e.g. a Workers-safe jsonSchemaValidator */
  mcp?: Pick<McpServerOptions, "jsonSchemaValidator">;
}

/** Builds a CargoFlow MCP server without touching the file system. It holds no private keys and never signs. */
export function buildCargoFlowServer(options: ServerOptions = {}, extras: CoreExtras = {}) {
  const ctx = makeContext(options, extras.readLocalFile);
  const server = new McpServer({ name: "cargoflow", title: "CargoFlow", version: VERSION }, { instructions: INSTRUCTIONS, ...extras.mcp });
  registerReadTools(server, ctx);
  registerPrepareTools(server, ctx);
  extras.register?.(server, ctx);
  registerResources(server, ctx);
  registerPrompts(server);
  return server;
}
