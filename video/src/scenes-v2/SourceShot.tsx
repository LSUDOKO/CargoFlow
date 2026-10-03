import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import highlights from "../../public/sources/highlights.json";
import { P } from "../assets/palette";
import { F } from "../theme";
import { IN_OUT_CUBIC, OUT, clamp } from "./kit";

/**
 * A real source page in a neutral light browser frame (grey chrome, real URL, no CargoFlow
 * branding), per SCRIPT-v2 "Source screenshots": slide in from 40 px right (12 f) -> hold ->
 * push toward the quote box until the quote is ~1,100 px wide at frame centre (45 f, in-out
 * cubic, @2x file) -> paper veil (70 %) over everything but the quote's line boxes (10 f) ->
 * lime highlighter (55 %, multiply) sweeps each line left to right, 10 f per line.
 * Never retypes a quote: the page itself is the evidence.
 */

export type Box = { x: number; y: number; w: number; h: number };

export type Stop = {
  /** Frame the camera starts moving to this quote. */
  at: number;
  box: Box;
  lines: Box[];
  /** Push duration (45 f for the first stop, ~20 f for a travel down the same page). */
  dur?: number;
  /** First highlighter stroke (default: push end + 12). */
  sweepAt?: number;
};

const FRAME = { x: 560, y: 150, w: 1280, h: 720 };
const CHROME = 84;
const VIEW_H = FRAME.h - CHROME;
const TARGET_W = 1100;
const CENTER = { x: 960, y: 470 };

export const highlightFor = (file: string) => {
  const h = highlights.highlights.find((x) => x.file === file);
  if (!h) throw new Error(`no highlight for ${file}`);
  return h;
};

/** Shift a set of boxes by dy (for using a quote's boxes on a differently scrolled capture). */
export const shiftBoxes = (bs: Box[], dy: number) => bs.map((b) => ({ ...b, y: b.y + dy }));
export const unionBox = (bs: Box[]): Box => {
  const x0 = Math.min(...bs.map((b) => b.x));
  const y0 = Math.min(...bs.map((b) => b.y));
  const x1 = Math.max(...bs.map((b) => b.x + b.w));
  const y1 = Math.max(...bs.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

const Chrome: React.FC<{ url: string }> = ({ url }) => {
  const clean = url.replace(/^https?:\/\//, "");
  const [host, ...rest] = clean.split("/");
  const path = rest.length ? `/${rest.join("/")}` : "";
  return (
    <div style={{ height: CHROME, background: "#ECEDEC", borderBottom: "1px solid #D6D8D6" }}>
      <div style={{ height: 38, display: "flex", alignItems: "center", gap: 8, padding: "0 16px" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ width: 12, height: 12, borderRadius: 6, background: "#C9CCC9" }} />
        ))}
        <div style={{ marginLeft: 18, height: 28, width: 260, borderRadius: "8px 8px 0 0", background: "#F7F7F7", alignSelf: "flex-end" }} />
      </div>
      <div style={{ height: 46, display: "flex", alignItems: "center", padding: "0 16px", background: "#F7F7F7" }}>
        <div
          style={{
            flex: 1,
            height: 30,
            borderRadius: 15,
            background: "#FFFFFF",
            border: "1px solid #DEE0DE",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 14px",
            fontFamily: F.body,
            fontSize: 15,
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          <svg width={11} height={13} viewBox="0 0 12 14">
            <rect x={1} y={6} width={10} height={8} rx={2} fill="#7B827E" />
            <path d="M3 6 V4 a3 3 0 0 1 6 0 v2" stroke="#7B827E" strokeWidth={1.8} fill="none" />
          </svg>
          <span style={{ color: "#1F2421" }}>{host}</span>
          <span style={{ color: "#7B827E", marginLeft: -8, overflow: "hidden", textOverflow: "ellipsis" }}>{path}</span>
        </div>
      </div>
    </div>
  );
};

export const SourceShot: React.FC<{
  /** Main capture (1x name, e.g. "adb-news-top.png"; the @2x file is used for display). */
  file: string;
  url: string;
  stops: Stop[];
  /** Establishing capture shown first, replaced by `file` with a paper slide at `until`. */
  establish?: { file: string; until: number };
  crop?: Box;
  inAt?: number;
  /** 0..1: hands attention to a card in front (blur 6 px + slight veil). */
  rack?: number;
  /** Fade the whole shot out (0..1). */
  out?: number;
}> = ({ file, url, stops, establish, crop, inAt = 0, rack = 0, out = 0 }) => {
  const frame = useCurrentFrame();
  const c = crop ?? { x: 0, y: 0, w: 1920, h: 1080 };
  const s0 = FRAME.w / c.w;
  const imgW = 1920 * s0;
  const imgH = 1080 * s0;
  const maxScroll = Math.max(0, 1080 - VIEW_H / s0);
  const scrollFor = (b: Box) => Math.max(crop ? Math.min(c.y, maxScroll) : 0, Math.min(maxScroll, b.y + b.h / 2 - VIEW_H / s0 / 2));

  // Per-stop camera: scale k and translation so the box lands at CENTER, TARGET_W wide.
  const camFor = (st: Stop) => {
    const sc = scrollFor(st.box);
    const k = Math.max(1.05, TARGET_W / (st.box.w * s0));
    const qx = FRAME.x + (st.box.x + st.box.w / 2 - c.x) * s0;
    const qy = FRAME.y + CHROME + (st.box.y + st.box.h / 2 - sc) * s0;
    return { k, tx: CENTER.x - k * qx, ty: CENTER.y - k * qy, sc };
  };
  let cam = { k: 1, tx: 0, ty: 0, sc: stops.length ? Math.min(scrollFor(stops[0].box), crop ? c.y : 0) : 0 };
  if (!crop && establish) cam.sc = 0;
  let active = -1;
  stops.forEach((st, i) => {
    const dur = st.dur ?? (i === 0 ? 45 : 20);
    const t = interpolate(frame, [st.at, st.at + dur], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
    if (t > 0) {
      const to = camFor(st);
      cam = { k: cam.k + (to.k - cam.k) * t, tx: cam.tx + (to.tx - cam.tx) * t, ty: cam.ty + (to.ty - cam.ty) * t, sc: cam.sc + (to.sc - cam.sc) * t };
      active = i;
    }
  });

  const enter = interpolate(frame, [inAt, inAt + 12], [0, 1], { ...clamp, easing: OUT });
  const estK = establish ? interpolate(frame, [establish.until, establish.until + 10], [0, 1], { ...clamp, easing: OUT }) : 1;

  const st = active >= 0 ? stops[active] : undefined;
  const pushEnd = st ? st.at + (st.dur ?? (active === 0 ? 45 : 20)) : 0;
  const veil = st ? interpolate(frame, [pushEnd, pushEnd + 10], [0, 0.7], clamp) : 0;
  const sweepAt = st ? st.sweepAt ?? pushEnd + 12 : 0;

  const pad = { x: 6, y: 4 };
  const maskId = `veil-${file.replace(/[^a-z0-9]/gi, "")}`;

  const imageLayer = (name: string, opacity: number, dy: number, withMarks: boolean) => (
    <div style={{ position: "absolute", left: -c.x * s0, top: -cam.sc * s0 + dy, width: imgW, height: imgH, opacity }}>
      <Img src={staticFile(`sources/${name.replace(".png", "@2x.png")}`)} style={{ width: imgW, height: imgH, display: "block" }} />
      {crop && withMarks ? (
        <svg width={imgW} height={imgH} viewBox="0 0 1920 1080" style={{ position: "absolute", left: 0, top: 0 }}>
          <rect x={0} y={0} width={1920} height={Math.max(0, c.y - 30)} fill={P.white} />
          <rect x={0} y={c.y + c.h + 30} width={1920} height={1080} fill={P.white} />
        </svg>
      ) : null}
      {withMarks && st ? (
        <svg width={imgW} height={imgH} viewBox="0 0 1920 1080" style={{ position: "absolute", left: 0, top: 0 }}>
          <defs>
            <mask id={maskId}>
              <rect width={1920} height={1080} fill="white" />
              {st.lines.map((l, i) => (
                <rect key={i} x={l.x - pad.x} y={l.y - pad.y} width={l.w + pad.x * 2} height={l.h + pad.y * 2} rx={4} fill="black" />
              ))}
            </mask>
          </defs>
          <rect width={1920} height={1080} fill={P.paper} opacity={veil} mask={`url(#${maskId})`} />
          {stops.slice(0, active + 1).map((s, si) =>
            s.lines.map((l, i) => {
              const sa = si === active ? sweepAt : (s.sweepAt ?? s.at + 57);
              const w = interpolate(frame, [sa + i * 10, sa + i * 10 + 10], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
              if (w <= 0) return null;
              const h = l.h + 4;
              return (
                <rect
                  key={`${si}-${i}`}
                  x={l.x - 4}
                  y={l.y - 2}
                  width={(l.w + 8) * w}
                  height={h}
                  rx={h * 0.32}
                  fill={P.signal}
                  opacity={si === active ? 0.55 : 0.3}
                  style={{ mixBlendMode: "multiply" }}
                />
              );
            }),
          )}
        </svg>
      ) : null}
    </div>
  );

  return (
    <div style={{ position: "absolute", inset: 0, opacity: (1 - out) * enter }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformOrigin: "0 0",
          transform: `translate(${cam.tx + (1 - enter) * 40}px, ${cam.ty}px) scale(${cam.k})`,
          filter: rack > 0.02 ? `blur(${rack * 6}px)` : undefined,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: FRAME.x,
            top: FRAME.y,
            width: FRAME.w,
            height: FRAME.h,
            borderRadius: 14,
            overflow: "hidden",
            background: P.white,
            border: "1px solid #D6D8D6",
            boxShadow: "0 1px 0 rgba(11,27,43,0.05), 0 30px 60px -30px rgba(11,27,43,0.3)",
          }}
        >
          <Chrome url={url} />
          <div style={{ position: "relative", height: VIEW_H, overflow: "hidden", background: P.white }}>
            {establish && estK < 1 ? imageLayer(establish.file, 1 - estK, -estK * 40, false) : null}
            {imageLayer(file, estK, (1 - estK) * 40, true)}
          </div>
        </div>
      </div>
      {rack > 0.02 ? <div style={{ position: "absolute", inset: 0, background: P.paper, opacity: rack * 0.35 }} /> : null}
    </div>
  );
};
