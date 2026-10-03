// Links and builders for the developer surfaces (/docs, /developers, /deployments, "Use with Claude").
import { API_URL } from "@/lib/api/client";

/** The hosted remote MCP server (Streamable HTTP; read and prepare tools; never holds keys). */
export const MCP_URL = (process.env.NEXT_PUBLIC_MCP_URL || "https://cargoflow-mcp.adoranto737.workers.dev/mcp").replace(/\/+$/, "");

export const PUBLIC_API_URL = "https://cargoflow-api-75ul.onrender.com";
export const PUBLIC_SITE_URL = "https://cargoflow.adoranto737.workers.dev";
export const GITHUB_URL = "https://github.com/LSUDOKO/CargoFlow";

/** The API base shown in docs: the one this build talks to, unless that is a local default. */
export const DOCS_API_URL = /127\.0\.0\.1|localhost/.test(API_URL) ? PUBLIC_API_URL : API_URL;

/** claude.ai has no add-connector deep link: the settings page is where custom connectors are added. */
/** Opens claude.ai straight on its "Add custom connector" dialog; paste the MCP URL there. */
export const CLAUDE_CONNECTORS_URL = "https://claude.ai/new?modal=add-custom-connector";

/** A new Claude chat with the prompt filled in. */
export const claudeNewChat = (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;

/** Cursor's MCP install link (cursor.com/docs/context/mcp/install-links): config is the base64 of the server's JSON. */
export function cursorInstallLink(url = MCP_URL): string {
  const config = typeof btoa === "function" ? btoa(JSON.stringify({ url })) : Buffer.from(JSON.stringify({ url })).toString("base64");
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=cargoflow&config=${encodeURIComponent(config)}`;
}

export const CLAUDE_CODE_REMOTE = `claude mcp add --transport http cargoflow ${MCP_URL}`;
export const CLAUDE_CODE_LOCAL = "claude mcp add cargoflow -- npx -y @cargoflow/mcp";

export const CLAUDE_DESKTOP_JSON = JSON.stringify(
  { mcpServers: { cargoflow: { command: "npx", args: ["-y", "@cargoflow/mcp"], env: { CARGOFLOW_API_URL: PUBLIC_API_URL } } } },
  null,
  2,
);

export const STARTER_PROMPTS = [
  { label: "Live shipments", prompt: "Using the CargoFlow connector, list the live shipments and explain any that are paused." },
  { label: "Fleet risk", prompt: "Using the CargoFlow connector, summarise the risk across the CargoFlow fleet: paused or disputed shipments, excursions, cover and what each party should do next." },
  { label: "Financing market", prompt: "Using the CargoFlow connector, show the open financing requests with their fee guidance and the best offers." },
];

export const shipmentPrompt = (id: string, ref?: string) =>
  `Using the CargoFlow connector (enable it under Settings → Connectors first: ${MCP_URL}), explain shipment ${id}${ref ? ` (${ref})` : ""}: where it is, why it is in its current state, the evidence behind it and who should act next.`;
