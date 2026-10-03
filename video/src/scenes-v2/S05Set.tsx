import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { P } from "../assets/palette";
import { Character, CharacterName, CharacterProps } from "../characters";
import { Camera, MAP_MILESTONES, MAP_T, Milestone, Place, PORTS, RouteMap } from "../maps";
import { F } from "../theme";
import { CornerTag, SHADOW } from "./kit";

/**
 * The S05 set: one map-and-stage set for the seven "how it works" beats. The map sits in a top
 * band (the through-line becomes the sea route), characters and mechanisms play on the stage
 * below. The README reference numbers ride in the top-right corner for the whole of S05.
 */

export const BAND_H = 560;
export const T = MAP_T;
export const COLOMBO = PORTS.colombo.ll;

export const CAM_WIDE: Camera = { lon: 88.4, lat: 10.3, zoom: 0.8 };
export const CAM_COLOMBO: Camera = { lon: 79.3, lat: 7.2, zoom: 2.6 };

export const RefTag: React.FC<{ at?: number }> = ({ at = 0 }) => (
  <CornerTag text="Reference numbers · 100,000 USDG invoice · 40,000 facility · 3% fee" at={at} top={26} />
);

/** Milestone pips with per-pip visibility / reached state. Labels follow MAP_MILESTONES. */
export const pips = (show: number[] | number, reached: boolean[] = [], labels = true): Milestone[] =>
  MAP_MILESTONES.map((m, i) => ({
    ...m,
    label: labels && i !== 0 ? m.label : "",
    show: Array.isArray(show) ? show[i] ?? 0 : show,
    reached: reached[i] ?? false,
  }));

export const MapBand: React.FC<{
  camera: Camera;
  progress?: number;
  routeDraw?: number;
  landIn?: number;
  portsIn?: number[];
  milestones?: Milestone[];
  places?: Place[];
  colorStops?: { at: number; color: string }[];
  excursion?: { t?: number; label?: string } | null;
  shipStatus?: "ok" | "paused" | "excursion";
  shipLabel?: string;
  ship?: boolean;
  height?: number;
  top?: number;
  scaleBar?: boolean;
}> = ({ height = BAND_H, top = 0, ...p }) => (
  <div style={{ position: "absolute", left: 0, top, width: 1920, height, overflow: "hidden", borderBottom: `1px solid ${P.line}` }}>
    <RouteMap width={1920} height={height} attribution={false} scaleBar={p.scaleBar ?? true} {...p} />
  </div>
);

/** A small rounded inset of a cast member (bust), with a mono label. */
export const Inset: React.FC<CharacterProps & { who: CharacterName; size?: number; label?: string; k?: number; style?: React.CSSProperties }> = ({ who, size = 220, label, k = 1, style, ...rest }) => (
  <div
    style={{
      width: size,
      borderRadius: 24,
      background: P.white,
      boxShadow: SHADOW,
      overflow: "hidden",
      opacity: Math.min(1, k * 1.5),
      transform: `translateY(${(1 - k) * 24}px) scale(${0.94 + 0.06 * k})`,
      ...style,
    }}
  >
    <div style={{ height: size * 0.92, display: "flex", justifyContent: "center", alignItems: "flex-end", background: P.mist, overflow: "hidden" }}>
      <Character who={who} crop="bust" scale={(size * 0.92) / 300} {...rest} />
    </div>
    {label ? <div style={{ padding: "8px 12px", fontFamily: F.mono, fontSize: 14, color: P.slate, textAlign: "center" }}>{label}</div> : null}
  </div>
);

/** Ground under the stage: paper with the dot grid is the Stage itself; this is the desk line. */
export const DeskLine: React.FC<{ y?: number }> = ({ y = 1000 }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <div style={{ position: "absolute", left: 0, top: y, width: 1920, height: 3, background: P.ink, opacity: 0.12 }} />
  </AbsoluteFill>
);

/** Vault geometry helpers (TrancheVault viewBox 360 x 440). */
export const vaultDrawer = (left: number, top: number, width: number, i: number) => {
  const s = width / 360;
  return { x: left + 167 * s, y: top + (62 + i * 70 + 29) * s };
};
export const vaultSlot = (left: number, top: number, width: number) => {
  const s = width / 360;
  return { x: left + 340 * s, y: top + 205 * s };
};

export type MiniRow = { block: number; call: string; hash: string; at?: number; tickAt?: number; tone?: "ink" | "verified" | "alert" | "danger"; note?: string };

/**
 * Compact ledger (the chain as ruled rows, never cubes) for the S05 stage: mono block number,
 * contract call typing on (10 f), hash, an emerald tick when the contract verifies. Shows the
 * last `visible` rows that have started.
 */
export const LedgerMini: React.FC<{ rows: MiniRow[]; width?: number; visible?: number; title?: string }> = ({ rows, width = 640, visible = 3, title = "Robinhood Chain · ledger" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const started = rows.filter((r) => r.at === undefined || frame >= r.at).slice(-visible);
  const tone = { ink: P.ink, verified: P.verified, alert: P.alert, danger: P.danger };
  return (
    <div style={{ width, borderRadius: 14, background: P.white, border: `1.5px solid ${P.line}`, padding: "10px 0 6px", boxShadow: "0 18px 36px -28px rgba(11,27,43,0.35)", fontFamily: F.mono }}>
      <div style={{ padding: "0 16px 6px", fontSize: 12, letterSpacing: 1.2, color: P.slate }}>{title.toUpperCase()}</div>
      {Array.from({ length: visible }).map((_, i) => {
        const r = started[i];
        const t = r ? (r.at === undefined ? 1 : interpolate(frame, [r.at, r.at + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })) : 0;
        const tick = r && r.tickAt !== undefined ? spring({ frame: frame - r.tickAt, fps, config: { damping: 13, stiffness: 170 } }) : 0;
        return (
          <div key={i} style={{ height: 40, display: "flex", alignItems: "center", gap: 12, padding: "0 16px", borderTop: `1.5px solid ${P.line}` }}>
            {r ? (
              <>
                <span style={{ fontSize: 15, color: P.slate, width: 104 }}>#{r.block.toLocaleString("en-US")}</span>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: tone[r.tone ?? "ink"], opacity: t }} />
                <span style={{ fontSize: 18, fontWeight: 700, color: P.ink, whiteSpace: "nowrap" }}>{r.call.slice(0, Math.ceil(r.call.length * t))}</span>
                {r.note ? <span style={{ fontSize: 14, color: P.slate, opacity: t, whiteSpace: "nowrap" }}>{r.note}</span> : null}
                <span style={{ marginLeft: "auto", fontSize: 14, color: P.slate, opacity: t }}>{r.hash}</span>
                <span style={{ width: 24, height: 24, borderRadius: 12, background: P.verified, transform: `scale(${tick})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width={14} height={14} viewBox="-7 -7 14 14">
                    <path d="M-4.5 0.5 l3 3 l6 -6" stroke={P.white} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
