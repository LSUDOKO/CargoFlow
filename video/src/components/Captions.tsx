import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  interpolate,
  staticFile,
  useCurrentFrame,
  useDelayRender,
  useVideoConfig,
} from "remotion";
import { C, F } from "../theme";

export type CaptionLine = { startMs: number; endMs: number; text: string };

/**
 * Reads public/captions.json (remotion.config.ts copies video/captions.json there on
 * every studio/render start). Accepts an array of {startMs,endMs,text} or {captions:[...]}.
 * A missing or malformed file renders nothing.
 */
export const Captions: React.FC<{
  file?: string;
  /** Extra distance from the bottom edge in px (the bar is raised clear of the browser frame during S4). */
  lift?: number;
}> = ({ file = "captions.json", lift = 0 }) => {
  const [lines, setLines] = useState<CaptionLine[] | null>(null);
  const { delayRender, continueRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Loading captions"));

  useEffect(() => {
    let done = false;
    const finish = (l: CaptionLine[]) => {
      if (done) return;
      done = true;
      setLines(l);
      continueRender(handle);
    };
    fetch(staticFile(file))
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        const arr = Array.isArray(data)
          ? data
          : (data as { captions?: unknown })?.captions;
        const clean = (Array.isArray(arr) ? arr : []).filter(
          (c): c is CaptionLine =>
            !!c &&
            typeof c.text === "string" &&
            typeof c.startMs === "number" &&
            typeof c.endMs === "number",
        );
        finish(clean);
      })
      .catch(() => finish([]));
  }, [file, handle, continueRender]);

  if (!lines || lines.length === 0) return null;
  return <CaptionTrack lines={lines} lift={lift} />;
};

const CaptionTrack: React.FC<{ lines: CaptionLine[]; lift: number }> = ({
  lines,
  lift,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  const line = lines.find((l) => ms >= l.startMs && ms < l.endMs);
  if (!line) return null;
  const fade = Math.min(
    interpolate(ms, [line.startMs, line.startMs + 120], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
    interpolate(ms, [line.endMs - 120, line.endMs], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 46 + lift,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: 1400,
          padding: "12px 26px 14px",
          borderRadius: 14,
          background: "rgba(11,27,43,0.82)",
          boxShadow: "inset 0 0 0 1px rgba(247,249,244,0.08)",
          fontFamily: F.body,
          fontWeight: 500,
          fontSize: 36,
          lineHeight: 1.3,
          color: C.paper,
          textAlign: "center",
          opacity: fade,
          textWrap: "balance",
        }}
      >
        {line.text.trim()}
      </div>
    </AbsoluteFill>
  );
};
