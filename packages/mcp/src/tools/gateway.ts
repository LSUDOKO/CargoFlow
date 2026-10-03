// The gateway tool exists only when a gateway key file is configured locally (CARGOFLOW_GATEWAY_KEY_FILE). The key
// file's Ed25519 seed signs telemetry for the one shipment it was issued for; it is read when the tool runs and is
// never returned, logged or sent anywhere (only signatures are).
import { readFile, stat } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { csv, gateway } from "@cargoflow/sdk";
import { z } from "zod";
import type { Ctx } from "../context.js";
import { Refusal, safe, temp, text, unix } from "../format.js";

const MAX_CSV = 20 * 1024 * 1024;

export function registerGatewayTools(server: McpServer, ctx: Ctx) {
  if (!ctx.gatewayKeyFile) return;
  const keyPath = ctx.gatewayKeyFile;

  server.registerTool(
    "submit_readings_csv",
    {
      title: "Submit logger readings from a CSV",
      description:
        "Parse a data-logger CSV export on this computer, check every row (units, time zone, duplicates, future timestamps, the gateway's registered sensors) and submit the readings to CargoFlow signed with the configured gateway key, in batches of at most 500. Use dryRun first to preview what would be sent. Columns are detected from the header (timestamp, sensor_id, temperature_c, humidity_pct, latitude, longitude, shock_g and common synonyms; °F is converted).",
      inputSchema: {
        path: z.string().min(1).describe("Absolute path of the CSV file."),
        dryRun: z.boolean().optional().describe("Only parse and summarise; send nothing."),
        sensorId: z.string().optional().describe("For single-probe exports without a sensor column: the sensor every row belongs to."),
        timeZone: z.string().optional().describe("IANA zone or offset for timestamps without one, e.g. Asia/Kolkata or +05:30. Default UTC."),
        dateOrder: z.enum(["dmy", "mdy"]).optional().describe("For dates like 03/04/2027: day first (dmy) or month first (mdy)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    safe(async ({ path, dryRun, sensorId, timeZone, dateOrder }) => {
      let key: gateway.KeyFile;
      try {
        key = gateway.decodeKeyFile(await readFile(keyPath, "utf8"));
      } catch (e) {
        throw new Refusal(`The gateway key file at ${keyPath} could not be used: ${(e as Error).message}`);
      }
      const st = await stat(path).catch(() => {
        throw new Refusal(`No readable file at ${path}.`);
      });
      if (st.size > MAX_CSV) throw new Refusal("The CSV is larger than 20 MB; split it.");
      const view = await ctx.client.shipments.get(key.shipmentId).catch(() => null);
      const p = view?.shipment.policy;
      const parsed = csv.parseReadingsCsv(await readFile(path, "utf8"), {
        nowSec: ctx.now(),
        band: p ? { minC: p.minTempX100 / 100, maxC: p.maxTempX100 / 100 } : undefined,
        sensors: key.sensorIds.length ? key.sensorIds : undefined,
        sensorId,
        timeZone,
        dateOrder,
        ...(sensorId ? { mapping: { sensor_id: null } } : {}),
      });
      const s = parsed.summary;
      const head = [
        `Gateway ${key.label || key.sourceId} (${key.sourceId}) for shipment ${view?.shipment.externalRef ?? ""} ${key.shipmentId}`,
        `Parsed ${s.count} reading(s) from ${unix(s.from ?? 0)} to ${unix(s.to ?? 0)}; per sensor: ${Object.entries(s.perSensor).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}.`,
        p ? `${s.outOfBand} reading(s) outside the policy band ${temp(p.minTempX100)} to ${temp(p.maxTempX100)}.` : "",
        parsed.notes.fahrenheit ? "Temperatures were read as °F and converted." : "",
        parsed.notes.zoneless ? `${parsed.notes.zoneless} timestamp(s) had no zone and were read in ${parsed.notes.timeZone}.` : "",
        parsed.notes.dateOrderAmbiguous ? `Dates were ambiguous and read as ${parsed.notes.dateOrder}; pass dateOrder if that is wrong.` : "",
      ].filter(Boolean);
      if (parsed.errors.length) {
        const shown = parsed.errors.slice(0, 15).map((e) => `- line ${e.line}: ${e.message}`);
        return text([...head, `Nothing was sent: ${parsed.errors.length} row(s) need fixing first:`, ...shown, parsed.errors.length > 15 ? `... and ${parsed.errors.length - 15} more.` : ""].filter(Boolean).join("\n"));
      }
      if (dryRun || s.count === 0) return text([...head, dryRun ? "Dry run: nothing was sent." : "Nothing to send."].join("\n"));
      const r = await gateway.submitReadings(key, parsed.points, { client: ctx.client, now: ctx.now });
      const decisions = r.epochs.map((e) => `- milestone ${e.milestoneIndex === 255 ? "none" : e.milestoneIndex + 1} seq ${e.sequence}: score ${e.score}, ${e.action}${e.reasons.length ? ` (${e.reasons.join(", ")})` : ""}${e.releaseTx ? `, released in ${e.releaseTx}` : ""}${e.pauseTx ? `, paused in ${e.pauseTx}` : ""}`);
      return text(
        [
          ...head,
          `Sent in ${r.batches} signed batch(es): ${r.accepted} accepted, ${r.rejected.length} rejected.`,
          ...r.rejected.slice(0, 10).map((x) => `- rejected ${x.sensorId} at ${unix(x.timestamp)}: ${x.reason}`),
          decisions.length ? `Epochs evaluated:\n${decisions.join("\n")}` : "No epoch closed yet.",
        ].join("\n"),
      );
    }),
  );
}
