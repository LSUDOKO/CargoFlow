import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "daily-risk-review",
    {
      title: "Daily fleet risk review",
      description: "Review every live CargoFlow shipment (or one party's) for pauses, disputes, place holds, weak evidence and temperature trends, and say who should act.",
      argsSchema: { party: z.string().optional().describe("Only this wallet's shipments (0x address).") },
    },
    ({ party }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Run my daily CargoFlow risk review${party ? ` for ${party}` : ""}.`,
              `1. Call fleet_risk_summary${party ? ` with party ${party}` : ""}.`,
              "2. For every paused, disputed or held shipment, call explain_shipment and summarise the cause with its numbers.",
              "3. For shipments with weak evidence or a temperature heading out of band, call get_evidence and say whether it is getting worse.",
              "4. End with a short action list: who (exporter, financier, buyer, insurer, arbiter) should do what today, and which prepare_* tool or dashboard link helps. Do not prepare transactions unless I ask.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "explain-pause",
    {
      title: "Explain this pause",
      description: "Explain why a shipment's financing is paused, what evidence caused it, and the ways to resume it.",
      argsSchema: { shipmentId: z.string().describe("The shipment id (0x + 64 hex).") },
    },
    ({ shipmentId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Explain why CargoFlow shipment ${shipmentId} is paused.`,
              "1. Call explain_shipment, then get_evidence for the epochs around the pause.",
              "2. Say in plain words what was measured (sensor, temperature range, score, conflict, risk, humidity or shock) against which policy limit.",
              "3. List the ways forward with who can take them: a ZK recovery from fresh in-band readings (prepare_resume_with_proof, needs the exporter's signature), an arbiter's decision, or a dispute (prepare_open_dispute). Note that a humidity or shock pause cannot be cleared by a temperature proof.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
