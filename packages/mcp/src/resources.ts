import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./context.js";

export function registerResources(server: McpServer, ctx: Ctx) {
  server.registerResource(
    "shipment",
    new ResourceTemplate("cargoflow://shipment/{id}", {
      list: async () => {
        const r = await ctx.client.shipments.list({ limit: 25 });
        return { resources: r.shipments.map((s) => ({ uri: `cargoflow://shipment/${s.id}`, name: `${s.externalRef} (${s.status})`, mimeType: "application/json" })) };
      },
    }),
    { title: "CargoFlow shipment", description: "A shipment's combined view (shipment, milestones, facility, latest evidence, cover) as JSON.", mimeType: "application/json" },
    async (uri, vars) => {
      const id = String(Array.isArray(vars.id) ? vars.id[0] : vars.id);
      const v = await ctx.client.shipments.get(id);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ ...v, dashboard: ctx.shipmentUrl(id) }, null, 2) }] };
    },
  );

  server.registerResource(
    "config",
    "cargoflow://config",
    { title: "CargoFlow configuration", description: "Chain id, contract addresses (with coverPool on v2), enabled integrations, and the API and web app this server uses.", mimeType: "application/json" },
    async (uri) => {
      const cfg = await ctx.config();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ apiUrl: ctx.apiUrl, appUrl: ctx.appUrl, contractsVersion: cfg.contracts.deviceRegistry || cfg.contracts.eblRegistry ? "v3" : cfg.contracts.coverPool ? "v2" : "v1", gatewayKeyConfigured: !!ctx.gatewayKeyFile, ...cfg }, null, 2),
          },
        ],
      };
    },
  );
}
