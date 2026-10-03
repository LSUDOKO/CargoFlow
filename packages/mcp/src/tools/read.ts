// Read-only tools: they call public API endpoints (and one on-chain read) and never change anything.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { contracts, hashDocument, verifyDocument, type Bill, type ShipmentView, type Explanation } from "@cargoflow/sdk";
import { z } from "zod";
import type { Ctx } from "../context.js";
import { coord, humidity, json, km, pct, Refusal, safe, shock, temp, text, unix, usdg } from "../format.js";

export const shipmentId = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "a shipment id is 0x followed by 64 hex characters")
  .describe("The shipment id: 0x followed by 64 hex characters (from list_shipments).");
export const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "an address is 0x followed by 40 hex characters");

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const MAX_FILE = 200 * 1024 * 1024;
const MAX_HOSTED_FILE = 8 * 1024 * 1024;

/** Decodes base64 (standard or URL-safe, with or without padding or a data: prefix) without Node's Buffer. */
export function decodeBase64(b64: string, maxBytes: number): Uint8Array {
  const clean = b64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Refusal("contentBase64 is not valid base64.");
  if (Math.floor((clean.replace(/=+$/, "").length * 3) / 4) > maxBytes) throw new Refusal(`The content is larger than ${maxBytes / 1024 / 1024} MB; pass its sha256 or keccak256 instead.`);
  let bin: string;
  try {
    bin = atob(clean.padEnd(Math.ceil(clean.length / 4) * 4, "="));
  } catch {
    throw new Refusal("contentBase64 is not valid base64.");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** One-paragraph summary of a shipment view (shared with resources and fleet_risk_summary). */
export function describeShipment(v: ShipmentView, ctx: Ctx): string {
  const s = v.shipment;
  const f = v.facility;
  const p = s.policy;
  const lines = [
    `Shipment ${s.externalRef} (${s.id})`,
    `Status: ${f?.status ?? s.status}${f?.status === "PAUSED" && f.pauseReason ? ` (reason: ${f.pauseReason})` : ""}`,
    `Exporter ${s.exporter} · Buyer ${s.buyer}${s.financier ? ` · Financier ${s.financier}` : ""}`,
    `Invoice ${usdg(s.invoiceValue)} · on-chain invoice hash ${s.invoiceHash}`,
    `Policy: ${temp(p.minTempX100)} to ${temp(p.maxTempX100)}, max gap ${Math.round(p.maxGapSec / 60)} min, route deviation ≤ ${km(p.maxRouteDeviationM)}, ` +
      `min evidence score ${p.minEvidenceScore}, conflict ≤ ${pct(p.maxConflictBps)}, risk ≤ ${pct(p.maxRiskBps)}, ${p.minSensors} sensors` +
      `${p.maxHumidityX100 ? `, humidity ≤ ${humidity(p.maxHumidityX100)}` : ""}${p.maxShockX100 ? `, shock ≤ ${shock(p.maxShockX100)}` : ""}${p.requiresZk ? ", ZK proof required" : ""}`,
  ];
  if (f) {
    lines.push(
      `Facility: committed ${usdg(f.committed)}, drawn ${usdg(f.drawn)}, remaining ${usdg(f.remaining)}, fee ${pct(f.feeBps)}, ` +
        `milestone ${Math.min(f.nextMilestone + 1, f.milestoneCount)} of ${f.milestoneCount} next${f.nextMilestone >= f.milestoneCount ? " (all released)" : ""}, ` +
        `paused ${f.pauseCount} time(s)${f.funded ? "" : ", not yet funded"}`,
    );
  } else lines.push("Facility: none yet (no financing opened).");
  if (v.milestones.length) {
    lines.push("Milestones:");
    for (const m of v.milestones) {
      const place = m.radiusM ? ` · must be within ${km(m.radiusM)} of ${m.placeLabel || coord(m.latE6 ?? 0, m.lonE6 ?? 0)}` : "";
      lines.push(`  ${m.index + 1}. ${usdg(m.allocatedUsdg)}, score ≥ ${m.evidenceThreshold}${place} · ${m.released ? `released ${m.releasedAt ?? ""}` : "not released"}`);
    }
  }
  const e = v.latestEvidence;
  if (e) {
    lines.push(
      `Latest evidence: milestone ${e.milestoneIndex === 255 ? "none (observed while paused)" : e.milestoneIndex + 1}, score ${e.score}, conflict ${pct(e.conflictBps)}, risk ${pct(e.riskBps)}, ` +
        `${e.compliant ? "compliant" : "NOT compliant"}, decision ${e.decisionAction}${e.reasons.length ? ` (${e.reasons.join(", ")})` : ""}, ${unix(e.endTime)}`,
    );
  }
  if (v.quarantinedReadings) lines.push(`Quarantined readings: ${v.quarantinedReadings}`);
  if (v.cover) lines.push(`Default cover: ${usdg(v.cover.amount)} by ${v.cover.insurer}, ${v.cover.status}`);
  if (v.openCoverOffers) lines.push(`Open cover offers: ${v.openCoverOffers} (details with get_cover)`);
  lines.push(`Dashboard: ${ctx.shipmentUrl(s.id)}`);
  return lines.join("\n");
}

export function describeExplanation(x: Explanation): string {
  const lines = [`${x.status}: ${x.headline}`];
  if (x.causes.length) lines.push("Why:", ...x.causes.map((c) => `  - ${c}`));
  if (x.hold) lines.push(`Held: ${x.hold.message || `milestone ${x.hold.milestoneIndex + 1} waits until the cargo is within ${km(x.hold.radiusM)} of ${x.hold.placeLabel || coord(x.hold.latE6, x.hold.lonE6)}; it is ${km(x.hold.distanceM)} away`}`);
  if (x.forecast) {
    const f = x.forecast;
    const eta = f.minutesToLimit === null ? "" : f.minutesToLimit <= 0 ? ", already outside the band" : `, about ${f.minutesToLimit} min to the band edge`;
    lines.push(`Forecast: ${f.sensorId} ${f.trend}${eta}`);
  }
  if (x.nextSteps.length) lines.push("Who can do what next:", ...x.nextSteps.map((n) => `  - ${n.role}: ${n.action}`));
  lines.push(`(wording: ${x.source === "ai" ? "rule facts reworded by the model" : "rules"})`);
  return lines.join("\n");
}

export function registerReadTools(server: McpServer, ctx: Ctx) {
  const c = ctx.client;

  server.registerTool(
    "list_shipments",
    {
      title: "List shipments",
      description:
        "List CargoFlow shipments (trade-finance facilities for temperature-controlled cargo), newest first. Filter by status (e.g. PAUSED, DISPUTED, ACTIVE, SETTLED), by a party's wallet address, or by the exact external reference. Returns one line per shipment with its id; use get_shipment for details.",
      inputSchema: {
        status: z.array(z.string()).optional().describe("Statuses to include, e.g. [\"PAUSED\", \"DISPUTED\"]. Omit for all."),
        party: address.optional().describe("Only shipments where this wallet is the exporter, financier or buyer."),
        ref: z.string().max(128).optional().describe("Exact external reference, e.g. CF-2026-SG01 (case-insensitive)."),
        limit: z.number().int().min(1).max(200).optional().describe("How many (default 20, at most 200)."),
        offset: z.number().int().min(0).optional(),
      },
      annotations: READ,
    },
    safe(async (a) => {
      const r = await c.shipments.list({ status: a.status?.map((s) => s.toUpperCase()), party: a.party, ref: a.ref, limit: a.limit ?? 20, offset: a.offset });
      if (!r.shipments.length) return text("No shipments match.");
      const lines = r.shipments.map((s) => `- ${s.externalRef} · ${s.status} · invoice ${usdg(s.invoiceValue)} · exporter ${s.exporter} · created ${s.createdAt.slice(0, 10)}\n  id ${s.id}`);
      return text(`${r.shipments.length} shipment(s) (offset ${r.offset}):\n${lines.join("\n")}`);
    }),
  );

  server.registerTool(
    "get_shipment",
    {
      title: "Get a shipment",
      description:
        "Full state of one shipment: parties, invoice, cold-chain policy, facility (committed, drawn, fee, pause state), milestones (with v2 places), latest evidence epoch and default cover. Combines the backend's mirror with live chain state.",
      inputSchema: { shipmentId },
      annotations: READ,
    },
    safe(async ({ shipmentId: id }) => {
      const v = await c.shipments.get(id);
      return text(describeShipment(v, ctx), json(v));
    }),
  );

  server.registerTool(
    "explain_shipment",
    {
      title: "Explain a shipment",
      description:
        "Why a shipment is where it is, in plain words: headline, causes with their numbers (score, conflict, risk, temperature band, gaps, route, place holds), a temperature forecast, and who can do what next. Use this to answer 'why is it paused?' or 'what happens next?'.",
      inputSchema: { shipmentId },
      annotations: READ,
    },
    safe(async ({ shipmentId: id }) => text(describeExplanation(await c.shipments.explanation(id)))),
  );

  server.registerTool(
    "get_evidence",
    {
      title: "Get evidence epochs",
      description:
        "The shipment's evidence epochs, newest first: per epoch the milestone, evidence score, sensor conflict and risk, compliance, the decision (APPROVE_ADVANCE, PAUSE_FACILITY, HELD_NOT_AT_PLACE, ...) with reasons, the commit transaction, committed aggregates (centroid, humidity and shock maxima), and per-sensor min/mean/max temperature. Raw readings are never exposed.",
      inputSchema: { shipmentId, limit: z.number().int().min(1).max(100).optional().describe("Newest epochs to show (default 20).") },
      annotations: READ,
    },
    safe(async ({ shipmentId: id, limit }) => {
      const [ep, tel] = await Promise.all([c.shipments.epochs(id), c.shipments.telemetry(id).catch(() => null)]);
      const sensors = new Map((tel?.epochs ?? []).map((t) => [t.epochId, t.sensors]));
      const epochs = [...ep.epochs].sort((a, b) => b.endTime - a.endTime || b.sequence - a.sequence).slice(0, limit ?? 20);
      if (!epochs.length) return text("No evidence epochs yet.");
      const lines = epochs.map((e) => {
        const s = (sensors.get(e.epochId) ?? []).map((x) => `${x.sensorId} ${temp(x.minTempX100)}..${temp(x.maxTempX100)} (mean ${temp(x.meanTempX100)}, ${x.readings} readings)`).join("; ");
        const agg = e.latE6 || e.lonE6 ? ` · centroid ${coord(e.latE6 ?? 0, e.lonE6 ?? 0)}` : "";
        const hs = e.maxHumidityX100 || e.maxShockX100 ? ` · max ${humidity(e.maxHumidityX100)}, ${shock(e.maxShockX100)}` : "";
        return (
          `- ${unix(e.startTime)}..${unix(e.endTime)} · milestone ${e.milestoneIndex === 255 ? "none" : e.milestoneIndex + 1} seq ${e.sequence} · score ${e.score} · conflict ${pct(e.conflictBps)} · risk ${pct(e.riskBps)} · ` +
          `${e.compliant ? "compliant" : "NOT compliant"} · ${e.decisionAction}${e.reasons.length ? ` (${e.reasons.join(", ")})` : ""}${e.heldDistanceM ? ` · ${km(e.heldDistanceM)} from the milestone place` : ""}` +
          `${agg}${hs}${e.commitTx ? ` · committed ${e.commitTx}` : " · not committed"}${e.proofVerified ? " · ZK proof verified" : ""}${s ? `\n  sensors: ${s}` : ""}`
        );
      });
      return text(`${ep.epochs.length} epoch(s); newest ${epochs.length}:\n${lines.join("\n")}`);
    }),
  );

  server.registerTool(
    "get_track",
    {
      title: "Get the route track",
      description: "The shipment's track: one centroid per evidence epoch, oldest first, with the temperature range and whether the epoch passed and was committed on chain. Aggregates only.",
      inputSchema: { shipmentId },
      annotations: READ,
    },
    safe(async ({ shipmentId: id }) => {
      const t = await c.shipments.track(id);
      if (!t.points.length) return text("No track points yet.");
      const lines = t.points.map(
        (p) => `- ${unix(p.endTime)} · ${coord(p.latE6, p.lonE6)} · ${temp(p.minTempX100)}..${temp(p.maxTempX100)} · ${p.pass ? "pass" : "FAIL"}${p.committed ? "" : " (not committed)"} · milestone ${p.milestoneIndex === 255 ? "none" : p.milestoneIndex + 1}`,
      );
      return text(`${t.points.length} point(s), oldest first:\n${lines.join("\n")}`);
    }),
  );

  server.registerTool(
    "get_audit",
    {
      title: "Get the audit trail",
      description: "The shipment's merged, time-ordered audit trail: chain events (registration, policy, facility, releases, pauses, proofs, delivery, settlement, cover), evidence decisions, AI monitor assessments and transactions the backend sent.",
      inputSchema: { shipmentId, limit: z.number().int().min(1).max(500).optional().describe("Most recent entries to show (default 50).") },
      annotations: READ,
    },
    safe(async ({ shipmentId: id, limit }) => {
      const a = await c.shipments.audit(id);
      const entries = a.entries.slice(-(limit ?? 50));
      if (!entries.length) return text("The audit trail is empty.");
      return text(`${a.entries.length} entr(ies); most recent ${entries.length}, oldest first:\n${entries.map((e) => `- ${e.time} · ${e.kind} · ${e.title}${e.txHash ? ` · tx ${e.txHash}` : ""}`).join("\n")}`);
    }),
  );

  server.registerTool(
    "get_party",
    {
      title: "Get a party's track record",
      description: "A wallet's CargoFlow track record as exporter (shipments, settled, paused, defaulted, recoveries, average evidence score, volume), financier (facilities, committed, drawn, fees earned), buyer and insurer, with a grade (A, B, C or new).",
      inputSchema: { address: address.describe("The wallet address, 0x followed by 40 hex characters.") },
      annotations: READ,
    },
    safe(async ({ address: a }) => {
      const p = await c.parties.get(a);
      const ex = p.exporter;
      const fi = p.financier;
      const lines = [
        `Party ${p.address} · grade ${p.grade}${p.since ? ` · since ${p.since}` : ""}`,
        `As exporter: ${ex.shipments} shipments, ${ex.settled} settled, ${ex.active} active, ${ex.paused} paused, ${ex.disputed} disputed, ${ex.defaulted} defaulted, ${ex.recoveries} recoveries, avg evidence score ${ex.avgEvidenceScore ?? "–"}, volume ${usdg(ex.volume)}`,
        `As financier: ${fi.facilities} facilities, committed ${usdg(fi.committed)}, drawn ${usdg(fi.drawn)}, in escrow ${usdg(fi.inEscrow)}, fees earned ${usdg(fi.feesEarned)}, ${fi.settled} settled, ${fi.defaulted} defaulted`,
        `As buyer: ${p.buyer.shipments} shipments, ${p.buyer.settled} settled, paid ${usdg(p.buyer.paidVolume)}`,
      ];
      if (p.insurer) lines.push(`As insurer: ${p.insurer.offered} offered, ${p.insurer.active} active, ${p.insurer.released} released, ${p.insurer.claimed} claimed, cover written ${usdg(p.insurer.coverWritten)}, premiums ${usdg(p.insurer.premiumsEarned)}, paid out ${usdg(p.insurer.paidOut)}`);
      return text(lines.join("\n"));
    }),
  );

  server.registerTool(
    "list_market_requests",
    {
      title: "List financing requests",
      description: "The financing marketplace: exporters' requests for capital against registered shipments, newest first, with financiers' fee offers (cheapest first). Filter by status (open, accepted, funded, closed) or exporter.",
      inputSchema: {
        status: z.enum(["open", "accepted", "funded", "closed"]).optional(),
        exporter: address.optional(),
      },
      annotations: READ,
    },
    safe(async (a) => {
      const r = await c.market.list(a);
      if (!r.requests.length) return text(`No ${a.status ?? ""} financing requests.`.replace("  ", " "));
      const lines = r.requests.map(
        (q) =>
          `- ${q.externalRef} · ${q.status} · asks ${usdg(q.amount)} of a ${usdg(q.invoiceValue)} invoice · max fee ${pct(q.maxFeeBps)} · ${q.milestoneCount} milestones · request ${q.id} · shipment ${q.shipmentId}` +
          (q.offers.length ? `\n  offers: ${q.offers.map((o) => `${pct(o.feeBps)} by ${o.financier}${o.accepted ? " (accepted)" : ""}`).join("; ")}` : "") +
          (q.note ? `\n  note: ${q.note}` : ""),
      );
      return text(`${r.requests.length} request(s):\n${lines.join("\n")}\nMarket: ${ctx.portalUrl("market")}`);
    }),
  );

  server.registerTool(
    "get_cover",
    {
      title: "Get default cover",
      description: "Default cover on a shipment (contracts v2): open offers from insurers (amount and premium) and the accepted cover with its status (ACTIVE, RELEASED, CLAIMED) and payouts.",
      inputSchema: { shipmentId },
      annotations: READ,
    },
    safe(async ({ shipmentId: id }) => {
      let cv;
      try {
        cv = await c.shipments.cover(id);
      } catch (e) {
        if ((e as { status?: number }).status === 404) {
          const cfg = await ctx.config().catch(() => null);
          if (cfg && !cfg.contracts.coverPool) return text("This CargoFlow deployment runs contracts v1, which has no default cover. Cover becomes available with the v2 deployment.");
        }
        throw e;
      }
      const lines: string[] = [];
      lines.push(cv.cover ? `Cover: ${usdg(cv.cover.amount)} by ${cv.cover.insurer} for financier ${cv.cover.financier}, premium ${usdg(cv.cover.premium)}, ${cv.cover.status}${cv.cover.status === "CLAIMED" ? `, paid ${usdg(cv.cover.financierPayout)} to the financier` : ""}${cv.cover.status !== "ACTIVE" ? `, returned ${usdg(cv.cover.insurerReturn)} to the insurer` : ""}` : "No accepted cover.");
      lines.push(cv.offers.length ? `Open offers:\n${cv.offers.map((o) => `- ${usdg(o.amount)} at ${pct(o.premiumBps)} premium by ${o.insurer}`).join("\n")}` : "No open offers.");
      return text(lines.join("\n"));
    }),
  );

  server.registerTool(
    "get_documents",
    {
      title: "Get attested documents",
      description: "Trade documents attested for a shipment (invoice, bill of lading, packing list, certificates): name, kind, SHA-256 and keccak256, who attested it, and whether its keccak256 equals the on-chain invoice hash. Files are never uploaded, only their hashes.",
      inputSchema: { shipmentId },
      annotations: READ,
    },
    safe(async ({ shipmentId: id }) => {
      const d = await c.shipments.documents(id);
      if (!d.documents.length) return text("No documents are attested for this shipment.");
      return text(
        d.documents
          .map((x) => `- ${x.name} (${x.kind}, ${x.sizeBytes} bytes) attested by ${x.role} ${x.signer} at ${x.createdAt}${x.matchesInvoiceHash ? " · matches the on-chain invoice hash" : ""}\n  sha256 ${x.sha256}\n  keccak256 ${x.keccak256}`)
          .join("\n"),
      );
    }),
  );

  /** Compares a file's hashes with the shipment's attested documents and on-chain invoice hash. */
  async function compareDocument(id: string, label: string, h: { sha256?: string; keccak256?: string; sizeBytes?: number }) {
    const [docs, view] = await Promise.all([c.shipments.documents(id).catch(() => ({ documents: [] })), c.shipments.get(id)]);
    let invoiceHash: string = view.shipment.invoiceHash;
    let source = "the backend's mirror of the chain";
    try {
      const on = await contracts.readOnChainShipment(c.publicClient(), await ctx.addresses(), id as `0x${string}`);
      invoiceHash = on.invoiceHash;
      source = "the ShipmentRegistry contract";
    } catch {
      /* RPC unavailable: fall back to the mirrored value */
    }
    // An empty hash never equals a real one, so a missing sha256 or keccak256 simply cannot match.
    const v = verifyDocument({ sha256: h.sha256 ?? "", keccak256: h.keccak256 ?? "" }, docs.documents, invoiceHash);
    const lines = [
      `${label}${h.sizeBytes !== undefined ? ` (${h.sizeBytes} bytes)` : ""}`,
      h.sha256 ? `sha256 ${h.sha256}` : "",
      h.keccak256 ? `keccak256 ${h.keccak256}` : "",
      v.matchesInvoiceHash
        ? `MATCH: its keccak256 equals the shipment's on-chain invoice hash (read from ${source}). This is the invoice that was registered.`
        : h.keccak256
          ? `No match with the on-chain invoice hash ${invoiceHash} (read from ${source}).`
          : `The on-chain invoice hash ${invoiceHash} (read from ${source}) is a keccak256; pass keccak256 or the file content to compare with it.`,
      v.matches.length
        ? `Attested as: ${v.matches.map((d) => `${d.name} (${d.kind}) by ${d.role} ${d.signer} at ${d.createdAt}`).join("; ")}`
        : `Not among the ${docs.documents.length} attested document(s).`,
    ];
    return text(lines.filter(Boolean).join("\n"));
  }

  if (ctx.hosted || !ctx.readLocalFile) {
    const hex32 = z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/, "a 32-byte hash: 64 hex characters, optionally 0x-prefixed");
    server.registerTool(
      "verify_document",
      {
        title: "Verify a document by hash or content",
        description:
          "Compare a document with the shipment's attested documents and its on-chain invoice hash (read from the ShipmentRegistry contract). Pass the file's sha256 and/or keccak256 (hex), or its content as base64 (hashed here, up to 8 MB; nothing is stored). The on-chain invoice hash is a keccak256. Answers 'is this the invoice that was financed?'.",
        inputSchema: {
          shipmentId,
          sha256: hex32.optional().describe("SHA-256 of the file, hex."),
          keccak256: hex32.optional().describe("keccak256 of the file, hex (what the chain stores as invoiceHash)."),
          contentBase64: z.string().optional().describe("The file's bytes as base64 (instead of hashes), at most 8 MB decoded."),
          name: z.string().optional().describe("File name, for the answer only."),
        },
        annotations: READ,
      },
      safe(async ({ shipmentId: id, sha256, keccak256, contentBase64, name }) => {
        const norm = (x?: string) => (x ? (x.startsWith("0x") ? x : `0x${x}`).toLowerCase() : undefined);
        const label = name ? `File ${name}` : "Document";
        if (contentBase64) {
          const bytes = decodeBase64(contentBase64, MAX_HOSTED_FILE);
          const h = hashDocument(bytes);
          if (sha256 && norm(sha256) !== h.sha256.toLowerCase()) throw new Refusal(`The sha256 you passed does not match the content's sha256 ${h.sha256}.`);
          if (keccak256 && norm(keccak256) !== h.keccak256.toLowerCase()) throw new Refusal(`The keccak256 you passed does not match the content's keccak256 ${h.keccak256}.`);
          return compareDocument(id, label, h);
        }
        if (!sha256 && !keccak256) throw new Refusal("Pass the document's sha256 or keccak256 (hex), or its content as contentBase64.");
        return compareDocument(id, label, { sha256: norm(sha256), keccak256: norm(keccak256) });
      }),
    );
  } else {
    const readLocalFile = ctx.readLocalFile;
    server.registerTool(
      "verify_document",
      {
        title: "Verify a local document",
        description:
          "Hash a file on this computer (SHA-256 and keccak256, locally; the file is not uploaded) and compare it with the shipment's attested documents and its on-chain invoice hash (read from the ShipmentRegistry contract). Answers 'is this the invoice that was financed?'.",
        inputSchema: { shipmentId, path: z.string().min(1).describe("Absolute path of the local file to check.") },
        annotations: READ,
      },
      safe(async ({ shipmentId: id, path }) => {
        const f = await readLocalFile(path, MAX_FILE);
        return compareDocument(id, `File ${f.name}`, hashDocument(f.bytes));
      }),
    );
  }

  server.registerTool(
    "fleet_risk_summary",
    {
      title: "Fleet risk summary",
      description:
        "A risk review across live shipments (optionally one party's): counts by status, every paused or disputed shipment with its explanation headline, shipments whose latest evidence is weak (low score, high conflict or risk, non-compliant) and temperature forecasts heading out of band. Use it for a daily review.",
      inputSchema: {
        party: address.optional().describe("Only this wallet's shipments (as exporter, financier or buyer)."),
        limit: z.number().int().min(1).max(50).optional().describe("Live shipments to examine in detail (default 25)."),
      },
      annotations: READ,
    },
    safe(async ({ party, limit }) => {
      const all = await c.shipments.list({ party, limit: 200 });
      const counts: Record<string, number> = {};
      for (const s of all.shipments) counts[s.status] = (counts[s.status] ?? 0) + 1;
      const live = all.shipments.filter((s) => !["SETTLED", "DEFAULTED"].includes(s.status)).slice(0, limit ?? 25);
      const rows = await mapLimit(live, 5, async (s) => {
        const [v, x] = await Promise.all([c.shipments.get(s.id).catch(() => null), c.shipments.explanation(s.id).catch(() => null)]);
        return { s, v, x };
      });
      const urgent: string[] = [];
      const weak: string[] = [];
      const forecasts: string[] = [];
      for (const { s, v, x } of rows) {
        const status = v?.facility?.status ?? s.status;
        const tag = `${s.externalRef} (${s.id})`;
        if (status === "PAUSED" || status === "DISPUTED") urgent.push(`- ${tag}: ${status}. ${x?.headline ?? ""}${x?.nextSteps[0] ? ` Next: ${x.nextSteps[0].role} — ${x.nextSteps[0].action}` : ""}`);
        const e = v?.latestEvidence;
        if (e && status !== "PAUSED" && (!e.compliant || e.score < s.policy.minEvidenceScore + 5 || e.conflictBps > s.policy.maxConflictBps * 0.8 || e.riskBps > s.policy.maxRiskBps * 0.8)) {
          weak.push(`- ${tag}: score ${e.score} (min ${s.policy.minEvidenceScore}), conflict ${pct(e.conflictBps)}, risk ${pct(e.riskBps)}${e.compliant ? "" : ", not compliant"}`);
        }
        if (x?.hold) urgent.push(`- ${tag}: milestone ${x.hold.milestoneIndex + 1} held ${km(x.hold.distanceM)} from its place.`);
        if (x?.forecast && x.forecast.minutesToLimit !== null && x.forecast.trend !== "steady") {
          forecasts.push(`- ${tag}: ${x.forecast.sensorId} ${x.forecast.trend}, ${x.forecast.minutesToLimit <= 0 ? "outside the band now" : `about ${x.forecast.minutesToLimit} min to the band edge`}`);
        }
      }
      const out = [
        `${all.shipments.length} shipment(s)${party ? ` for ${party}` : ""}: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ") || "none"}. Examined ${rows.length} live.`,
        urgent.length ? `Needs attention:\n${urgent.join("\n")}` : "Nothing paused, disputed or held.",
        weak.length ? `Weak latest evidence:\n${weak.join("\n")}` : "No weak evidence on live shipments.",
        forecasts.length ? `Temperature forecasts:\n${forecasts.join("\n")}` : "No temperature heading out of band.",
      ];
      return text(out.join("\n\n"));
    }),
  );

  server.registerTool(
    "get_pricing",
    {
      title: "Get fee guidance",
      description:
        "CargoFlow's transparent fee guidance for financing a shipment: a low / mid / high fee band in basis points with every factor that moved it (exporter grade, the corridor's excursion and conflict rates, cargo template, cover, tenor, sample size). Deterministic and auditable; financiers still choose the fee.",
      inputSchema: { shipmentId },
      annotations: READ,
    },
    safe(async ({ shipmentId: id }) => {
      const p = await c.pricing.suggest(id);
      const i = p.inputs;
      const lines = [
        `Suggested fee for ${p.shipmentId}: ${pct(p.lowBps)} to ${pct(p.highBps)} (mid ${pct(p.midBps)})`,
        "Why:",
        ...p.reasons.map((r) => `  - ${r.factor}: ${r.bps >= 0 ? "+" : ""}${r.bps} bps${r.detail ? ` (${r.detail})` : ""}`),
        `Inputs: exporter grade ${i.exporterGrade}, corridor excursion rate ${pct(i.routeExcursionRate)}, conflict rate ${pct(i.routeConflictRate)}, cargo ${i.cargoTemplate}, cover ${i.coverStatus}, ` +
          `tenor about ${i.tenorDays} days, corridor sample ${i.corridorShipments} shipment(s) / ${i.corridorEpochs} epoch(s)`,
        `Model: ${p.model || "–"}. Marketplace: ${ctx.portalUrl("market")}`,
      ];
      return text(lines.join("\n"));
    }),
  );

  server.registerTool(
    "get_epcis",
    {
      title: "Get the GS1 EPCIS 2.0 export",
      description:
        "The shipment as a GS1 EPCIS 2.0 JSON-LD document (the supply-chain event standard): commissioning, shipping, one sensor_reporting ObjectEvent per evidence epoch (min/max/mean temperature, humidity, shock, position, score, Merkle root, commit transaction), receiving and financing events. Use it to hand the cold-chain record to an ERP, a customs broker or a GS1-aware system.",
      inputSchema: {
        shipmentId,
        full: z.boolean().optional().describe("Include the complete JSON-LD document (it can be long); default a summary plus the first events."),
      },
      annotations: READ,
    },
    safe(async ({ shipmentId: id, full }) => {
      const d = await c.shipments.epcis(id);
      const events = d.epcisBody.eventList as Record<string, unknown>[];
      const byStep = new Map<string, number>();
      for (const e of events) {
        const step = String(e.bizStep ?? e.type).replace(/^.*[/:]/, "");
        byStep.set(step, (byStep.get(step) ?? 0) + 1);
      }
      const summary = [
        `EPCIS ${d.schemaVersion ?? "2.0"} document for ${id.toLowerCase()}: ${events.length} event(s), created ${d.creationDate ?? "–"}.`,
        `By business step: ${[...byStep].map(([k, n]) => `${k} ${n}`).join(", ") || "none"}.`,
        `Endpoint: ${ctx.apiUrl}/v1/shipments/${id.toLowerCase()}/epcis (application/ld+json).`,
      ].join("\n");
      return text(summary, json(full ? d : { ...d, epcisBody: { eventList: events.slice(0, 3), truncated: events.length > 3 ? events.length - 3 : 0 } }));
    }),
  );

  server.registerTool(
    "get_ebl",
    {
      title: "Get electronic bills of lading",
      description:
        "Electronic bills of lading (contracts v3 EBLRegistry, ERC-721 titles): one bill by token id with its parties, current holder, status (ISSUED, SURRENDERED, VOID), endorsement history and the shipment it is bound to as collateral; or the bills a holder holds; or all bills.",
      inputSchema: {
        tokenId: z.string().regex(/^[0-9]+$/).optional().describe("One bill's token id (decimal)."),
        holder: address.optional().describe("Only the bills this wallet currently holds."),
      },
      annotations: READ,
    },
    safe(async ({ tokenId, holder }) => {
      const describe = (b: Bill) =>
        `- Bill #${b.tokenId} · ${b.status} · holder ${b.holder} · shipper ${b.shipper} · consignee ${/^0x0+$/.test(b.consignee) ? "to order" : b.consignee} · issuer ${b.issuer}` +
        ` · issued ${b.issuedAt}${b.closedAt ? ` · closed ${b.closedAt}` : ""} · ${b.transfers} endorsement(s)${b.boundShipmentId ? ` · collateral for shipment ${b.boundShipmentId}` : ""}\n  document hash ${b.documentHash}`;
      try {
        if (tokenId) {
          const b = await c.ebl.get(tokenId);
          const hist = b.history.map((h) => `  ${h.at}: ${h.from} -> ${h.to} (tx ${h.txHash})`);
          return text([describe(b), ...(hist.length ? ["History:", ...hist] : [])].join("\n"));
        }
        const r = await c.ebl.list({ holder });
        if (!r.bills.length) return text(holder ? `${holder} holds no bills of lading.` : "No bills of lading have been issued.");
        return text(`${r.bills.length} bill(s):\n${r.bills.map(describe).join("\n")}`);
      } catch (e) {
        if ((e as { status?: number }).status === 404 && !tokenId) {
          return text("This CargoFlow deployment has no EBLRegistry (electronic bills of lading arrive with contracts v3).");
        }
        throw e;
      }
    }),
  );
}

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]!);
      }
    }),
  );
  return out;
}
