// Cloudflare Workers entry for the public remote MCP server (https://cargoflow-mcp.adoranto737.workers.dev/mcp).
// Workers only allows handler objects as named exports of the main module, so all helpers live in hosted.ts.
import { handle, type Env } from "./hosted.js";

export default {
  fetch: (request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) => handle(request, env, ctx),
};
