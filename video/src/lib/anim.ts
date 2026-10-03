import { Easing, interpolate } from "remotion";

/** Brand ease: fast out, long settle. Matches the product's cubic-bezier(0.16,1,0.3,1). */
export const EASE = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0..1 progress between two frames, eased. */
export const prog = (
  frame: number,
  start: number,
  end: number,
  easing: (t: number) => number = EASE,
) => interpolate(frame, [start, end], [0, 1], { ...clamp, easing });

/** Map a frame to an output range, clamped. */
export const lerp = (
  frame: number,
  input: [number, number],
  output: [number, number],
  easing: (t: number) => number = EASE,
) => interpolate(frame, input, output, { ...clamp, easing });

/** Fade in over [a,b] and out over [c,d]. */
export const inOut = (
  frame: number,
  a: number,
  b: number,
  c: number,
  d: number,
) =>
  interpolate(frame, [a, b, c, d], [0, 1, 1, 0], {
    ...clamp,
    easing: [EASE, Easing.linear, EASE_IN_OUT],
  });

/** Linear 0..1 along a path, for things that travel (coins, packets). */
export const travel = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], { ...clamp, easing: EASE_IN_OUT });

export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
