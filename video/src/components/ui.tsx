import React from "react";
import { interpolate, interpolateColors, useCurrentFrame } from "remotion";
import { C, F, RADIUS, SHADOW_CARD } from "../theme";
import { EASE, prog } from "../lib/anim";

/** Masked line reveal: the line rises out of its own baseline. */
export const Reveal: React.FC<{
  delay?: number;
  duration?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  out?: number; // frame at which it starts leaving (optional)
}> = ({ delay = 0, duration = 22, children, style, out }) => {
  const frame = useCurrentFrame();
  const p = prog(frame, delay, delay + duration);
  const o = out === undefined ? 0 : prog(frame, out, out + 14);
  return (
    <span
      style={{
        display: "block",
        overflow: "hidden",
        paddingBottom: "0.08em",
        marginBottom: "-0.08em",
        ...style,
      }}
    >
      <span
        style={{
          display: "block",
          translate: `0 ${(1 - p) * 105 - o * 105}%`,
          opacity:
            interpolate(p, [0, 0.3], [0, 1], { extrapolateRight: "clamp" }) *
            (1 - o),
        }}
      >
        {children}
      </span>
    </span>
  );
};

/** Lime highlight marker drawn behind a word, as on the product site. */
export const Mark: React.FC<{
  delay?: number;
  duration?: number;
  onDark?: boolean;
  color?: string;
  children: React.ReactNode;
}> = ({
  delay = 0,
  duration = 16,
  onDark = false,
  color = C.signal,
  children,
}) => {
  const frame = useCurrentFrame();
  const p = prog(frame, delay, delay + duration);
  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          position: "absolute",
          left: "-0.1em",
          right: "-0.1em",
          top: "0.08em",
          bottom: "0.02em",
          background: color,
          borderRadius: "0.08em",
          scale: `${p} 1`,
          transformOrigin: "left center",
        }}
      />
      <span
        style={{
          position: "relative",
          color: onDark
            ? interpolateColors(p, [0.2, 0.6], [C.paper, C.ink])
            : C.ink,
        }}
      >
        {children}
      </span>
    </span>
  );
};

export const Eyebrow: React.FC<{
  children: React.ReactNode;
  onDark?: boolean;
  style?: React.CSSProperties;
}> = ({ children, onDark, style }) => (
  <div
    style={{
      fontFamily: F.mono,
      fontSize: 22,
      fontWeight: 500,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: onDark ? "rgba(247,249,244,0.62)" : C.slate,
      ...style,
    }}
  >
    {children}
  </div>
);

export type Tone = "verified" | "alert" | "ink" | "danger" | "slate";

const TONES: Record<
  Tone,
  { bg: string; fg: string; ring: string; dot: string }
> = {
  verified: {
    bg: "rgba(0,196,106,0.12)",
    fg: "#00733e",
    ring: "rgba(0,196,106,0.35)",
    dot: C.verified,
  },
  alert: {
    bg: "rgba(255,176,32,0.18)",
    fg: "#8a5300",
    ring: "rgba(255,176,32,0.5)",
    dot: C.alert,
  },
  ink: { bg: C.ink, fg: C.paper, ring: C.ink, dot: C.signal },
  danger: {
    bg: "rgba(229,72,77,0.12)",
    fg: "#a1191e",
    ring: "rgba(229,72,77,0.35)",
    dot: C.danger,
  },
  slate: {
    bg: "rgba(11,27,43,0.06)",
    fg: C.slate,
    ring: "rgba(11,27,43,0.12)",
    dot: C.slate,
  },
};
const DARK_TONES: Record<
  Tone,
  { bg: string; fg: string; ring: string; dot: string }
> = {
  verified: {
    bg: "rgba(0,196,106,0.2)",
    fg: "#7CF0B5",
    ring: "rgba(0,196,106,0.45)",
    dot: C.verified,
  },
  alert: {
    bg: "rgba(255,176,32,0.2)",
    fg: C.alert,
    ring: "rgba(255,176,32,0.5)",
    dot: C.alert,
  },
  ink: { bg: C.signal, fg: C.ink, ring: C.signal, dot: C.ink },
  danger: {
    bg: "rgba(229,72,77,0.25)",
    fg: "#FFB4B6",
    ring: "rgba(229,72,77,0.5)",
    dot: C.danger,
  },
  slate: {
    bg: "rgba(247,249,244,0.1)",
    fg: C.paper,
    ring: "rgba(247,249,244,0.2)",
    dot: C.paper,
  },
};

/** Status pill: Active (verified), Paused (alert), Settled (ink). */
export const Pill: React.FC<{
  tone?: Tone;
  onDark?: boolean;
  size?: number;
  dot?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ tone = "slate", onDark, size = 24, dot = true, children, style }) => {
  const t = (onDark ? DARK_TONES : TONES)[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.45,
        padding: `${size * 0.32}px ${size * 0.75}px`,
        borderRadius: 999,
        background: t.bg,
        color: t.fg,
        boxShadow: `inset 0 0 0 2px ${t.ring}`,
        fontFamily: F.body,
        fontWeight: 600,
        fontSize: size,
        lineHeight: 1,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {dot && (
        <span
          style={{
            width: size * 0.38,
            height: size * 0.38,
            borderRadius: 999,
            background: t.dot,
          }}
        />
      )}
      {children}
    </span>
  );
};

/** Monospace hash or address in a soft pill. */
export const HashPill: React.FC<{
  label?: string;
  value: string;
  onDark?: boolean;
  size?: number;
  style?: React.CSSProperties;
}> = ({ label, value, onDark, size = 24, style }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: size * 0.6,
      padding: `${size * 0.42}px ${size * 0.7}px`,
      borderRadius: size * 0.55,
      background: onDark ? "rgba(247,249,244,0.08)" : "rgba(11,27,43,0.05)",
      boxShadow: onDark
        ? "inset 0 0 0 1.5px rgba(247,249,244,0.12)"
        : "inset 0 0 0 1.5px rgba(11,27,43,0.08)",
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {label && (
      <span
        style={{
          fontFamily: F.body,
          fontSize: size * 0.82,
          fontWeight: 500,
          color: onDark ? "rgba(247,249,244,0.7)" : C.slate,
        }}
      >
        {label}
      </span>
    )}
    <span
      style={{
        fontFamily: F.mono,
        fontSize: size,
        fontWeight: 500,
        color: onDark ? C.paper : C.ink,
        letterSpacing: "-0.01em",
      }}
    >
      {value}
    </span>
  </span>
);

export const Card: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
  dark?: boolean;
}> = ({ children, style, dark }) => (
  <div
    style={{
      borderRadius: RADIUS,
      background: dark ? C.ink2 : "#FFFFFF",
      boxShadow: dark
        ? "inset 0 0 0 1.5px rgba(247,249,244,0.08), 0 30px 60px -30px rgba(0,0,0,0.6)"
        : `inset 0 0 0 1.5px ${C.line}, ${SHADOW_CARD}`,
      ...style,
    }}
  >
    {children}
  </div>
);

/** Rise + fade entrance helper for cards and blocks. */
export const useRise = (delay: number, distance = 40, duration = 24) => {
  const frame = useCurrentFrame();
  const p = prog(frame, delay, delay + duration, EASE);
  return {
    opacity: p,
    translate: `0 ${(1 - p) * distance}px`,
  } as React.CSSProperties;
};
