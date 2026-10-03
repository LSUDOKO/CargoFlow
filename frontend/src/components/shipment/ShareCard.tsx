"use client";

import QRCode from "qrcode";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { saveBlob } from "@/lib/documents";
import { chainName } from "@/lib/explorer";
import { shortHash } from "@/lib/format";
import { useHydrated } from "@/lib/useHydrated";

type Modules = { size: number; get: (row: number, col: number) => number | boolean };

const INK = "#0b1b2b";
const SIGNAL = "#c6f432";
const SLATE = "#5b6b7b";

function qrModules(text: string): Modules {
  return QRCode.create(text, { errorCorrectionLevel: "M" }).modules as unknown as Modules;
}

/** One SVG path for every dark module: crisp at any size and tiny in the DOM. */
function qrPath(m: Modules): string {
  let d = "";
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return d;
}

function cssFont(variable: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

async function loadLogo(): Promise<HTMLImageElement | null> {
  try {
    // the file has a viewBox but no size; give it one so every browser can draw it on a canvas
    const svg = (await (await fetch("/brand/logo-dark.svg")).text()).replace("<svg ", '<svg width="1440" height="360" ');
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const img = new Image();
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);
    return img;
  } catch {
    return null;
  }
}

function fitText(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, start: number, max: number) {
  let px = start;
  ctx.font = font(px);
  while (px > 12 && ctx.measureText(text).width > max) ctx.font = font((px -= 2));
}

/** A 4 × 6 in container label at 300 dpi: brand band, reference, QR code to the public evidence page. */
async function renderLabel(o: { url: string; reference: string; id: string; chainId?: number }): Promise<Blob> {
  const W = 1200, H = 1800;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  await document.fonts?.ready;
  const display = cssFont("--font-space-grotesk", "system-ui, sans-serif");
  const sans = cssFont("--font-inter", "system-ui, sans-serif");
  const mono = cssFont("--font-jetbrains", "ui-monospace, monospace");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, 300);
  ctx.fillStyle = SIGNAL;
  ctx.fillRect(0, 300, W, 14);
  const logo = await loadLogo();
  if (logo) ctx.drawImage(logo, 80, 90, 480, 120);
  else {
    ctx.fillStyle = "#f7f9f4";
    ctx.font = `700 84px ${display}`;
    ctx.fillText("CargoFlow", 80, 180);
  }
  ctx.fillStyle = SIGNAL;
  ctx.font = `700 30px ${sans}`;
  ctx.textAlign = "right";
  ctx.fillText("EVIDENCE LABEL", W - 80, 140);
  ctx.fillStyle = "rgba(247,249,244,0.7)";
  ctx.font = `500 26px ${sans}`;
  ctx.fillText(`${chainName(o.chainId)}`, W - 80, 184);

  ctx.textAlign = "left";
  ctx.fillStyle = SLATE;
  ctx.font = `700 28px ${sans}`;
  ctx.fillText("SHIPMENT", 80, 410);
  ctx.fillStyle = INK;
  fitText(ctx, o.reference, (px) => `700 ${px}px ${display}`, 96, W - 160);
  ctx.fillText(o.reference, 80, 500);

  const m = qrModules(o.url);
  const qrSize = 860;
  const cell = Math.floor(qrSize / m.size);
  const drawn = cell * m.size;
  const qx = (W - drawn) / 2;
  const qy = 570;
  ctx.fillStyle = INK;
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) ctx.fillRect(qx + c * cell, qy + r * cell, cell, cell);

  ctx.textAlign = "center";
  ctx.fillStyle = INK;
  fitText(ctx, "Scan to verify this shipment's evidence", (px) => `700 ${px}px ${display}`, 56, W - 160);
  ctx.fillText("Scan to verify this shipment's evidence", W / 2, qy + drawn + 110);
  ctx.fillStyle = SLATE;
  fitText(ctx, o.url, (px) => `500 ${px}px ${mono}`, 28, W - 160);
  ctx.fillText(o.url, W / 2, qy + drawn + 165);

  ctx.fillStyle = "#dce3da";
  ctx.fillRect(80, H - 150, W - 160, 3);
  ctx.textAlign = "left";
  ctx.fillStyle = SLATE;
  ctx.font = `500 28px ${sans}`;
  ctx.fillText("Readings stay private; evidence roots are on chain.", 80, H - 90);
  ctx.textAlign = "right";
  ctx.font = `500 28px ${mono}`;
  ctx.fillText(shortHash(o.id, 6, 6), W - 80, H - 90);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The label could not be drawn."))), "image/png"));
}

/** The public tracking link as text and QR code, plus a printable container label that carries it. */
export function ShareCard({ id, reference, chainId }: { id: string; reference: string; chainId?: number }) {
  const hydrated = useHydrated();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = hydrated ? `${window.location.origin}/track/${id}` : "";
  const path = useMemo(() => (url ? qrPath(qrModules(url)) : ""), [url]);
  const size = useMemo(() => (url ? qrModules(url).size : 0), [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast({ tone: "alert", title: "Copy the link from the box: the clipboard is blocked here." });
    }
  };

  const download = async () => {
    setBusy(true);
    try {
      saveBlob(`cargoflow-label-${reference.replace(/[^A-Za-z0-9._-]+/g, "_")}.png`, await renderLabel({ url, reference, id, chainId }));
    } catch (err) {
      toast({ tone: "danger", title: "The label could not be created", body: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <div className="shrink-0 rounded-2xl border border-line bg-white p-2.5">
          {path ? (
            <svg viewBox={`-1 -1 ${size + 2} ${size + 2}`} className="h-28 w-28" role="img" aria-label={`QR code for ${url}`} shapeRendering="crispEdges">
              <path d={path} fill={INK} />
            </svg>
          ) : (
            <Skeleton className="h-28 w-28" />
          )}
        </div>
        <p className="text-sm text-slate">Anyone with the link sees the live evidence, escrow and audit trail. Nothing private is exposed.</p>
      </div>
      <div>
        <label htmlFor="share-link" className="mb-1.5 block text-sm font-semibold">Public tracking link</label>
        <input
          id="share-link"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="h-11 w-full rounded-2xl border-2 border-line bg-white px-3 font-mono text-[0.8125rem] text-ink outline-none focus:border-ink"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => void copy()} disabled={!url}>{copied ? "Link copied" : "Copy link"}</Button>
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void download()} disabled={!url}>Download label</Button>
      </div>
      <p className="text-xs text-slate">The label is a 4 × 6 in PNG for the container door or the pallet: print it at 100%.</p>
    </div>
  );
}
