import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { P } from "../assets/palette";
import { F } from "../theme";
import { IN_OUT_CUBIC, clamp } from "./kit";
import { SHOTS, ShotId, footageFile, hasFootage, headTrim, slotParts } from "./footage";

/**
 * Slot for a screen recording. Plays public/footage/<shot>.mp4 when the footage manifest lists
 * it; otherwise renders a clearly marked placeholder card with the shot name, its length, the
 * shot-list step and what must be on screen. Punch-ins (`punches`, normalised recording
 * coordinates) apply to both, so the timing of every zoom can be reviewed before recording.
 */

export type Punch = {
  /** Slot-relative frame the punch-in starts (12 f ease in). */
  from: number;
  /** Frame the punch-out starts (12 f ease out). */
  to: number;
  scale: number;
  /** Centre of the region in the recording, 0..1. */
  cx: number;
  cy: number;
  /** What the region is (placeholder label only). */
  label?: string;
};

const punchAt = (frame: number, punches: Punch[]) => {
  let s = 1;
  let cx = 0.5;
  let cy = 0.5;
  for (const p of punches) {
    const t = Math.min(
      interpolate(frame, [p.from, p.from + 12], [0, 1], { ...clamp, easing: IN_OUT_CUBIC }),
      interpolate(frame, [p.to, p.to + 12], [1, 0], { ...clamp, easing: IN_OUT_CUBIC }),
    );
    if (t > 0) {
      s = 1 + (p.scale - 1) * t;
      cx = 0.5 + (p.cx - 0.5) * t;
      cy = 0.5 + (p.cy - 0.5) * t;
    }
  }
  return { s, cx, cy };
};

export const Footage: React.FC<{
  shot: ShotId;
  /** Slot length in frames (defaults to the shot's planned length). */
  frames?: number;
  /** Seconds to skip at the head of the recording. */
  trimBefore?: number;
  playbackRate?: number;
  punches?: Punch[];
  volume?: number;
  /** Placeholder card scale (1 = sized for a ~1440 px frame). */
  cardScale?: number;
}> = ({ shot, frames, trimBefore, playbackRate = 1, punches = [], volume = 0, cardScale }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const info = SHOTS[shot];
  const len = frames ?? Math.round(info.seconds * fps);
  const { s, cx, cy } = punchAt(frame, punches);
  // keep the zoomed region on screen: translate so (cx, cy) moves toward the centre
  const tx = (0.5 - cx) * (s - 1) * 100;
  const ty = (0.5 - cy) * (s - 1) * 100;
  const transform = `translate(${tx}%, ${ty}%) scale(${s})`;

  const parts = slotParts(shot);
  if (parts) {
    let at = 0;
    return (
      <AbsoluteFill style={{ overflow: "hidden", background: P.white }}>
        <AbsoluteFill style={{ transform, transformOrigin: "50% 50%" }}>
          {parts.map((p, i) => {
            const from = at;
            at += p.frames;
            const last = i === parts.length - 1;
            return (
              <Sequence key={p.file + i} from={from} durationInFrames={last ? undefined : p.frames} layout="none">
                <AbsoluteFill>
                  <OffthreadVideo src={staticFile(`footage/${p.file}`)} trimBefore={Math.round(p.trimBefore * fps)} playbackRate={p.playbackRate ?? 1} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </AbsoluteFill>
              </Sequence>
            );
          })}
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  if (hasFootage(shot)) {
    return (
      <AbsoluteFill style={{ overflow: "hidden", background: P.white }}>
        <AbsoluteFill style={{ transform, transformOrigin: "50% 50%" }}>
          <OffthreadVideo
            src={staticFile(`footage/${footageFile(shot)}`)}
            trimBefore={Math.round((trimBefore ?? headTrim(shot)) * fps)}
            playbackRate={playbackRate}
            volume={volume}
            muted={volume === 0}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  const t = Math.max(0, Math.min(1, frame / len));
  const unit = cardScale ?? Math.min(width, height * 1.78) / 1920;
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#F2F4EF" }}>
      {/* schematic page under the card, zooming with the punches */}
      <AbsoluteFill style={{ transform, transformOrigin: "50% 50%" }}>
        <svg width="100%" height="100%" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">
          <rect width={1920} height={1080} fill="#F2F4EF" />
          <rect x={0} y={0} width={1920} height={84} fill={P.white} />
          <rect x={60} y={30} width={180} height={24} rx={12} fill={P.line} />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={980 + i * 150} y={34} width={110} height={16} rx={8} fill={P.mist} />
          ))}
          {[0, 1, 2].map((i) => (
            <rect key={i} x={60 + i * 610} y={150} width={570} height={360} rx={24} fill={P.white} stroke={P.line} strokeWidth={2} />
          ))}
          <rect x={60} y={560} width={1800} height={440} rx={24} fill={P.white} stroke={P.line} strokeWidth={2} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x={110} y={620 + i * 60} width={900 - i * 90} height={18} rx={9} fill={P.mist} />
          ))}
          {punches.map((p, i) => {
            const on = frame >= p.from - 20 && frame < p.to + 12;
            if (!on) return null;
            const w = 1920 / p.scale;
            const h = 1080 / p.scale;
            return (
              <g key={i}>
                <rect x={p.cx * 1920 - w / 2} y={p.cy * 1080 - h / 2} width={w} height={h} rx={10} fill="none" stroke={P.ink} strokeWidth={3} strokeDasharray="12 10" opacity={0.55} />
                {p.label ? (
                  <text x={p.cx * 1920 - w / 2 + 14} y={p.cy * 1080 - h / 2 + 32} fontFamily={F.mono} fontSize={22} fontWeight={700} fill={P.ink} opacity={0.6}>
                    punch-in · {p.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </AbsoluteFill>
      {/* the card */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: 1180 * unit,
            padding: `${36 * unit}px ${44 * unit}px`,
            borderRadius: 26 * unit,
            background: "rgba(255,255,255,0.95)",
            border: `${3 * unit}px dashed ${P.alert}`,
            boxShadow: "0 24px 48px -28px rgba(11,27,43,0.35)",
            fontFamily: F.body,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 * unit }}>
            <span style={{ background: P.alert, color: P.ink, fontFamily: F.mono, fontWeight: 700, fontSize: 20 * unit, padding: `${6 * unit}px ${14 * unit}px`, borderRadius: 999, letterSpacing: 1 }}>RECORDING PLACEHOLDER</span>
            <span style={{ fontFamily: F.mono, fontSize: 20 * unit, color: P.slate }}>
              {info.list} · {info.scene}
            </span>
          </div>
          <div style={{ marginTop: 18 * unit, fontFamily: F.mono, fontWeight: 700, fontSize: 46 * unit, color: P.ink }}>public/footage/{footageFile(shot)}</div>
          <div style={{ marginTop: 6 * unit, fontFamily: F.mono, fontSize: 22 * unit, color: P.slate }}>
            {(len / fps).toFixed(1)} s slot · {info.url}
          </div>
          <div style={{ marginTop: 18 * unit, display: "flex", flexDirection: "column", gap: 8 * unit }}>
            {info.show.map((l) => (
              <div key={l} style={{ fontSize: 24 * unit, color: P.ink, display: "flex", gap: 12 * unit }}>
                <span style={{ color: P.slate }}>—</span>
                {l}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 22 * unit, height: 8 * unit, borderRadius: 4 * unit, background: P.mist, overflow: "hidden" }}>
            <div style={{ width: `${t * 100}%`, height: "100%", background: P.ink }} />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
