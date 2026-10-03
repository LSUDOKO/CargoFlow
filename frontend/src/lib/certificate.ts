// The settlement certificate: a real PDF built in the browser with pdf-lib from the same public data the dashboard
// shows (shipment view, committed epochs, audit trail, attested documents). Nothing is sent anywhere.
import { PDFDocument, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage, concatTransformationMatrix, popGraphicsState, pushGraphicsState } from "pdf-lib";
import type { AttestedDocument } from "@/lib/api/extras";
import type { AuditEntry, EpochSummary, ShipmentView } from "@/lib/api/schemas";
import { kindLabel, formatBytes } from "@/lib/documents";
import { chainName, explorerAddress, explorerTx } from "@/lib/explorer";
import { formatBps, formatTempX100, formatUSDG, shortHash } from "@/lib/format";
import { waterfall } from "@/lib/waterfall";

export type CertificateInput = {
  view: ShipmentView;
  epochs: EpochSummary[];
  audit: AuditEntry[];
  documents: AttestedDocument[];
  chainId?: number;
  generatedAt: Date;
  trackUrl?: string;
};

export const isSettled = (view: Pick<ShipmentView, "facility" | "shipment">) => (view.facility?.status ?? view.shipment.status) === "SETTLED";
export const certificateTitle = (view: Pick<ShipmentView, "facility" | "shipment">) => (isSettled(view) ? "Settlement certificate" : "Shipment record");
export const certificateFileName = (view: Pick<ShipmentView, "facility" | "shipment">) =>
  `cargoflow-${isSettled(view) ? "settlement-certificate" : "shipment-record"}-${view.shipment.externalRef.replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf`;

/* ---------- drawing primitives ---------- */

const A4: [number, number] = [595.28, 841.89];
const M = 48; // page margin
const W = A4[0] - 2 * M;
const FOOT = 54; // reserved at the bottom of each page

const C = {
  ink: rgb(11 / 255, 27 / 255, 43 / 255),
  ink3: rgb(29 / 255, 58 / 255, 85 / 255),
  signal: rgb(198 / 255, 244 / 255, 50 / 255),
  paper: rgb(247 / 255, 249 / 255, 244 / 255),
  mist: rgb(238 / 255, 242 / 255, 234 / 255),
  line: rgb(220 / 255, 227 / 255, 218 / 255),
  slate: rgb(91 / 255, 107 / 255, 123 / 255),
  verified: rgb(0, 115 / 255, 62 / 255),
  alert: rgb(138 / 255, 83 / 255, 0),
  danger: rgb(161 / 255, 25 / 255, 30 / 255),
  link: rgb(29 / 255, 78 / 255, 140 / 255),
};

// the CargoFlow mark (public/brand/mark.svg): potrace paths in a y-up space of 0.1 units, x 0..3300, y 420..3720
const MARK = [
  "M1420 3545 c-135 -76 -281 -157 -325 -182 -44 -25 -147 -82 -230 -128 -154 -85 -334 -186 -558 -315 -183 -106 -197 -127 -196 -305 0 -128 9 -179 31 -183 17 -3 116 45 518 251 877 450 999 509 1055 509 63 1 7 29 650 -332 224 -125 365 -204 444 -246 65 -35 113 -32 159 10 l37 34 3 123 c4 145 -1 179 -33 217 -21 25 -193 129 -385 234 -25 13 -146 81 -270 150 -574 319 -519 292 -590 296 l-65 3 -245 -136z",
  "M1777 2803 c-8 -72 -3 -1560 5 -1568 9 -9 80 42 303 214 606 469 566 430 504 484 -220 194 -420 385 -429 410 -5 17 -10 71 -10 121 -1 50 -6 103 -13 118 -11 24 -328 268 -348 268 -4 0 -9 -21 -12 -47z",
  "M1390 2751 c-47 -21 -104 -48 -127 -60 l-43 -21 0 -660 0 -660 23 -13 c45 -28 248 -110 255 -103 7 8 12 1346 5 1479 -5 90 -1 89 -113 38z",
  "M829 2502 c-59 -26 -114 -54 -123 -61 -15 -12 -16 -56 -14 -440 l3 -426 55 -27 c99 -49 200 -89 210 -83 6 4 10 208 10 546 0 507 -1 539 -17 539 -10 0 -66 -22 -124 -48z",
];

/** Standard PDF fonts only encode WinAnsi; anything else becomes "?" instead of throwing. */
export function pdfSafe(text: string): string {
  return text.replace(/[^\x20-\x7E -ÿ–—‘’“”•…€]/g, (ch) => (ch === "\n" || ch === "\t" ? " " : ch === "→" ? "->" : ch === "≥" ? ">=" : ch === "≤" ? "<=" : "?"));
}

type Fonts = { regular: PDFFont; bold: PDFFont; mono: PDFFont };
type Col = { label: string; width: number; mono?: boolean; align?: "right" };
type Cell = string | { text: string; color?: ReturnType<typeof rgb>; bold?: boolean; href?: string | null };

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\s*\r?\n\s*/).map(pdfSafe)) {
    let line = "";
    for (const word of para.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      // a single word wider than the box (a hash): break it by characters
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let n = rest.length;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

class Writer {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    private f: Fonts,
    private title: string,
    private reference: string,
  ) {}

  newPage() {
    this.page = this.doc.addPage(A4);
    this.pages.push(this.page);
    const top = A4[1];
    if (this.pages.length > 1) {
      this.page.drawRectangle({ x: 0, y: top - 34, width: A4[0], height: 34, color: C.ink });
      drawMark(this.page, M, top - 27, 20);
      this.text(pdfSafe(`CargoFlow  ·  ${this.title}  ·  ${this.reference}`), M + 28, top - 21, { size: 9, color: C.paper, font: this.f.bold });
      this.y = top - 34 - 26;
    }
  }

  ensure(h: number) {
    if (this.y - h < FOOT) this.newPage();
  }

  text(s: string, x: number, y: number, o: { size?: number; color?: ReturnType<typeof rgb>; font?: PDFFont } = {}) {
    this.page.drawText(pdfSafe(s), { x, y, size: o.size ?? 9.5, color: o.color ?? C.ink, font: o.font ?? this.f.regular });
  }

  link(x: number, y: number, w: number, h: number, url: string) {
    const ctx = this.doc.context;
    const annot = ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [x, y, x + w, y + h],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
      }),
    );
    this.page.node.addAnnot(annot);
  }

  section(title: string, lede?: string) {
    this.ensure(lede ? 118 : 96); // the heading, its lede and the first rows of what follows stay together
    this.y -= 14;
    this.page.drawRectangle({ x: M, y: this.y - 2, width: 3, height: 13, color: C.signal });
    this.text(title, M + 10, this.y, { size: 12.5, font: this.f.bold });
    this.y -= 8;
    if (lede) {
      for (const line of wrap(lede, this.f.regular, 8.5, W)) {
        this.y -= 11;
        this.text(line, M, this.y, { size: 8.5, color: C.slate });
      }
    }
    this.y -= 10;
  }

  /** Label/value rows in two columns of pairs. */
  pairs(rows: [string, Cell][], cols = 2) {
    const colW = W / cols;
    const labelW = 104;
    for (let i = 0; i < rows.length; i += cols) {
      const slice = rows.slice(i, i + cols);
      const laid = slice.map(([label, cell]) => {
        const c = typeof cell === "string" ? { text: cell } : cell;
        const mono = /^0x[0-9a-fA-F]{8,}$/.test(c.text);
        const font = c.bold ? this.f.bold : mono ? this.f.mono : this.f.regular;
        const size = mono ? 8 : 9.5;
        return { label, c, font, size, lines: wrap(c.text || "–", font, size, colW - labelW - 10) };
      });
      const h = Math.max(...laid.map((l) => l.lines.length)) * 12 + 6;
      this.ensure(h);
      laid.forEach((l, k) => {
        const x = M + k * colW;
        this.text(l.label, x, this.y - 10, { size: 8.5, color: C.slate });
        l.lines.forEach((line, j) => {
          this.text(line, x + labelW, this.y - 10 - j * 12, { size: l.size, font: l.font, color: l.c.color });
        });
        if (l.c.href) this.link(x + labelW, this.y - 13 - (l.lines.length - 1) * 12, colW - labelW - 10, l.lines.length * 12, l.c.href);
      });
      this.y -= h;
    }
    this.y -= 4;
  }

  table(cols: Col[], rows: Cell[][]) {
    const total = cols.reduce((s, c) => s + c.width, 0);
    const widths = cols.map((c) => (c.width / total) * W);
    const header = () => {
      this.ensure(18 + 34); // never leave a header alone at the foot of a page
      this.page.drawRectangle({ x: M, y: this.y - 16, width: W, height: 18, color: C.mist });
      let x = M;
      cols.forEach((c, i) => {
        const tw = this.f.bold.widthOfTextAtSize(c.label, 7.5);
        this.text(c.label.toUpperCase(), c.align === "right" ? x + widths[i]! - 6 - tw * 1.08 : x + 6, this.y - 10.5, { size: 7.5, font: this.f.bold, color: C.slate });
        x += widths[i]!;
      });
      this.y -= 18;
    };
    header();
    for (const row of rows) {
      const laid = row.map((cell, i) => {
        const c = typeof cell === "string" ? { text: cell } : cell;
        const font = c.bold ? this.f.bold : cols[i]!.mono ? this.f.mono : this.f.regular;
        const size = cols[i]!.mono ? 7.5 : 8.5;
        return { c, font, size, lines: wrap(c.text || "–", font, size, widths[i]! - 12) };
      });
      const h = Math.max(...laid.map((l) => l.lines.length)) * 11 + 8;
      if (this.y - h < FOOT) {
        this.newPage();
        header();
      }
      let x = M;
      laid.forEach((l, i) => {
        l.lines.forEach((line, j) => {
          const tw = l.font.widthOfTextAtSize(line, l.size);
          const tx = cols[i]!.align === "right" ? x + widths[i]! - 6 - tw : x + 6;
          this.text(line, tx, this.y - 11 - j * 11, { size: l.size, font: l.font, color: l.c.href ? C.link : l.c.color });
        });
        if (l.c.href) this.link(x + 4, this.y - h + 3, widths[i]! - 8, h - 4, l.c.href);
        x += widths[i]!;
      });
      this.y -= h;
      this.page.drawLine({ start: { x: M, y: this.y }, end: { x: M + W, y: this.y }, thickness: 0.5, color: C.line });
    }
    this.y -= 6;
  }

  paragraph(s: string, o: { size?: number; color?: ReturnType<typeof rgb>; font?: PDFFont } = {}) {
    const size = o.size ?? 9;
    for (const line of wrap(s, o.font ?? this.f.regular, size, W)) {
      this.ensure(size + 4);
      this.y -= size + 3;
      this.text(line, M, this.y, { ...o, size });
    }
    this.y -= 4;
  }
}

function drawMark(page: PDFPage, x: number, y: number, size: number) {
  // drawSvgPath flips y for SVG's y-down space; these paths are already y-up, so flip once more around the baseline
  const s = size / 3300;
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, -1, 0, y - 420 * s));
  for (const d of MARK) page.drawSvgPath(d, { x, y: 0, scale: s, color: C.signal, borderWidth: 0 });
  page.pushOperators(popGraphicsState());
}

const utc = (d: Date | string | number) => {
  const t = typeof d === "number" ? new Date(d * 1000) : new Date(d);
  return Number.isNaN(t.getTime()) ? String(d) : `${t.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};
const usdg = (v: string | bigint) => `${formatUSDG(v)} USDG`;
const minutes = (sec: number) => (sec % 60 === 0 ? `${sec / 60} min` : `${sec} s`);

/* ---------- the document ---------- */

export async function buildCertificate(input: CertificateInput): Promise<{ bytes: Uint8Array; pages: number; title: string }> {
  const { view, epochs, audit, documents, chainId, generatedAt, trackUrl } = input;
  const s = view.shipment;
  const f = view.facility;
  const status = f?.status ?? s.status;
  const title = certificateTitle(view);

  const doc = await PDFDocument.create();
  doc.setTitle(`CargoFlow ${title} ${s.externalRef}`);
  doc.setSubject(`Shipment ${s.id}`);
  doc.setAuthor("CargoFlow");
  doc.setCreator("CargoFlow dashboard");
  doc.setProducer("CargoFlow (pdf-lib)");
  doc.setKeywords(["CargoFlow", s.externalRef, s.id, status]);
  doc.setCreationDate(generatedAt);
  doc.setModificationDate(generatedAt);
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  const w = new Writer(doc, fonts, title, s.externalRef);
  w.newPage();

  // brand header
  const top = A4[1];
  const band = 150;
  w.page.drawRectangle({ x: 0, y: top - band, width: A4[0], height: band, color: C.ink });
  w.page.drawRectangle({ x: 0, y: top - band, width: A4[0], height: 4, color: C.signal });
  drawMark(w.page, M, top - 58, 30);
  w.text("CargoFlow", M + 40, top - 49, { size: 17, font: fonts.bold, color: C.paper });
  w.text(title.toUpperCase(), M, top - 84, { size: 9, font: fonts.bold, color: C.signal });
  w.text(s.externalRef, M, top - 112, { size: 26, font: fonts.bold, color: C.paper });
  w.text(`Generated ${utc(generatedAt)}  ·  ${chainName(chainId)} (testnet)`, M, top - 132, { size: 8.5, color: rgb(0.8, 0.84, 0.86) });
  const chip = status.charAt(0) + status.slice(1).toLowerCase();
  const chipW = fonts.bold.widthOfTextAtSize(chip, 10) + 24;
  w.page.drawRectangle({ x: A4[0] - M - chipW, y: top - 58, width: chipW, height: 22, color: status === "SETTLED" ? C.signal : C.ink3 });
  w.text(chip, A4[0] - M - chipW + 12, top - 51, { size: 10, font: fonts.bold, color: status === "SETTLED" ? C.ink : C.paper });
  w.y = top - band - 12;

  w.paragraph(
    isSettled(view)
      ? "This certificate records how the shipment's financing was released and settled: the policy all parties agreed, the evidence committed for each milestone, any zero-knowledge recovery, the settlement waterfall and the documents attested by the parties. Every transaction can be checked on the public explorer."
      : "This record shows the shipment's financing so far: the policy all parties agreed, the evidence committed for each milestone, any zero-knowledge recovery and the documents attested by the parties. It becomes a settlement certificate once the buyer pays the invoice.",
    { size: 9, color: C.slate },
  );
  w.y -= 6;

  w.section("Shipment");
  w.pairs([
    ["Reference", { text: s.externalRef, bold: true }],
    ["Status", chip],
    ["Invoice value", usdg(s.invoiceValue)],
    ["Registered", utc(s.createdAt)],
  ]);
  w.pairs(
    [
      ["Shipment id", s.id],
      ["Invoice hash", s.invoiceHash],
      ["Route commitment", s.routeCommitment],
      ["Policy commitment", s.policyCommitment],
    ],
    1,
  );
  if (trackUrl) w.pairs([["Live record", { text: trackUrl, href: trackUrl, color: C.link }]], 1);

  w.section("Parties");
  const financier = f?.financier || s.financier;
  w.pairs(
    [
      ["Exporter", { text: s.exporter, href: explorerAddress(chainId, s.exporter) }],
      ["Financier", financier ? { text: financier, href: explorerAddress(chainId, financier) } : "No facility yet"],
      ["Buyer", { text: s.buyer, href: explorerAddress(chainId, s.buyer) }],
    ],
    1,
  );

  const p = s.policy;
  w.section("Policy", "Fixed at registration; its hash is the policy commitment above, so no party can change it later.");
  w.pairs([
    ["Temperature band", `${formatTempX100(p.minTempX100)} to ${formatTempX100(p.maxTempX100)}`],
    ["Max reading gap", minutes(p.maxGapSec)],
    ["Max route deviation", `${(p.maxRouteDeviationM / 1000).toLocaleString("en-GB")} km`],
    ["Min evidence score", String(p.minEvidenceScore)],
    ["Max sensor conflict", formatBps(p.maxConflictBps)],
    ["Max risk", formatBps(p.maxRiskBps)],
    ["Min sensors", String(p.minSensors)],
    ["Proof required", p.requiresZk ? "Yes, every release" : "Only to lift a pause"],
  ]);

  if (f) {
    w.section("Facility");
    w.pairs([
      ["Committed", usdg(f.committed)],
      ["Drawn", usdg(f.drawn)],
      ["Still in escrow", usdg(f.remaining)],
      ["Financing fee", `${f.feeBps / 100}% (${f.feeBps} bps)`],
      ["Milestones", `${Math.min(f.nextMilestone, f.milestoneCount)} of ${f.milestoneCount} released`],
      ["Pauses", String(f.pauseCount)],
    ]);
  }

  // per-milestone evidence
  w.section("Milestones and evidence", "Each release needs a committed evidence epoch that passes the policy. The score shown is the epoch the release used, or the latest one.");
  const byMilestone = (i: number) => epochs.filter((e) => e.milestoneIndex === i).sort((a, b) => a.sequence - b.sequence);
  w.table(
    [
      { label: "#", width: 4 },
      { label: "Milestone", width: 22 },
      { label: "Allocated", width: 13, align: "right" },
      { label: "Score", width: 9, align: "right" },
      { label: "Epochs", width: 8, align: "right" },
      { label: "Status", width: 17 },
      { label: "Release tx", width: 17, mono: true },
    ],
    view.milestones.map((m) => {
      const list = byMilestone(m.index);
      const used = list.filter((e) => e.decisionPass && e.commitTx).at(-1) ?? list.at(-1);
      const blocked = f?.status === "PAUSED" && f.nextMilestone === m.index;
      return [
        String(m.index + 1),
        m.description || `Milestone ${m.index + 1}`,
        formatUSDG(m.allocatedUsdg),
        used ? { text: `${used.score}/${m.evidenceThreshold}`, color: used.score >= m.evidenceThreshold ? C.verified : C.danger } : `–/${m.evidenceThreshold}`,
        String(list.length),
        m.released
          ? { text: `Released${m.releasedAt ? ` ${utc(m.releasedAt).slice(0, 10)}` : ""}`, color: C.verified, bold: true }
          : blocked
            ? { text: "Blocked by pause", color: C.alert, bold: true }
            : "Pending",
        m.releaseTxHash ? { text: shortHash(m.releaseTxHash, 8, 6), href: explorerTx(chainId, m.releaseTxHash) } : "–",
      ];
    }),
  );

  const committed = epochs.filter((e) => e.commitTx || e.decisionAction).sort((a, b) => a.sequence - b.sequence);
  if (committed.length) {
    const shown = committed.slice(-40);
    w.section(
      "Committed evidence epochs",
      `Eight readings per epoch; only their Merkle root is on chain.${committed.length > shown.length ? ` The latest ${shown.length} of ${committed.length} are listed.` : ""}`,
    );
    w.table(
      [
        { label: "Seq", width: 6, align: "right" },
        { label: "Milestone", width: 9, align: "right" },
        { label: "Closed (UTC)", width: 17 },
        { label: "Score", width: 7, align: "right" },
        { label: "Conflict", width: 9, align: "right" },
        { label: "Risk", width: 8, align: "right" },
        { label: "Decision", width: 14 },
        { label: "Commit tx", width: 18, mono: true },
      ],
      shown.map((e) => [
        String(e.sequence),
        e.milestoneIndex === 255 ? "–" : String(e.milestoneIndex + 1),
        utc(e.endTime).replace(" UTC", ""),
        String(e.score),
        formatBps(e.conflictBps),
        formatBps(e.riskBps),
        { text: e.decisionPass ? "Pass" : `Fail${e.decisionAction ? ` (${e.decisionAction.toLowerCase()})` : ""}`, color: e.decisionPass ? C.verified : C.danger },
        e.commitTx ? { text: shortHash(e.commitTx, 8, 6), href: explorerTx(chainId, e.commitTx) } : "–",
      ]),
    );
  }

  // proof record
  w.section("Zero-knowledge proof record");
  const proofs = epochs.filter((e) => e.proofVerified);
  const resumes = audit.filter((a) => a.title.startsWith("FinancingResumed") || a.title.startsWith("RESUME_WITH_PROOF"));
  if (proofs.length === 0) {
    w.paragraph(f && f.pauseCount > 0 ? "The facility was paused, and no zero-knowledge recovery proof has been verified yet." : "No recovery was needed: no pause was lifted with a zero-knowledge proof.", { color: C.slate });
  } else {
    w.table(
      [
        { label: "Milestone", width: 10, align: "right" },
        { label: "Epoch", width: 8, align: "right" },
        { label: "Readings root", width: 40, mono: true },
        { label: "Verified", width: 20 },
        { label: "Resume tx", width: 22, mono: true },
      ],
      proofs.map((e, i) => {
        const tx = resumes[i]?.txHash;
        return [String(e.milestoneIndex + 1), `#${e.sequence}`, e.root, { text: "Groth16, on chain", color: C.verified }, tx ? { text: shortHash(tx, 8, 6), href: explorerTx(chainId, tx) } : "–"];
      }),
    );
  }

  // settlement waterfall
  if (f) {
    const wf = waterfall(f.drawn, s.invoiceValue, f.feeBps, f.committed);
    w.section(
      "Settlement waterfall",
      isSettled(view) ? "As paid by ReceivableVault.settle when the buyer settled the invoice." : "Projected with the current drawdown, exactly as ReceivableVault.settle will compute it when the buyer pays.",
    );
    w.table(
      [
        { label: "Line", width: 60 },
        { label: "Amount (USDG)", width: 40, align: "right" },
      ],
      [
        ["Invoice paid by the buyer", formatUSDG(s.invoiceValue)],
        ["Principal drawn, back to the financier", formatUSDG(wf.principal)],
        [`Financing fee at ${f.feeBps / 100}%, to the financier`, formatUSDG(wf.fee)],
        ["Undrawn commitment, back to the financier", formatUSDG(wf.undrawn)],
        [{ text: "Total to the financier", bold: true }, { text: formatUSDG(wf.financier), bold: true }],
        [{ text: "Residual to the exporter", bold: true }, { text: formatUSDG(wf.residual), bold: true, color: C.verified }],
      ],
    );
  }

  // documents
  w.section("Attested documents", "The parties signed these files' hashes with their wallets. The files themselves were never uploaded; anyone holding a copy can check it against these hashes.");
  if (documents.length === 0) {
    w.paragraph("No documents have been attested for this shipment.", { color: C.slate });
  } else {
    w.table(
      [
        { label: "Document", width: 30 },
        { label: "Signed by", width: 16 },
        { label: "Hashes", width: 54, mono: true },
      ],
      documents.map((d) => [
        `${kindLabel[d.kind] ?? d.kind}\n${d.name} (${formatBytes(d.sizeBytes)})`,
        `${d.role.charAt(0).toUpperCase() + d.role.slice(1)}\n${utc(d.createdAt).slice(0, 10)}${d.matchesInvoiceHash ? "\nMatches the on-chain invoice hash" : ""}`,
        `sha256 ${d.sha256}\nkeccak ${d.keccak256}`,
      ]),
    );
  }

  // on-chain record from the audit trail
  const onChain = audit.filter((a) => a.txHash).sort((a, b) => a.time.localeCompare(b.time));
  if (onChain.length) {
    const shown = onChain.slice(-40);
    w.section("On-chain record", `Every transaction in the audit trail, oldest first${onChain.length > shown.length ? ` (the latest ${shown.length} of ${onChain.length})` : ""}. Hashes link to the explorer.`);
    w.table(
      [
        { label: "Time (UTC)", width: 22 },
        { label: "Event", width: 48 },
        { label: "Transaction", width: 30, mono: true },
      ],
      shown.map((a) => [utc(a.time), a.title.replace(/_/g, " "), { text: shortHash(a.txHash!, 10, 8), href: explorerTx(chainId, a.txHash!) }]),
    );
  }

  // footer on every page
  const n = w.pages.length;
  w.pages.forEach((page, i) => {
    page.drawLine({ start: { x: M, y: 40 }, end: { x: A4[0] - M, y: 40 }, thickness: 0.5, color: C.line });
    const note = pdfSafe(`Testnet record on ${chainName(chainId)}: test USDG has no monetary value. Generated ${utc(generatedAt)} from public CargoFlow data.`);
    page.drawText(note, { x: M, y: 27, size: 7, font: fonts.regular, color: C.slate });
    const label = `Page ${i + 1} of ${n}`;
    page.drawText(label, { x: A4[0] - M - fonts.regular.widthOfTextAtSize(label, 7), y: 27, size: 7, font: fonts.regular, color: C.slate });
  });

  const bytes = await doc.save();
  return { bytes, pages: n, title };
}
