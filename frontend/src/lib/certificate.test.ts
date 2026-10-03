import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFRawStream, PDFArray } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { AttestedDocument } from "@/lib/api/extras";
import { AuditList, EpochList, ShipmentView } from "@/lib/api/schemas";
import { buildCertificate, certificateFileName, certificateTitle, pdfSafe } from "./certificate";

const ID = "0x" + "4d".repeat(32);
const tx = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const policy = { minTempX100: 200, maxTempX100: 800, maxGapSec: 1800, maxRouteDeviationM: 25000, minEvidenceScore: 75, maxConflictBps: 3000, maxRiskBps: 3500, requiresZk: false, minSensors: 2 };

function fixture(status: string, epochCount = 6) {
  const view = ShipmentView.parse({
    shipment: {
      id: ID, externalRef: "CF-PHARMA-0042", exporter: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", buyer: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
      financier: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", invoiceHash: tx(0xabc), routeCommitment: tx(0xdef), policyCommitment: tx(0x123),
      invoiceValue: "100000000000", policy, route: [{ latE6: 51_900_000, lonE6: 4_400_000 }], status, createdAt: "2026-09-30T08:00:00Z", updatedAt: "2026-10-02T08:00:00Z",
    },
    milestones: Array.from({ length: 5 }, (_, i) => ({
      index: i, description: ["Loaded at Rotterdam", "Departed port", "Mid-Atlantic", "Arrived Santos", "Delivered to buyer"][i], allocatedUsdg: "8000000000",
      evidenceThreshold: 75, checkpointCommitment: tx(i), released: status === "SETTLED" || i < 2, releaseTxHash: status === "SETTLED" || i < 2 ? tx(100 + i) : undefined,
      releasedAt: status === "SETTLED" || i < 2 ? "2026-10-01T10:00:00Z" : undefined,
    })),
    facility: {
      status, exporter: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", financier: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", buyer: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
      committed: "40000000000", drawn: status === "SETTLED" ? "40000000000" : "16000000000", remaining: status === "SETTLED" ? "0" : "24000000000", feeBps: 250,
      nextMilestone: status === "SETTLED" ? 5 : 2, milestoneCount: 5, pausedAt: 0, pauseCount: 1, funded: true, vaultPaused: false, closed: status === "SETTLED",
    },
    latestEvidence: null, quarantinedReadings: 0, usdgDecimals: 6,
  });
  const epochs = EpochList.parse({
    epochs: Array.from({ length: epochCount }, (_, i) => ({
      sequence: i + 1, milestoneIndex: Math.min(i, 4), epochId: tx(500 + i), root: tx(900 + i), readingCount: 16, startTime: 1790000000 + i * 40, endTime: 1790000040 + i * 40,
      score: i === 2 ? 41 : 92, conflictBps: 400, riskBps: 900, compliant: i !== 2, penalties: null, decisionPass: i !== 2, decisionAction: i === 2 ? "PAUSE" : "RELEASE", reasons: null,
      commitTx: tx(700 + i), proofVerified: i === 3, createdAt: "2026-10-01T10:00:00Z",
    })),
  }).epochs;
  const audit = AuditList.parse({
    entries: [
      { time: "2026-10-01T09:00:00Z", kind: "chain_event", title: "FacilityCreated", txHash: tx(1) },
      { time: "2026-10-01T11:00:00Z", kind: "chain_event", title: "FinancingResumed", txHash: tx(2) },
      { time: "2026-10-01T12:00:00Z", kind: "monitoring", title: "PAUSE out_of_band" },
    ],
  }).entries;
  const documents: AttestedDocument[] = [
    { id: "d1", kind: "invoice", name: "invoice-CF-PHARMA-0042.pdf", sizeBytes: 182_331, sha256: tx(0x5a5a), keccak256: tx(0xabc), signer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", role: "exporter", createdAt: "2026-09-30T09:00:00Z", matchesInvoiceHash: true },
    { id: "d2", kind: "bill_of_lading", name: "MSKU-bill-of-lading.pdf", sizeBytes: 2_100_000, sha256: tx(0x6b6b), keccak256: tx(0x7c7c), signer: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", role: "buyer", createdAt: "2026-10-01T09:00:00Z", matchesInvoiceHash: false },
  ];
  return { view, epochs, audit, documents };
}

/** Every page content stream, inflated, concatenated. */
async function contentText(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  let out = "";
  for (const page of doc.getPages()) {
    const contents = page.node.get(PDFName.of("Contents"));
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    for (const r of refs) {
      const stream = doc.context.lookup(r);
      if (stream instanceof PDFRawStream) {
        const raw = stream.getContents();
        out += stream.dict.get(PDFName.of("Filter")) ? inflateSync(raw).toString("latin1") : Buffer.from(raw).toString("latin1");
      }
    }
  }
  return out;
}
const hexOf = (s: string) => Buffer.from(s, "latin1").toString("hex").toUpperCase();

describe("settlement certificate", () => {
  it("is a valid PDF with the expected pages, title and reference", async () => {
    const { view, epochs, audit, documents } = fixture("SETTLED");
    const out = await buildCertificate({ view, epochs, audit, documents, chainId: 46630, generatedAt: new Date("2026-10-03T12:00:00Z"), trackUrl: `https://cargoflow.example/track/${ID}` });
    expect(Buffer.from(out.bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPageCount()).toBe(out.pages);
    expect(out.pages).toBe(3);
    expect(out.title).toBe("Settlement certificate");
    expect(doc.getTitle()).toBe("CargoFlow Settlement certificate CF-PHARMA-0042");
    const text = await contentText(out.bytes);
    expect(text).toContain(hexOf("CF-PHARMA-0042"));
    expect(text).toContain(hexOf("Residual to the exporter"));
    expect(text).toContain(hexOf("Page 3 of 3"));
  });

  it("is titled Shipment record until settled, and grows pages with the evidence", async () => {
    const { view, epochs, audit, documents } = fixture("ACTIVE", 60);
    const out = await buildCertificate({ view, epochs, audit, documents, generatedAt: new Date("2026-10-03T12:00:00Z") });
    expect(out.title).toBe("Shipment record");
    expect(certificateTitle(view)).toBe("Shipment record");
    expect(certificateFileName(view)).toBe("cargoflow-shipment-record-CF-PHARMA-0042.pdf");
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPageCount()).toBe(out.pages);
    expect(out.pages).toBe(4);
    expect(await contentText(out.bytes)).toContain(hexOf("Projected with the current drawdown"));
  });

  it("never throws on characters the standard fonts cannot encode", () => {
    expect(pdfSafe("2–8 °C → ok ≥ 75 ✓ 漢")).toBe("2–8 °C -> ok >= 75 ? ?");
  });
});
