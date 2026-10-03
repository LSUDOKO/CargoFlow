import { interpolate, spring } from "remotion";
import { hash } from "../assets/palette";

export type Expression =
  | "neutral"
  | "worried"
  | "relieved"
  | "happy"
  | "determined"
  | "skeptical"
  | "confident"
  | "surprised"
  | "focused";

export type Pose = "stand" | "hold" | "crossed" | "hips" | "thinking";
export type Gesture = "none" | "wave" | "point" | "present" | "thumbsUp";
export type Look = "left" | "right" | "front" | number;
export type HeldItem =
  | "none"
  | "tablet"
  | "bol"
  | "invoice"
  | "umbrella"
  | "phone"
  | "folder"
  | "vial"
  | "logger"
  | "pencil";

/** Numeric face parameters; every expression is a point in this space so they blend. */
export type FaceParams = {
  browTilt: number; // + = inner ends raised (worry), - = inner ends lowered (resolve)
  browLift: number; // px up
  browAsym: number; // px: raises the screen-right brow only (skeptical)
  eyeOpen: number; // 1 normal, <1 narrowed, >1 wide
  eyeSmile: number; // 0..1 morphs eyes into upward arcs
  mouthCurve: number; // -1 frown .. 1 smile
  mouthOpen: number; // 0..1
  mouthWidth: number; // px half-width
  mouthSkew: number; // px, lifts one corner (smirk)
  teeth: number; // 0..1
  blush: number; // 0..1
  tilt: number; // head tilt degrees
};

export const EXPRESSIONS: Record<Expression, FaceParams> = {
  neutral: { browTilt: 0, browLift: 0, browAsym: 0, eyeOpen: 1, eyeSmile: 0, mouthCurve: 0.25, mouthOpen: 0, mouthWidth: 9, mouthSkew: 0, teeth: 0, blush: 0, tilt: 0 },
  worried: { browTilt: 5, browLift: 2, browAsym: 0, eyeOpen: 1.05, eyeSmile: 0, mouthCurve: -0.55, mouthOpen: 0.08, mouthWidth: 7, mouthSkew: 1.5, teeth: 0, blush: 0, tilt: -3 },
  relieved: { browTilt: 2, browLift: 3, browAsym: 0, eyeOpen: 1, eyeSmile: 1, mouthCurve: 0.7, mouthOpen: 0, mouthWidth: 10, mouthSkew: 0, teeth: 0, blush: 0.6, tilt: 3 },
  happy: { browTilt: 0, browLift: 3, browAsym: 0, eyeOpen: 1, eyeSmile: 0.55, mouthCurve: 1, mouthOpen: 0.55, mouthWidth: 11, mouthSkew: 0, teeth: 1, blush: 0.8, tilt: 2 },
  determined: { browTilt: -4, browLift: -1.5, browAsym: 0, eyeOpen: 0.9, eyeSmile: 0, mouthCurve: 0.1, mouthOpen: 0, mouthWidth: 9, mouthSkew: 1.5, teeth: 0, blush: 0, tilt: 0 },
  skeptical: { browTilt: -1, browLift: -1, browAsym: 5, eyeOpen: 0.85, eyeSmile: 0, mouthCurve: -0.15, mouthOpen: 0, mouthWidth: 8, mouthSkew: 3, teeth: 0, blush: 0, tilt: -2 },
  confident: { browTilt: -1, browLift: 1, browAsym: 0, eyeOpen: 0.95, eyeSmile: 0.25, mouthCurve: 0.8, mouthOpen: 0.15, mouthWidth: 11, mouthSkew: 2.5, teeth: 0.6, blush: 0.2, tilt: 2 },
  surprised: { browTilt: 1, browLift: 5, browAsym: 0, eyeOpen: 1.25, eyeSmile: 0, mouthCurve: 0, mouthOpen: 0.6, mouthWidth: 6, mouthSkew: 0, teeth: 0, blush: 0, tilt: 0 },
  focused: { browTilt: -2, browLift: -1, browAsym: 0, eyeOpen: 0.9, eyeSmile: 0, mouthCurve: 0.05, mouthOpen: 0, mouthWidth: 8, mouthSkew: 0, teeth: 0, blush: 0, tilt: 0 },
};

export const blendFace = (a: FaceParams, b: FaceParams, t: number): FaceParams => {
  const out = { ...a };
  (Object.keys(a) as (keyof FaceParams)[]).forEach((k) => {
    out[k] = a[k] + (b[k] - a[k]) * t;
  });
  return out;
};

/**
 * Eye openness 0..1. One blink per 4 s slot with ±0.5 s jitter, so blinks land every 3–5 s
 * and are fully deterministic from (frame, seed).
 */
export const blinkOpen = (frame: number, fps: number, seed: number) => {
  const slot = fps * 4;
  const shape = [1, 0.55, 0.1, 0.05, 0.35, 0.75, 1];
  const k = Math.floor(frame / slot);
  for (const kk of [k - 1, k]) {
    const t = kk * slot + slot * 0.5 + (hash(kk * 7.3 + seed) - 0.5) * fps;
    const d = Math.floor(frame - t);
    if (d >= 0 && d < shape.length) return shape[d];
  }
  return 1;
};

/** Mouth openness while talking: syllable-like segments of ~3 frames with soft blends. */
export const talkOpen = (frame: number, seed: number) => {
  const seg = 3.2;
  const i = Math.floor(frame / seg);
  const f = (frame % seg) / seg;
  const v = (n: number) => {
    const h = hash(n * 3.17 + seed * 11);
    return h < 0.18 ? 0.04 : 0.2 + h * 0.6;
  };
  const s = f * f * (3 - 2 * f);
  return v(i) + (v(i + 1) - v(i)) * s;
};

/** Idle breathing, ±1. Period 4.2 s. */
export const breath = (frame: number, fps: number, seed: number) =>
  Math.sin(((frame + seed * 17) / (fps * 4.2)) * Math.PI * 2);

/** In/out envelope for a gesture: spring in at `at`, spring out at `end`. */
export const gestureEnvelope = (
  frame: number,
  fps: number,
  at: number,
  end?: number,
) => {
  const cfg = { damping: 14, stiffness: 140, mass: 0.7 };
  const i = spring({ frame: frame - at, fps, config: cfg });
  const o =
    end === undefined ? 0 : spring({ frame: frame - end, fps, config: cfg });
  return Math.max(0, Math.min(1.08, i - o));
};

export const lookToNumber = (look: Look | undefined) =>
  look === "left" ? -1 : look === "right" ? 1 : look === "front" || look === undefined ? 0 : look;

export const clampLerp = (v: number, a: [number, number], b: [number, number]) =>
  interpolate(v, a, b, { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
