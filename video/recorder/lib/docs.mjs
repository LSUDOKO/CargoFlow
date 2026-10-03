// Small, realistic-looking PDFs for the invoice and bill-of-lading uploads (fingerprinted in the browser, never
// uploaded). Each call produces a unique file, since a bill can be issued only once per document.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { REPO } from "./deps.mjs";
import { TMP } from "./session.mjs";

const req = createRequire(path.join(REPO, "frontend", "package.json"));
const { PDFDocument, StandardFonts, rgb } = req("pdf-lib");

export async function makePdf(kind, ref, lines) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(kind === "invoice" ? "COMMERCIAL INVOICE" : "BILL OF LADING", { x: 50, y: 780, size: 20, font: bold, color: rgb(0.04, 0.15, 0.27) });
  page.drawText(ref, { x: 50, y: 755, size: 12, font });
  let y = 715;
  for (const l of lines) {
    page.drawText(l, { x: 50, y, size: 11, font });
    y -= 20;
  }
  page.drawText(`Issued ${new Date().toISOString()}`, { x: 50, y: 60, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
  const file = path.join(TMP, `${kind}-${ref}.pdf`);
  fs.writeFileSync(file, await doc.save());
  return file;
}
