/**
 * The cast's rig parameters, ported from video/src/characters/rig.ts without Remotion. Expressions are points in one
 * numeric face space, so the web shows exactly the faces the film shows.
 */
export type Expression = "neutral" | "worried" | "relieved" | "happy" | "determined" | "skeptical" | "confident" | "surprised" | "focused";
export type Pose = "stand" | "hold" | "crossed" | "hips" | "thinking";
export type Gesture = "none" | "wave" | "point" | "present" | "thumbsUp";
export type Look = "left" | "right" | "front" | number;
export type HeldItem = "none" | "tablet" | "bol" | "invoice" | "umbrella" | "phone" | "folder" | "vial" | "logger" | "pencil";

export type FaceParams = {
  browTilt: number;
  browLift: number;
  browAsym: number;
  eyeOpen: number;
  eyeSmile: number;
  mouthCurve: number;
  mouthOpen: number;
  mouthWidth: number;
  mouthSkew: number;
  teeth: number;
  blush: number;
  tilt: number;
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

export const lookToNumber = (look: Look | undefined) => (look === "left" ? -1 : look === "right" ? 1 : look === "front" || look === undefined ? 0 : look);

export const isTwoHanded = (item: HeldItem) => item === "tablet" || item === "folder";
