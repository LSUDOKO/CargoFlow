import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C } from "../theme";

/** Paper surface with the product's faint 40px grid. */
export const PaperBg: React.FC<{ grid?: boolean }> = ({ grid = true }) => (
  <AbsoluteFill style={{ background: C.paper }}>
    {grid && (
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(11,27,43,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(11,27,43,0.045) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse 80% 75% at 50% 45%, black 40%, transparent 100%)",
        }}
      />
    )}
  </AbsoluteFill>
);

/** Ink surface: navy with a soft teal bloom and vignette. */
export const InkBg: React.FC<{ grid?: boolean; bloom?: string }> = ({
  grid = false,
  bloom = "rgba(10,90,115,0.45)",
}) => (
  <AbsoluteFill style={{ background: C.ink }}>
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse 70% 60% at 70% 30%, ${bloom}, transparent 70%)`,
      }}
    />
    {grid && (
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(247,249,244,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(247,249,244,0.04) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse 80% 70% at 50% 45%, black 30%, transparent 100%)",
        }}
      />
    )}
    <Vignette />
  </AbsoluteFill>
);

export const Vignette: React.FC<{ strength?: number }> = ({
  strength = 0.55,
}) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse 85% 80% at 50% 50%, transparent 55%, rgba(5,12,20,${strength}) 100%)`,
      pointerEvents: "none",
    }}
  />
);

/**
 * Slow Ken Burns move over a still, graded into the navy palette.
 * `from`/`to` are [scale, x%, y%].
 */
export const KenBurns: React.FC<{
  src: string;
  from?: [number, number, number];
  to?: [number, number, number];
  dim?: number; // 0..1 navy overlay strength
  blur?: number;
}> = ({
  src,
  from = [1.04, 0, 0],
  to = [1.16, -2, -1],
  dim = 0.45,
  blur = 0,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const s = from[0] + (to[0] - from[0]) * t;
  const x = from[1] + (to[1] - from[1]) * t;
  const y = from[2] + (to[2] - from[2]) * t;
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: C.ink }}>
      <Img
        src={staticFile(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          scale: String(s),
          translate: `${x}% ${y}%`,
          filter: `saturate(0.85) contrast(1.05)${blur ? ` blur(${blur}px)` : ""}`,
        }}
      />
      {/* navy grade */}
      <AbsoluteFill
        style={{ background: C.ink, opacity: dim, mixBlendMode: "multiply" }}
      />
      <AbsoluteFill
        style={{
          background: "rgba(10,90,115,0.18)",
          mixBlendMode: "soft-light",
        }}
      />
    </AbsoluteFill>
  );
};
