import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { EASE, EASE_IN_OUT } from "../lib/anim";

/**
 * A timed sub-shot inside a scene. Children see a local frame starting at 0.
 * Fades in over `fadeIn` and out over the last `fadeOut` frames (0 = hard hold).
 */
export const Beat: React.FC<{
  from: number;
  duration: number;
  fadeIn?: number;
  fadeOut?: number;
  name?: string;
  children: React.ReactNode;
}> = ({ from, duration, fadeIn = 12, fadeOut = 12, name, children }) => (
  <Sequence from={from} durationInFrames={duration} name={name}>
    <BeatFade duration={duration} fadeIn={fadeIn} fadeOut={fadeOut}>
      {children}
    </BeatFade>
  </Sequence>
);

const BeatFade: React.FC<{
  duration: number;
  fadeIn: number;
  fadeOut: number;
  children: React.ReactNode;
}> = ({ duration, fadeIn, fadeOut, children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const end = Math.min(duration, durationInFrames);
  const a =
    fadeIn > 0
      ? interpolate(frame, [0, fadeIn], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: EASE,
        })
      : 1;
  const b =
    fadeOut > 0
      ? interpolate(frame, [end - fadeOut, end], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: EASE_IN_OUT,
        })
      : 1;
  return <AbsoluteFill style={{ opacity: a * b }}>{children}</AbsoluteFill>;
};
