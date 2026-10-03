import React, { createContext, useContext } from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { P } from "../assets/palette";
import { Character, CharacterName, CharacterProps } from "../characters";
import { F } from "../theme";

/**
 * Shared vocabulary for the v2 film: stages, the three camera moves (lean-in, truck, rack),
 * on-screen lines with one lime key word, source tags, typeset figure cards, stamps, pills and
 * an Actor wrapper that places a cast member by the feet (or by the bottom edge for crops).
 */

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const IN_OUT_CUBIC = Easing.inOut(Easing.cubic);
export const IN_OUT_QUINT = Easing.inOut(Easing.poly(5));
export const OUT = Easing.bezier(0.16, 1, 0.3, 1);

export const SHADOW = "0 1px 0 rgba(11,27,43,0.05), 0 24px 48px -24px rgba(11,27,43,0.28)";
export const SHADOW_LIFT = "0 2px 0 rgba(11,27,43,0.06), 0 40px 80px -28px rgba(11,27,43,0.38)";
export const NAVY_GRADIENT = `linear-gradient(135deg, ${P.ink} 0%, ${P.ink2} 100%)`;

/* ------------------------------------------------------------------------------------------
 * Captions context: overlays that live near the bottom move up while captions are on.
 * ---------------------------------------------------------------------------------------- */

export const CaptionsOn = createContext(true);
export const useCaptionsOn = () => useContext(CaptionsOn);
/** Bottom inset that keeps an element clear of the caption lower-third. */
export const useBottomSafe = (base = 40) => (useCaptionsOn() ? base + 104 : base);

/* ------------------------------------------------------------------------------------------
 * Timing helpers
 * ---------------------------------------------------------------------------------------- */

export const p01 = (frame: number, a: number, b: number, easing: (t: number) => number = OUT) =>
  interpolate(frame, [a, b], [0, 1], { ...clamp, easing });

/** Spring 0..1 starting at `at` (brand default: no visible bounce). */
export const useSpringAt = (at: number, config: { damping?: number; stiffness?: number; mass?: number } = {}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at, fps, config: { damping: 18, stiffness: 160, ...config } });
};

/** Visibility envelope: rises in at `at`, fades out at `out` (both over `dur` frames). */
export const env = (frame: number, at: number, out?: number, dur = 12) => {
  const i = interpolate(frame, [at, at + dur], [0, 1], { ...clamp, easing: OUT });
  const o = out === undefined ? 0 : interpolate(frame, [out, out + dur], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  return Math.max(0, i - o);
};

/** Lean-in: 1.00 -> `to` over `dur` frames, ease in-out cubic. */
export const leanIn = (frame: number, at: number, dur = 60, to = 1.06, from = 1) =>
  interpolate(frame, [at, at + dur], [from, to], { ...clamp, easing: IN_OUT_CUBIC });

/** Truck: lateral value between subjects, ease in-out quint. */
export const truck = (frame: number, at: number, dur: number, from: number, to: number) =>
  interpolate(frame, [at, at + dur], [from, to], { ...clamp, easing: IN_OUT_QUINT });

/** Piecewise keyframes with in-out cubic per segment. */
export const keys = (frame: number, ks: [number, number][]) =>
  interpolate(
    frame,
    ks.map((k) => k[0]),
    ks.map((k) => k[1]),
    { ...clamp, easing: IN_OUT_CUBIC },
  );

/* ------------------------------------------------------------------------------------------
 * Stages
 * ---------------------------------------------------------------------------------------- */

export const Stage: React.FC<{ tone?: "paper" | "white" | "navy"; grid?: boolean; children?: React.ReactNode; style?: React.CSSProperties }> = ({
  tone = "paper",
  grid = tone === "paper",
  children,
  style,
}) => {
  const bg = tone === "navy" ? NAVY_GRADIENT : tone === "white" ? P.white : P.paper;
  return (
    <AbsoluteFill style={{ background: bg, overflow: "hidden", ...style }}>
      {grid ? (
        <AbsoluteFill
          style={{
            backgroundImage: `radial-gradient(circle, ${tone === "navy" ? "rgba(255,255,255,0.05)" : "rgba(11,27,43,0.08)"} 1.4px, transparent 1.6px)`,
            backgroundSize: "24px 24px",
            backgroundPosition: "12px 12px",
          }}
        />
      ) : null}
      {children}
    </AbsoluteFill>
  );
};

/**
 * 2D camera over a layer: scale about (ox, oy) in screen px, then translate; optional blur
 * (the rack). Children are laid out in 1920x1080 stage coordinates.
 */
export const Cam: React.FC<{ scale?: number; ox?: number; oy?: number; x?: number; y?: number; blur?: number; children?: React.ReactNode; style?: React.CSSProperties }> = ({
  scale = 1,
  ox = 960,
  oy = 540,
  x = 0,
  y = 0,
  blur = 0,
  children,
  style,
}) => (
  <AbsoluteFill
    style={{
      transformOrigin: `${ox}px ${oy}px`,
      transform: `translate(${x}px, ${y}px) scale(${scale})`,
      filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
      ...style,
    }}
  >
    {children}
  </AbsoluteFill>
);

/** Absolutely positioned box at (x, y) with optional anchor. */
export const At: React.FC<{ x: number; y: number; w?: number; anchor?: "tl" | "center" | "bc" | "tc" | "tr" | "br" | "bl" | "cl" | "cr"; children?: React.ReactNode; style?: React.CSSProperties }> = ({
  x,
  y,
  w,
  anchor = "tl",
  children,
  style,
}) => {
  const t: Record<string, string> = {
    tl: "translate(0,0)",
    center: "translate(-50%,-50%)",
    bc: "translate(-50%,-100%)",
    tc: "translate(-50%,0)",
    tr: "translate(-100%,0)",
    br: "translate(-100%,-100%)",
    bl: "translate(0,-100%)",
    cl: "translate(0,-50%)",
    cr: "translate(-100%,-50%)",
  };
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, transform: t[anchor], ...style }}>
      {children}
    </div>
  );
};

/** Fade + rise wrapper driven by an envelope (0..1). */
export const Rise: React.FC<{ k: number; dy?: number; dx?: number; children?: React.ReactNode; style?: React.CSSProperties }> = ({ k, dy = 18, dx = 0, children, style }) => (
  <div style={{ opacity: Math.min(1, k), transform: `translate(${(1 - k) * dx}px, ${(1 - k) * dy}px)`, ...style }}>{children}</div>
);

/* ------------------------------------------------------------------------------------------
 * Cast placement
 * ---------------------------------------------------------------------------------------- */

const FEET_FRACTION = (620 + 60) / 700;

/**
 * A cast member placed in stage px. `crop="full"`: (x, y) is the point between the feet and `h`
 * the full rendered height. Crops ("waist", "bust"): (x, y) is the bottom centre of the crop.
 */
export const Actor: React.FC<CharacterProps & { who: CharacterName; x: number; y: number; h: number; opacity?: number; dx?: number }> = ({
  who,
  x,
  y,
  h,
  crop = "full",
  opacity = 1,
  dx = 0,
  ...rest
}) => {
  const vbH = crop === "bust" ? 300 : crop === "waist" ? 380 : 700;
  const vbW = crop === "bust" ? 236 : crop === "waist" ? 340 : 400;
  const scale = h / vbH;
  const w = vbW * scale;
  const top = crop === "full" ? y - h * FEET_FRACTION : y - h;
  return (
    <div style={{ position: "absolute", left: x - w / 2 + dx, top, width: w, height: h, opacity, overflow: crop === "full" ? "visible" : "hidden" }}>
      <Character who={who} crop={crop} scale={scale} {...rest} />
    </div>
  );
};

/* ------------------------------------------------------------------------------------------
 * Type
 * ---------------------------------------------------------------------------------------- */

/**
 * An on-screen line (Space Grotesk 700) with one key word. On light grounds the key word gets a
 * lime marker behind it; on navy it is set in lime.
 */
export const OnLine: React.FC<{
  text: string;
  keyword?: string;
  size?: number;
  dark?: boolean;
  k?: number;
  align?: "left" | "center" | "right";
  maxWidth?: number;
  style?: React.CSSProperties;
}> = ({ text, keyword, size = 72, dark = false, k = 1, align = "left", maxWidth, style }) => {
  const parts = keyword ? text.split(new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`)) : [text];
  const mark = interpolate(k, [0.55, 1], [0, 1], clamp);
  return (
    <div
      style={{
        fontFamily: F.display,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1.12,
        letterSpacing: -size * 0.02,
        color: dark ? P.white : P.ink,
        textAlign: align,
        maxWidth,
        whiteSpace: maxWidth ? "normal" : "nowrap",
        opacity: Math.min(1, k * 1.4),
        transform: `translateY(${(1 - k) * 22}px)`,
        ...style,
      }}
    >
      {parts.map((p, i) =>
        keyword && p === keyword ? (
          dark ? (
            <span key={i} style={{ color: P.signal }}>
              {p}
            </span>
          ) : (
            <span
              key={i}
              style={{
                backgroundImage: `linear-gradient(${P.signal}, ${P.signal})`,
                backgroundRepeat: "no-repeat",
                backgroundSize: `${mark * 100}% 0.42em`,
                backgroundPosition: "0 82%",
                padding: "0 0.06em",
              }}
            >
              {p}
            </span>
          )
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </div>
  );
};

/** Source tag: bottom-left, Inter 18 px, ink at 60 %, on screen as long as its number is. */
export const SourceTag: React.FC<{ text: string; at: number; out?: number; dark?: boolean; line2?: string }> = ({ text, at, out, dark = false, line2 }) => {
  const frame = useCurrentFrame();
  const bottom = useBottomSafe(36);
  const k = env(frame, at, out, 10);
  if (k <= 0.001) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 48,
        bottom,
        opacity: k,
        fontFamily: F.body,
        fontWeight: 500,
        fontSize: 18,
        lineHeight: 1.45,
        color: dark ? "rgba(255,255,255,0.7)" : "rgba(11,27,43,0.62)",
        background: dark ? "rgba(11,27,43,0.5)" : "rgba(247,249,244,0.86)",
        padding: "6px 12px",
        borderRadius: 8,
      }}
    >
      {text}
      {line2 ? <div>{line2}</div> : null}
    </div>
  );
};

/** Small corner tag (top-right by default): reference numbers, "what if", recording overlays. */
export const CornerTag: React.FC<{ text: string; at?: number; out?: number; side?: "tr" | "tl"; tone?: "ink" | "light" | "lime" | "amber"; top?: number; mono?: boolean; style?: React.CSSProperties }> = ({
  text,
  at = 0,
  out,
  side = "tr",
  tone = "light",
  top = 32,
  mono = true,
  style,
}) => {
  const frame = useCurrentFrame();
  const k = env(frame, at, out, 10);
  if (k <= 0.001) return null;
  const bg = tone === "ink" ? P.ink : tone === "lime" ? P.signal : tone === "amber" ? P.alert : "rgba(255,255,255,0.92)";
  const fg = tone === "ink" ? P.white : P.ink;
  return (
    <div
      style={{
        position: "absolute",
        top,
        [side === "tr" ? "right" : "left"]: 40,
        opacity: k,
        transform: `translateY(${(1 - k) * -8}px)`,
        background: bg,
        color: fg,
        fontFamily: mono ? F.mono : F.body,
        fontWeight: mono ? 500 : 600,
        fontSize: 16,
        padding: "8px 14px",
        borderRadius: 999,
        border: tone === "light" ? `1px solid ${P.line}` : undefined,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {text}
    </div>
  );
};

/** A typeset figure lifting off a page: mono number + Inter label on a white card. */
export const FigureCard: React.FC<{ value: string; label: string; sub?: string; k: number; size?: number; style?: React.CSSProperties }> = ({ value, label, sub, k, size = 150, style }) => (
  <div
    style={{
      display: "inline-flex",
      flexDirection: "column",
      gap: 6,
      padding: "28px 44px 30px",
      borderRadius: 28,
      background: P.white,
      boxShadow: SHADOW_LIFT,
      opacity: Math.min(1, k * 1.5),
      transform: `translateY(${(1 - k) * 40}px) scale(${0.94 + 0.06 * k})`,
      ...style,
    }}
  >
    <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: size, lineHeight: 1, color: P.ink, letterSpacing: -size * 0.03, whiteSpace: "nowrap" }}>{value}</div>
    <div style={{ fontFamily: F.body, fontWeight: 500, fontSize: Math.max(26, size * 0.2), color: P.slate }}>{label}</div>
    {sub ? <div style={{ fontFamily: F.body, fontWeight: 500, fontSize: Math.max(20, size * 0.15), color: P.slate, opacity: 0.85 }}>{sub}</div> : null}
  </div>
);

/** Rubber stamp (ink outline, mono caps). Thumps in at `at`. */
export const Stamp: React.FC<{ text: string; at: number; color?: string; size?: number; rotate?: number; style?: React.CSSProperties }> = ({ text, at, color = P.ink, size = 64, rotate = -6, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: frame - at, fps, config: { damping: 11, stiffness: 220 } });
  if (k < 0.01) return null;
  return (
    <div
      style={{
        display: "inline-block",
        transform: `rotate(${rotate}deg) scale(${1.6 - 0.6 * k})`,
        opacity: Math.min(1, k * 1.6),
        border: `${Math.round(size / 11)}px solid ${color}`,
        borderRadius: size * 0.2,
        padding: `${size * 0.08}px ${size * 0.4}px`,
        fontFamily: F.mono,
        fontWeight: 700,
        fontSize: size,
        letterSpacing: size * 0.12,
        color,
        background: "rgba(255,255,255,0.35)",
        ...style,
      }}
    >
      {text}
    </div>
  );
};

/** Status pill (Inter 600 caps) in the colour language of the film. */
export const StatusPill: React.FC<{ text: string; tone: "verified" | "alert" | "ink" | "danger" | "lime" | "outline-amber" | "outline-ink"; size?: number; style?: React.CSSProperties }> = ({
  text,
  tone,
  size = 18,
  style,
}) => {
  const map = {
    verified: { bg: P.verified, fg: P.white, bd: "none" },
    alert: { bg: P.alert, fg: P.ink, bd: "none" },
    ink: { bg: P.ink, fg: P.white, bd: "none" },
    danger: { bg: P.danger, fg: P.white, bd: "none" },
    lime: { bg: P.signal, fg: P.ink, bd: "none" },
    "outline-amber": { bg: "rgba(255,176,32,0.08)", fg: P.ink, bd: `2px solid ${P.alert}` },
    "outline-ink": { bg: P.white, fg: P.ink, bd: `2px solid ${P.ink}` },
  }[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: `${size * 0.32}px ${size * 0.8}px`,
        borderRadius: 999,
        background: map.bg,
        color: map.fg,
        border: map.bd,
        fontFamily: F.mono,
        fontWeight: 700,
        fontSize: size,
        letterSpacing: 0.5,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {text}
    </span>
  );
};

/** Small label (Inter 600) used for callouts beside objects. */
export const Label: React.FC<{ children: React.ReactNode; size?: number; color?: string; mono?: boolean; style?: React.CSSProperties }> = ({ children, size = 20, color = P.ink, mono = false, style }) => (
  <div style={{ fontFamily: mono ? F.mono : F.body, fontWeight: mono ? 700 : 600, fontSize: size, color, whiteSpace: "nowrap", ...style }}>{children}</div>
);

/** Desaturate wrapper for the S05g "what if" set. */
export const Grade: React.FC<{ desat: number; children?: React.ReactNode }> = ({ desat, children }) => (
  <AbsoluteFill style={{ filter: desat > 0.001 ? `saturate(${1 - desat})` : undefined }}>{children}</AbsoluteFill>
);
