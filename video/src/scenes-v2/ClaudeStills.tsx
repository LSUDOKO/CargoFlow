import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { P } from "../assets/palette";
import { F } from "../theme";
import { IN_OUT_CUBIC, OUT, clamp } from "./kit";

/**
 * R2 (S07) is built from real claude.ai captures (public/footage/claude/, 1568 x 722, see its README), not from a
 * screen recording. Each beat is a run of stills crossfading in order, with a slow camera (push-ins), reveal-typing of
 * the real prompt pixels, highlight boxes on the real UI and an animated cursor to "Allow once". Nothing is drawn that
 * the captures do not show: typed text is the capture's own text revealed left to right, and every highlight sits on
 * an element present in the still. Coordinates below are still pixels.
 */

export const STILL_W = 1568;
export const STILL_H = 722;

type Cam = { f: number; z: number; fx: number; fy: number };
type Rect = { x: number; y: number; w: number; h: number };
type Highlight = Rect & { from: number; to: number; label?: string; labelSide?: "above" | "below" };
/** Reveal `rect` of image `src` (default: this still) left to right between `from` and `to`, over a `mask` fill. */
type Reveal = { rect: Rect; from: number; to: number; chars: number; src?: string; mask: string; maskRect?: Rect; caret?: boolean };
type Cursor = { from: [number, number]; to: [number, number]; at: number; arrive: number; click?: number; mask?: Rect & { fill: string } };

export type StillState = {
  src: string;
  /** Beat-relative frame the still starts fading in (6 f crossfade over the previous one). */
  from: number;
  cams: Cam[];
  highlights?: Highlight[];
  reveals?: Reveal[];
  cursor?: Cursor;
  /** Light page (the CargoFlow app) instead of claude.ai's dark UI: highlight colours adapt. */
  light?: boolean;
};

const FADE = 6;
const img = (f: string) => staticFile(`footage/claude/${f}`);

const camAt = (frame: number, cams: Cam[]) => {
  if (frame <= cams[0].f) return cams[0];
  for (let i = 1; i < cams.length; i++) {
    const a = cams[i - 1];
    const b = cams[i];
    if (frame <= b.f) {
      const t = interpolate(frame, [a.f, b.f], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
      return { f: frame, z: a.z + (b.z - a.z) * t, fx: a.fx + (b.fx - a.fx) * t, fy: a.fy + (b.fy - a.fy) * t };
    }
  }
  return cams[cams.length - 1];
};

const ArrowCursor: React.FC<{ x: number; y: number; light?: boolean }> = ({ x, y }) => (
  <svg width={20} height={28} viewBox="0 0 20 28" style={{ position: "absolute", left: x - 2, top: y - 1, overflow: "visible", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.6))" }}>
    <path d="M2 1 L2 22 L7.5 17 L11 25.5 L14.2 24 L10.8 16 L18 16 Z" fill="#FFFFFF" stroke="#111" strokeWidth={1.4} strokeLinejoin="round" />
  </svg>
);

const StillLayer: React.FC<{ s: StillState; frame: number; W: number; H: number }> = ({ s, frame, W, H }) => {
  const local = frame - s.from;
  const cam = camAt(local, s.cams);
  const S = Math.max(W / STILL_W, H / STILL_H) * cam.z;
  const tx = Math.min(0, Math.max(W - STILL_W * S, W / 2 - cam.fx * S));
  const ty = Math.min(0, Math.max(H - STILL_H * S, H / 2 - cam.fy * S));
  const opacity = interpolate(local, [0, FADE], [0, 1], clamp);
  const hlColor = P.signal;

  let cur: { x: number; y: number } | null = null;
  let clickK = 0;
  if (s.cursor) {
    const c = s.cursor;
    const t = interpolate(local, [c.at, c.arrive], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
    cur = { x: c.from[0] + (c.to[0] - c.from[0]) * t, y: c.from[1] + (c.to[1] - c.from[1]) * t };
    if (c.click !== undefined) clickK = interpolate(local, [c.click, c.click + 14], [0, 1], clamp);
  }

  return (
    <AbsoluteFill style={{ opacity }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: STILL_W, height: STILL_H, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${S})` }}>
        <Img src={img(s.src)} style={{ position: "absolute", left: 0, top: 0, width: STILL_W, height: STILL_H }} />

        {(s.reveals ?? []).map((r, i) => {
          const m = r.maskRect ?? r.rect;
          const n = Math.floor(interpolate(local, [r.from, r.to], [0, r.chars], clamp));
          const w = (r.rect.w * n) / r.chars;
          const typing = local >= r.from && n < r.chars;
          return (
            <React.Fragment key={i}>
              {n < r.chars || r.src ? <div style={{ position: "absolute", left: m.x, top: m.y, width: m.w, height: m.h, background: r.mask }} /> : null}
              {n < r.chars || r.src ? (
                <div style={{ position: "absolute", left: r.rect.x, top: r.rect.y, width: w, height: r.rect.h, overflow: "hidden" }}>
                  <Img src={img(r.src ?? s.src)} style={{ position: "absolute", left: -r.rect.x, top: -r.rect.y, width: STILL_W, height: STILL_H, maxWidth: "none" }} />
                </div>
              ) : null}
              {typing && r.caret !== false ? <div style={{ position: "absolute", left: r.rect.x + w + 1, top: r.rect.y + 3, width: 1.5, height: r.rect.h - 6, background: "#E8E6DF", opacity: Math.floor(local / 6) % 2 ? 1 : 0.4 }} /> : null}
            </React.Fragment>
          );
        })}

        {s.cursor?.mask ? <div style={{ position: "absolute", left: s.cursor.mask.x, top: s.cursor.mask.y, width: s.cursor.mask.w, height: s.cursor.mask.h, background: s.cursor.mask.fill }} /> : null}

        {(s.highlights ?? []).map((h, i) => {
          const k = Math.min(interpolate(local, [h.from, h.from + 8], [0, 1], { ...clamp, easing: OUT }), interpolate(local, [h.to - 6, h.to], [1, 0], clamp));
          if (k <= 0.001) return null;
          const pad = 4;
          const grow = (1 - k) * 6;
          return (
            <div key={i} style={{ position: "absolute", left: h.x - pad - grow, top: h.y - pad - grow, width: h.w + 2 * (pad + grow), height: h.h + 2 * (pad + grow), opacity: k }}>
              <div style={{ position: "absolute", inset: 0, borderRadius: 7, border: `2px solid ${hlColor}`, boxShadow: `0 0 0 3px rgba(198,242,62,0.18), 0 0 18px rgba(198,242,62,0.35)` }} />
              {h.label ? (
                <div
                  style={{
                    position: "absolute",
                    left: -2,
                    ...(h.labelSide === "below" ? { top: "100%", marginTop: 6 } : { bottom: "100%", marginBottom: 6 }),
                    padding: "3px 8px",
                    borderRadius: 999,
                    background: hlColor,
                    color: P.ink,
                    fontFamily: F.mono,
                    fontWeight: 700,
                    fontSize: 11,
                    whiteSpace: "nowrap",
                  }}
                >
                  {h.label}
                </div>
              ) : null}
            </div>
          );
        })}

        {cur ? (
          <>
            {clickK > 0 && clickK < 1 ? (
              <div style={{ position: "absolute", left: s.cursor!.to[0] - 18 * clickK, top: s.cursor!.to[1] - 18 * clickK, width: 36 * clickK, height: 36 * clickK, borderRadius: "50%", border: `2px solid ${hlColor}`, opacity: 1 - clickK }} />
            ) : null}
            <ArrowCursor x={cur.x} y={cur.y} light={s.light} />
          </>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/** One beat: the stills in order, each crossfading over the previous. Renders inside DemoShell's content area. */
export const ClaudeStills: React.FC<{ states: StillState[] }> = ({ states }) => {
  const frame = useCurrentFrame();
  // DemoShell content area: FRAME.w x 16:9
  const W = 1440;
  const H = 810;
  const visible = states.filter((s, i) => frame >= s.from && !(states[i + 1] && frame >= states[i + 1].from + FADE));
  return (
    <AbsoluteFill style={{ background: "#141413", overflow: "hidden" }}>
      {visible.map((s) => (
        <StillLayer key={s.src + s.from} s={s} frame={frame} W={W} H={H} />
      ))}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------------------------------------------------
 * The four beats (frames relative to each beat's slot in S07; durations per footage-shots.md)
 * ---------------------------------------------------------------------------------------------------------- */

const COMPOSER = "rgb(32,32,30)";
const FIELD = "rgb(43,43,41)";

/** R2-02 · 156 f: Add custom connector (typed), the CargoFlow connector with its read-only tools, CargoFlow on in chat. */
export const R2_02: StillState[] = [
  {
    src: "R2-02-c-add-dialog-empty.jpg",
    from: 0,
    cams: [
      { f: 0, z: 1.05, fx: 800, fy: 360 },
      { f: 16, z: 1.6, fx: 784, fy: 330 },
    ],
    reveals: [
      { rect: { x: 588, y: 274, w: 72, h: 20 }, maskRect: { x: 586, y: 273, w: 110, h: 22 }, from: 12, to: 22, chars: 9, src: "R2-02-d-add-dialog-filled.jpg", mask: FIELD },
      { rect: { x: 588, y: 334, w: 292, h: 20 }, maskRect: { x: 586, y: 333, w: 300, h: 22 }, from: 25, to: 52, chars: 48, src: "R2-02-d-add-dialog-filled.jpg", mask: FIELD },
    ],
  },
  {
    src: "R2-02-d-add-dialog-filled.jpg",
    from: 54,
    cams: [{ f: 0, z: 1.6, fx: 784, fy: 330 }],
    highlights: [{ x: 583, y: 331, w: 402, h: 26, from: 6, to: 30, label: "remote MCP server URL", labelSide: "below" }],
  },
  {
    src: "R2-02-e-cargoflow-tools.jpg",
    from: 84,
    cams: [
      { f: 0, z: 1.5, fx: 830, fy: 230 },
      { f: 36, z: 1.6, fx: 840, fy: 220 },
    ],
    highlights: [
      { x: 545, y: 118, w: 270, h: 52, from: 6, to: 36, label: "CargoFlow connector", labelSide: "above" },
      { x: 545, y: 238, w: 145, h: 22, from: 16, to: 36, label: "24 read-only tools", labelSide: "below" },
    ],
  },
  {
    src: "R2-02-f-chat-connectors-on.jpg",
    from: 120,
    cams: [
      { f: 0, z: 1.45, fx: 960, fy: 410 },
      { f: 40, z: 1.6, fx: 975, fy: 430 },
    ],
    highlights: [{ x: 855, y: 471, w: 246, h: 24, from: 8, to: 44, label: "CargoFlow on", labelSide: "below" }],
  },
];

/** R2-03 · 90 f: the fleet-risk prompt typed, the tool permission (cursor to Allow once), the tool calls and answer. */
export const R2_03: StillState[] = [
  {
    src: "R2-03-a-prompt.jpg",
    from: 0,
    cams: [{ f: 0, z: 1.6, fx: 900, fy: 330 }],
    reveals: [{ rect: { x: 648, y: 309, w: 444, h: 23 }, from: 1, to: 18, chars: 70, mask: COMPOSER }],
  },
  {
    src: "R2-03-b-permission-fleet.jpg",
    from: 21,
    cams: [
      { f: 0, z: 1.45, fx: 840, fy: 330 },
      { f: 26, z: 1.6, fx: 790, fy: 340 },
    ],
    cursor: { from: [1146, 365], to: [790, 440], at: 3, arrive: 17, click: 19, mask: { x: 1138, y: 360, w: 28, h: 30, fill: "rgb(21,21,21)" } },
    highlights: [{ x: 648, y: 424, w: 254, h: 26, from: 12, to: 28, label: "Allow once", labelSide: "below" }],
  },
  {
    src: "R2-03-e-tool-chips.jpg",
    from: 47,
    cams: [
      { f: 0, z: 1.4, fx: 900, fy: 290 },
      { f: 48, z: 1.5, fx: 900, fy: 280 },
    ],
    highlights: [
      { x: 602, y: 182, w: 598, h: 176, from: 6, to: 48, label: "CargoFlow tool calls", labelSide: "above" },
      { x: 600, y: 378, w: 570, h: 60, from: 22, to: 48 },
    ],
  },
];

/** R2-04 · 150 f: "Prepare the deposit…" typed, permission, the answer (prepared, not sent; two transactions), the link, the app opening. */
export const R2_04: StillState[] = [
  {
    src: "R2-04-a-prompt-deposit.jpg",
    from: 0,
    cams: [{ f: 0, z: 1.55, fx: 900, fy: 600 }],
    reveals: [{ rect: { x: 622, y: 659, w: 286, h: 25 }, from: 1, to: 14, chars: 46, mask: COMPOSER }],
  },
  {
    src: "R2-04-b-permission-fund.jpg",
    from: 16,
    cams: [
      { f: 0, z: 1.45, fx: 820, fy: 420 },
      { f: 24, z: 1.6, fx: 790, fy: 380 },
    ],
    cursor: { from: [880, 668], to: [790, 463], at: 2, arrive: 14, click: 16, mask: { x: 874, y: 662, w: 24, h: 27, fill: COMPOSER } },
    highlights: [{ x: 648, y: 448, w: 254, h: 26, from: 8, to: 24, label: "Allow once", labelSide: "below" }],
  },
  {
    src: "R2-04-c-answer.jpg",
    from: 38,
    cams: [
      { f: 0, z: 1.4, fx: 890, fy: 300 },
      { f: 32, z: 1.5, fx: 890, fy: 330 },
    ],
    highlights: [
      { x: 600, y: 208, w: 585, h: 44, from: 4, to: 22, label: "prepared but not sent", labelSide: "above" },
      { x: 600, y: 358, w: 480, h: 116, from: 16, to: 32, label: "two unsigned transactions", labelSide: "above" },
    ],
  },
  {
    src: "R2-04-d-hover-link.jpg",
    from: 66,
    cams: [
      { f: 0, z: 1.5, fx: 880, fy: 330 },
      { f: 30, z: 1.7, fx: 860, fy: 385 },
    ],
    highlights: [{ x: 788, y: 376, w: 95, h: 22, from: 6, to: 32, label: "link to sign in the app", labelSide: "above" }],
  },
  {
    src: "R2-04-e-app-opens.jpg",
    from: 94,
    light: true,
    cams: [
      { f: 0, z: 1.05, fx: 780, fy: 300 },
      { f: 56, z: 1.2, fx: 760, fy: 330 },
    ],
    highlights: [{ x: 296, y: 120, w: 450, h: 60, from: 14, to: 56, label: "opens ready to sign · not signed here", labelSide: "below" }],
  },
];

/** R2-05 · 120 f (+ tail): the expanded tool result: request/response, transaction {to, data, value, chainId}, signUrl. */
export const R2_05: StillState[] = [
  {
    src: "R2-05-a-tool-request.jpg",
    from: 0,
    cams: [
      { f: 0, z: 1.45, fx: 900, fy: 450 },
      { f: 36, z: 1.55, fx: 900, fy: 460 },
    ],
    highlights: [{ x: 602, y: 372, w: 598, h: 198, from: 4, to: 36, label: "tool result, expanded", labelSide: "above" }],
  },
  {
    src: "R2-05-b-tx-approve-json.jpg",
    from: 34,
    cams: [
      { f: 0, z: 1.55, fx: 900, fy: 200 },
      { f: 44, z: 1.7, fx: 900, fy: 190 },
    ],
    highlights: [{ x: 604, y: 128, w: 590, h: 100, from: 6, to: 44, label: "{ to, data, value, chainId } · unsigned", labelSide: "below" }],
  },
  {
    src: "R2-05-c-tx-deposit-signurl.jpg",
    from: 76,
    cams: [
      { f: 0, z: 1.6, fx: 900, fy: 180 },
      { f: 80, z: 1.75, fx: 900, fy: 200 },
    ],
    highlights: [
      { x: 604, y: 155, w: 588, h: 40, from: 6, to: 84, label: "signUrl · you sign in the app", labelSide: "above" },
      { x: 600, y: 262, w: 585, h: 40, from: 24, to: 84, label: "prepared but not sent", labelSide: "below" },
    ],
  },
];
