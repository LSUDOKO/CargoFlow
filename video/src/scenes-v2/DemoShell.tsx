import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { P } from "../assets/palette";
import { CharacterName, CharacterProps } from "../characters";
import { F } from "../theme";
import { Actor, OUT, clamp } from "./kit";
import { Footage, Punch } from "./Footage";
import { ShotId } from "./footage";

/**
 * Browser framing for the recorded segments (S06, S07, S10): light chrome with the real URL
 * (the path types on when the page changes), a 16:9 content area holding a <Footage> slot per
 * shot, cast members at the frame edges reacting to the UI, and small overlays top-right.
 */

export const FRAME = { x: 240, y: 70, w: 1440, chrome: 92 };
export const CONTENT_H = (FRAME.w * 9) / 16;

export type ShotSpec = {
  shot: ShotId;
  from: number;
  frames: number;
  url: string;
  title?: string;
  punches?: Punch[];
  trimBefore?: number;
  playbackRate?: number;
};

export type CastCue = CharacterProps & { who: CharacterName; side: "left" | "right"; from: number; to: number; h?: number };

const Chrome: React.FC<{ url: string; title: string; typeFrom: number }> = ({ url, title, typeFrom }) => {
  const frame = useCurrentFrame();
  const [host, ...rest] = url.split("/");
  const path = rest.length ? `/${rest.join("/")}` : "";
  const shown = Math.floor(interpolate(frame, [typeFrom, typeFrom + 10], [0, path.length], clamp));
  return (
    <div style={{ height: FRAME.chrome, background: P.white, borderBottom: `1px solid ${P.line}` }}>
      <div style={{ height: 44, display: "flex", alignItems: "center", gap: 14, padding: "0 18px", background: P.mist }}>
        <div style={{ display: "flex", gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 12, height: 12, borderRadius: 6, background: P.line }} />
          ))}
        </div>
        <div style={{ alignSelf: "flex-end", height: 34, minWidth: 240, background: P.white, borderRadius: "10px 10px 0 0", display: "flex", alignItems: "center", padding: "0 14px", fontFamily: F.body, fontSize: 14, color: P.ink }}>{title}</div>
      </div>
      <div style={{ height: 48, display: "flex", alignItems: "center", padding: "0 18px" }}>
        <div style={{ flex: 1, height: 32, borderRadius: 16, background: P.mist, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", fontFamily: F.body, fontSize: 16 }}>
          <svg width={12} height={14} viewBox="0 0 12 14">
            <rect x={1} y={6} width={10} height={8} rx={2} fill={P.slate} />
            <path d="M3 6 V4 a3 3 0 0 1 6 0 v2" stroke={P.slate} strokeWidth={1.8} fill="none" />
          </svg>
          <span style={{ color: P.ink }}>{host}</span>
          <span style={{ color: P.slate, marginLeft: -8 }}>{path.slice(0, shown)}</span>
        </div>
      </div>
    </div>
  );
};

export const DemoShell: React.FC<{
  shots: ShotSpec[];
  cast?: CastCue[];
  overlays?: { text: string; from: number; to: number }[];
  live?: string;
  footerTag?: string;
  children?: React.ReactNode;
}> = ({ shots, cast = [], overlays = [], live, footerTag, children }) => {
  const frame = useCurrentFrame();
  const current = shots.find((s) => frame >= s.from && frame < s.from + s.frames) ?? (frame < shots[0].from ? shots[0] : shots[shots.length - 1]);
  const enter = interpolate(frame, [0, 14], [0, 1], { ...clamp, easing: OUT });
  return (
    <AbsoluteFill style={{ background: P.paper }}>
      <AbsoluteFill style={{ backgroundImage: "radial-gradient(circle, rgba(11,27,43,0.08) 1.4px, transparent 1.6px)", backgroundSize: "24px 24px", backgroundPosition: "12px 12px" }} />
      <div
        style={{
          position: "absolute",
          left: FRAME.x,
          top: FRAME.y,
          width: FRAME.w,
          height: FRAME.chrome + CONTENT_H,
          borderRadius: 24,
          overflow: "hidden",
          background: P.white,
          border: `1px solid ${P.line}`,
          boxShadow: "0 2px 0 rgba(11,27,43,0.05), 0 40px 80px -36px rgba(11,27,43,0.4)",
          opacity: enter,
          transform: `translateY(${(1 - enter) * 16}px)`,
        }}
      >
        <Chrome url={current.url} title={current.title ?? "CargoFlow"} typeFrom={current.from} />
        <div style={{ position: "relative", width: FRAME.w, height: CONTENT_H, overflow: "hidden" }}>
          {shots.map((s, i) => (
            <Sequence key={s.shot + s.from} from={s.from} durationInFrames={s.frames + (i === shots.length - 1 ? 40 : 0)} name={s.shot}>
              <Footage shot={s.shot} frames={s.frames} punches={s.punches} trimBefore={s.trimBefore} playbackRate={s.playbackRate} />
            </Sequence>
          ))}
        </div>
      </div>

      {cast.map((c, i) => {
        if (frame < c.from - 10 || frame > c.to + 10) return null;
        const k = Math.min(interpolate(frame, [c.from - 10, c.from + 6], [0, 1], { ...clamp, easing: OUT }), interpolate(frame, [c.to - 6, c.to + 10], [1, 0], clamp));
        const { who, side, h = 420, ...cueRest } = c;
        const rest: CharacterProps = { ...cueRest };
        delete (rest as Partial<CastCue>).from;
        delete (rest as Partial<CastCue>).to;
        const x = side === "left" ? 150 : 1770;
        return <Actor key={i} who={who} x={x} y={1080} h={h} crop="waist" opacity={k} dx={(1 - k) * (side === "left" ? -80 : 80)} look={side === "left" ? 0.7 : -0.7} {...rest} />;
      })}

      {live ? (
        <div style={{ position: "absolute", left: FRAME.x, top: 20, display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", borderRadius: 999, background: P.ink, color: P.white, fontFamily: F.mono, fontSize: 15, fontWeight: 700, letterSpacing: 0.5, opacity: enter }}>
          <span style={{ width: 9, height: 9, borderRadius: 5, background: P.signal }} />
          {live}
        </div>
      ) : null}
      {overlays.map((o, i) => {
        const k = Math.min(interpolate(frame, [o.from, o.from + 10], [0, 1], { ...clamp, easing: OUT }), interpolate(frame, [o.to - 8, o.to], [1, 0], clamp));
        if (k <= 0.001) return null;
        return (
          <div key={i} style={{ position: "absolute", right: 1920 - FRAME.x - FRAME.w, top: 20, opacity: k, transform: `translateY(${(1 - k) * -8}px)`, padding: "7px 14px", borderRadius: 999, background: P.white, border: `1px solid ${P.line}`, fontFamily: F.mono, fontSize: 15, color: P.ink, whiteSpace: "nowrap" }}>
            {o.text}
          </div>
        );
      })}
      {footerTag ? (
        <div style={{ position: "absolute", left: FRAME.x, top: FRAME.y + FRAME.chrome + CONTENT_H + 12, fontFamily: F.body, fontWeight: 500, fontSize: 16, color: "rgba(11,27,43,0.6)" }}>{footerTag}</div>
      ) : null}
      {children}
    </AbsoluteFill>
  );
};
