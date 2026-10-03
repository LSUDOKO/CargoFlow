import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { P } from "../assets/palette";
import { HeldProp, isTwoHanded } from "./HeldProp";
import {
  EXPRESSIONS,
  Expression,
  FaceParams,
  Gesture,
  HeldItem,
  Look,
  Pose,
  blendFace,
  blinkOpen,
  breath,
  clampLerp,
  gestureEnvelope,
  lookToNumber,
  talkOpen,
} from "./rig";

/**
 * One rig for the whole cast. Every character shares the same skeleton, head:body ratio
 * (1 : 5.6), eye / brow / mouth construction and strokeless flat rendering with a single
 * shade tone on the right (light from the top-left). Characters differ only in their
 * Appearance: palette, outfit cut and hair / accessory layers.
 *
 * Coordinate space: viewBox x 0..400, y -60..640. Feet rest on y = 620, head centre (200,118).
 */

export const CX = 200;
const HEAD_Y = 118;
const SHOULDER_Y = 222;
const HIP_Y = 384;
const ANKLE_Y = 604;

export type Outfit = "blazer" | "lab" | "longcoat" | "uniform" | "cardigan";

export type FaceLayerProps = { lx: number; f: FaceParams };

export type Appearance = {
  build: "f" | "m";
  skin: string;
  skinShade: string;
  hair: string;
  brow?: string;
  outfit: Outfit;
  top: string; // jacket / coat / uniform shirt
  topShade: string;
  inner: string; // shirt / kurta seen inside the jacket
  innerShade?: string;
  trousers: string;
  trousersShade: string;
  shoes: string;
  cuff?: string;
  /** Layers drawn behind the head (long hair, hijab drape). */
  Back?: React.FC<FaceLayerProps>;
  /** Layers over the face (hair cap, fringe, glasses, cap, earrings). */
  Front?: React.FC<FaceLayerProps>;
  /** Facial hair, drawn under the eyes / mouth so the mouth always reads. */
  Beard?: React.FC<FaceLayerProps>;
  /** Chest details (badge, ID lanyard, pocket square). */
  Chest?: React.FC;
  /** Mouth line colour, for contrast on darker skin. */
  mouth?: string;
};

export type CharacterProps = {
  pose?: Pose;
  expression?: Expression;
  /** Blend from this expression into `expression` starting at `expressionAt` (8 frames). */
  prevExpression?: Expression;
  expressionAt?: number;
  look?: Look;
  talking?: boolean;
  blink?: boolean;
  gesture?: Gesture;
  gestureAt?: number;
  gestureEnd?: number;
  /** Shorthands for gesture="wave" / gesture="point". */
  wave?: boolean;
  point?: boolean | "left" | "right";
  prop?: HeldItem;
  /** Second held item in the screen-right hand (e.g. "pencil", "phone"); ignored while that arm gestures. */
  propRight?: HeldItem;
  /** Rendered height in px when crop = "full" (default 640 × scale). */
  scale?: number;
  /** full body, waist-up mid-shot, or bust (head and shoulders). */
  crop?: "full" | "waist" | "bust";
  walking?: boolean;
  flip?: boolean;
  seed?: number;
  style?: React.CSSProperties;
};

type Arm = { a: number; e: number; l1?: number; l2?: number };
const REST: Arm = { a: 7, e: 5 };

const POSES: Record<Pose, { L: Arm; R: Arm }> = {
  stand: { L: REST, R: REST },
  hold: { L: { a: 12, e: -100, l2: 0.5 }, R: { a: 12, e: -100, l2: 0.5 } },
  crossed: { L: { a: 16, e: -104, l2: 1.45 }, R: { a: 14, e: -98, l2: 1.4 } },
  hips: { L: { a: 42, e: -78 }, R: { a: 42, e: -78 } },
  thinking: { L: { a: 14, e: -106, l2: 0.85 }, R: { a: 14, e: -168, l1: 0.62, l2: 1 } },
};
const ONE_HAND: Arm = { a: 12, e: -62, l2: 0.62 };
const UMBRELLA: Arm = { a: 40, e: 140 };

const GESTURES: Record<Exclude<Gesture, "none">, Arm> = {
  wave: { a: 148, e: 24 },
  point: { a: 84, e: 4 },
  present: { a: 22, e: 50 },
  thumbsUp: { a: 14, e: -138, l2: 0.75 },
};

const mixArm = (a: Arm, b: Arm, t: number): Arm => ({
  a: a.a + (b.a - a.a) * t,
  e: a.e + (b.e - a.e) * t,
  l1: (a.l1 ?? 1) + ((b.l1 ?? 1) - (a.l1 ?? 1)) * t,
  l2: (a.l2 ?? 1) + ((b.l2 ?? 1) - (a.l2 ?? 1)) * t,
});

const rad = (d: number) => (d * Math.PI) / 180;

const solveArm = (sx: number, sy: number, s: number, arm: Arm) => {
  const L1 = 90 * (arm.l1 ?? 1);
  const L2 = 92 * (arm.l2 ?? 1);
  const ex = sx + s * Math.sin(rad(arm.a)) * L1;
  const ey = sy + Math.cos(rad(arm.a)) * L1;
  const fa = arm.a + arm.e;
  const hx = ex + s * Math.sin(rad(fa)) * L2;
  const hy = ey + Math.cos(rad(fa)) * L2;
  // forearm direction as a screen angle (deg, 0 = right), for fingers / props
  const dir = (Math.atan2(hy - ey, hx - ex) * 180) / Math.PI;
  return { ex, ey, hx, hy, dir };
};

export const Person: React.FC<CharacterProps & { look_: Appearance }> = ({
  look_: ap,
  pose = "stand",
  expression = "neutral",
  prevExpression,
  expressionAt = 0,
  look,
  talking = false,
  blink = true,
  gesture: gestureProp,
  gestureAt = 0,
  gestureEnd,
  wave,
  point,
  prop = "none",
  propRight = "none",
  scale = 1,
  crop = "full",
  walking = false,
  flip = false,
  seed = 1,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const gesture: Gesture =
    gestureProp ?? (wave ? "wave" : point ? "point" : "none");
  const pointLeft = point === "left";
  let lx = lookToNumber(look);
  if (gesture === "point" && look === undefined) lx = pointLeft ? -1 : 1;
  const LX = lx * 7;

  // ---- face ----
  const target = EXPRESSIONS[expression];
  const face = prevExpression
    ? blendFace(
        EXPRESSIONS[prevExpression],
        target,
        clampLerp(frame, [expressionAt, expressionAt + 8], [0, 1]),
      )
    : target;
  const eye = blink ? blinkOpen(frame, fps, seed) : 1;
  const talk = talking ? talkOpen(frame, seed) : 0;

  // ---- idle ----
  const b = breath(frame, fps, seed);
  const lift = -b * 1.6; // upper body rise
  // slow weight shift (period ~10 s, ±1.5 px), so a held pose never looks frozen
  const shift = Math.sin(((frame + seed * 41) / (fps * 5)) * Math.PI) * 1.5;
  const walkPhase = walking ? Math.sin((frame / fps) * Math.PI * 2 * 1.1) : 0;
  const bob = walking ? -Math.abs(Math.cos((frame / fps) * Math.PI * 2 * 1.1)) * 5 : 0;

  // ---- arms ----
  const env = gesture === "none" ? 0 : gestureEnvelope(frame, fps, gestureAt, gestureEnd);
  const base = POSES[pose];
  // a two-handed item (tablet, folder) moves to one hand while the other arm gestures
  const twoHanded = isTwoHanded(prop) && gesture === "none" && propRight === "none";
  let L: Arm = base.L;
  let R: Arm = base.R;
  if (prop !== "none" && !twoHanded) L = prop === "umbrella" ? UMBRELLA : ONE_HAND;
  if (twoHanded && pose === "stand") {
    L = POSES.hold.L;
    R = POSES.hold.R;
  }
  const rightGesture = gesture !== "none" && !(gesture === "point" && pointLeft);
  if (propRight !== "none" && !rightGesture) R = ONE_HAND;
  if (walking && gesture === "none" && prop === "none" && pose === "stand") {
    L = { a: 7 + walkPhase * 12, e: 8 };
    R = { a: 7 - walkPhase * 12, e: 8 };
  }
  if (gesture !== "none") {
    let g = GESTURES[gesture];
    if (gesture === "wave") {
      const t = (frame - gestureAt) / fps;
      g = { ...g, e: g.e + Math.sin(t * Math.PI * 2 * 1.6) * 20 * Math.min(1, env) };
    }
    if (gesture === "point" && pointLeft) L = mixArm(L, g, env);
    else R = mixArm(R, g, env);
  }
  const sw = ap.build === "f" ? 58 : 66; // shoulder half-width
  const hw = ap.build === "f" ? 47 : 53; // waist half-width
  const pivot = sw - 12;
  const armL = solveArm(CX - pivot, SHOULDER_Y, -1, L);
  const armR = solveArm(CX + pivot, SHOULDER_Y, 1, R);
  const sleeveW = ap.build === "f" ? 32 : 36;

  const isLong = ap.outfit === "lab" || ap.outfit === "longcoat";
  const hem = isLong ? 474 : 392;
  const hemW = isLong ? hw + 12 : hw;

  // ---- viewbox ----
  const vb = crop === "bust" ? { x: 82, y: 40, w: 236, h: 300 } : crop === "waist" ? { x: 30, y: 36, w: 340, h: 380 } : { x: 0, y: -60, w: 400, h: 700 };
  const heightPx = vb.h * scale;
  const widthPx = (vb.w / vb.h) * heightPx;

  const tilt = face.tilt + lx * 1.5;

  const legs = (
    <g>
      {[-1, 1].map((s) => {
        const hx = CX + s * (ap.build === "f" ? 22 : 25);
        const lw = ap.build === "f" ? 40 : 44;
        const ang = walking ? s * walkPhase * 14 : 0;
        const shade = s === 1;
        return (
          <g key={s} transform={`rotate(${ang} ${hx} ${HIP_Y - 10})`}>
            <path
              d={`M${hx - lw / 2 - 3} ${HIP_Y - 20} L${hx + lw / 2 + 3} ${HIP_Y - 20} L${hx + lw / 2 - 3} ${ANKLE_Y + 4} Q${hx} ${ANKLE_Y + 8} ${hx - lw / 2 + 3} ${ANKLE_Y + 4} Z`}
              fill={shade ? ap.trousersShade : ap.trousers}
            />
            <rect
              x={hx - lw / 2 - 4 + s * 5}
              y={ANKLE_Y - 2}
              width={lw + 8}
              height={18}
              rx={8}
              fill={ap.shoes}
            />
          </g>
        );
      })}
    </g>
  );

  const torsoPath = `M${CX - sw + 16} 198 Q${CX - sw} 200 ${CX - sw - 1} 224 L${CX - hemW} ${hem} L${CX + hemW} ${hem} L${CX + sw + 1} 224 Q${CX + sw} 200 ${CX + sw - 16} 198 Z`;
  const shadePath = `M${CX + sw - 16} 198 Q${CX + sw} 200 ${CX + sw + 1} 224 L${CX + hemW} ${hem} L${CX + hemW - 15} ${hem} L${CX + sw - 13} 228 Z`;

  const outfit = (() => {
    switch (ap.outfit) {
      case "blazer":
        return (
          <g>
            <path d={`M${CX - 21} 196 L${CX + 21} 196 L${CX + 5} 304 L${CX - 5} 304 Z`} fill={ap.inner} />
            <path d={`M${CX - 13} 194 L${CX} 214 L${CX + 13} 194 Z`} fill={ap.innerShade ?? ap.inner} />
            <path d={`M${CX - 22} 197 L${CX - 38} 206 L${CX - 27} 234 L${CX - 4} 306 Z`} fill={ap.topShade} />
            <path d={`M${CX + 22} 197 L${CX + 38} 206 L${CX + 27} 234 L${CX + 4} 306 Z`} fill={ap.topShade} />
            <circle cx={CX} cy={326} r={4.5} fill={ap.topShade} />
          </g>
        );
      case "lab":
        return (
          <g>
            <path d={`M${CX - 24} 196 L${CX + 24} 196 L${CX + 20} ${hem} L${CX - 20} ${hem} Z`} fill={ap.inner} />
            {/* kurta neckline */}
            <path d={`M${CX - 12} 195 Q${CX} 222 ${CX + 12} 195 Z`} fill={ap.innerShade ?? ap.inner} />
            {/* coat collar */}
            <path d={`M${CX - 24} 196 L${CX - 40} 206 L${CX - 30} 238 L${CX - 22} 300 Z`} fill={ap.topShade} />
            <path d={`M${CX + 24} 196 L${CX + 40} 206 L${CX + 30} 238 L${CX + 22} 300 Z`} fill={ap.topShade} />
            {/* pockets */}
            <rect x={CX - hw - 2} y={392} width={34} height={6} rx={3} fill={ap.topShade} />
            <rect x={CX + hw - 30} y={392} width={34} height={6} rx={3} fill={ap.topShade} />
            <rect x={CX - sw + 10} y={262} width={26} height={5} rx={2.5} fill={ap.topShade} />
          </g>
        );
      case "longcoat":
        return (
          <g>
            <path d={`M${CX - 16} 196 L${CX + 16} 196 L${CX} 226 Z`} fill={ap.inner} />
            <path d={`M${CX - 18} 195 L${CX - 34} 204 L${CX - 6} 300 L${CX} 226 Z`} fill={ap.topShade} />
            <path d={`M${CX + 18} 195 L${CX + 34} 204 L${CX + 6} 300 L${CX} 226 Z`} fill={ap.topShade} />
            <rect x={CX - 1.5} y={300} width={3} height={hem - 300} rx={1.5} fill={ap.topShade} />
            {[318, 356].map((y) => (
              <circle key={y} cx={CX + 9} cy={y} r={4} fill={ap.topShade} />
            ))}
          </g>
        );
      case "uniform":
        return (
          <g>
            <path d={`M${CX - 13} 194 L${CX} 210 L${CX + 13} 194 Z`} fill={ap.topShade} />
            <path d={`M${CX - 13} 194 L${CX - 22} 200 L${CX - 6} 220 Z`} fill={ap.topShade} />
            <path d={`M${CX + 13} 194 L${CX + 22} 200 L${CX + 6} 220 Z`} fill={ap.topShade} />
            <rect x={CX - 1.25} y={212} width={2.5} height={hem - 216} rx={1.25} fill={ap.topShade} />
            {[236, 268, 300, 332].map((y) => (
              <circle key={y} cx={CX} cy={y} r={2.6} fill={ap.topShade} />
            ))}
            <rect x={CX - 40} y={244} width={24} height={22} rx={4} fill={ap.topShade} />
            <rect x={CX + 16} y={244} width={24} height={22} rx={4} fill={ap.topShade} />
            {/* epaulettes */}
            {[-1, 1].map((s) => (
              <g key={s}>
                <rect x={CX + s * (sw - 22) - 15} y={200} width={30} height={11} rx={4} fill={P.ink} transform={`rotate(${s * 8} ${CX + s * (sw - 22)} 205)`} />
                <rect x={CX + s * (sw - 22) - 11} y={203.5} width={22} height={2.4} rx={1.2} fill={P.signal} transform={`rotate(${s * 8} ${CX + s * (sw - 22)} 205)`} />
              </g>
            ))}
            {/* belt */}
            <rect x={CX - hw} y={hem - 10} width={hw * 2} height={10} rx={2} fill={P.ink} />
          </g>
        );
      case "cardigan":
        return (
          <g>
            <path d={`M${CX - 22} 196 L${CX + 22} 196 L${CX + 14} ${hem} L${CX - 14} ${hem} Z`} fill={ap.inner} />
            <path d={`M${CX - 22} 196 L${CX - 16} ${hem} L${CX - 24} ${hem} L${CX - 30} 200 Z`} fill={ap.topShade} />
            <path d={`M${CX + 22} 196 L${CX + 16} ${hem} L${CX + 24} ${hem} L${CX + 30} 200 Z`} fill={ap.topShade} />
          </g>
        );
    }
  })();

  const drawSleeve = (sx: number, arm: ReturnType<typeof solveArm>, color: string) => (
    <path
      d={`M${sx} ${SHOULDER_Y} L${arm.ex} ${arm.ey} L${arm.hx} ${arm.hy}`}
      stroke={color}
      strokeWidth={sleeveW}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );

  const cuff = (arm: ReturnType<typeof solveArm>) => {
    if (!ap.cuff) return null;
    const ux = Math.cos(rad(arm.dir));
    const uy = Math.sin(rad(arm.dir));
    const cx0 = arm.hx - ux * 11;
    const cy0 = arm.hy - uy * 11;
    return (
      <path
        d={`M${cx0 - ux * 3} ${cy0 - uy * 3} L${cx0 + ux * 3} ${cy0 + uy * 3}`}
        stroke={ap.cuff}
        strokeWidth={sleeveW - 1}
        strokeLinecap="butt"
      />
    );
  };

  const hand = (arm: ReturnType<typeof solveArm>, kind: "open" | "point" | "thumb") => {
    const ux = Math.cos(rad(arm.dir));
    const uy = Math.sin(rad(arm.dir));
    const hx = arm.hx + ux * 6;
    const hy = arm.hy + uy * 6;
    return (
      <g>
        {kind === "point" ? (
          <path
            d={`M${hx} ${hy} L${hx + ux * 20} ${hy + uy * 20}`}
            stroke={ap.skin}
            strokeWidth={8}
            strokeLinecap="round"
          />
        ) : null}
        {kind === "thumb" ? (
          <path d={`M${hx - 2} ${hy - 4} L${hx - 2} ${hy - 22}`} stroke={ap.skin} strokeWidth={8} strokeLinecap="round" />
        ) : null}
        <circle cx={hx} cy={hy} r={14} fill={ap.skin} />
        <path
          d={`M${hx + 4} ${hy - 10} A14 14 0 0 1 ${hx + 4} ${hy + 10}`}
          fill="none"
          stroke={ap.skinShade}
          strokeWidth={3}
          opacity={0.5}
          strokeLinecap="round"
        />
      </g>
    );
  };

  const kindR = gesture === "point" && !pointLeft && env > 0.5 ? "point" : gesture === "thumbsUp" && env > 0.5 ? "thumb" : "open";
  const kindL = gesture === "point" && pointLeft && env > 0.5 ? "point" : "open";

  // ---- face pieces ----
  const ex = (s: number) => CX + s * 18 + LX;
  const eyeY = HEAD_Y + 2;
  const browY = HEAD_Y - 15;
  const browColor = ap.brow ?? ap.hair;
  const mouthColor = ap.mouth ?? "#3A1C1C";

  const mouth = (() => {
    const mx = CX + LX * 0.95;
    const my = HEAD_Y + 32;
    const w = face.mouthWidth * (1 - talk * 0.25);
    const open = Math.max(face.mouthOpen, talk);
    const lY = my - face.mouthCurve * 4;
    const rY = my - face.mouthCurve * 4 - face.mouthSkew;
    const mid = my + face.mouthCurve * 5;
    if (open < 0.07) {
      return (
        <path
          d={`M${mx - w} ${lY} Q${mx} ${mid + face.mouthCurve * 3} ${mx + w} ${rY}`}
          stroke={mouthColor}
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
        />
      );
    }
    const top = `M${mx - w} ${lY} Q${mx} ${mid - 1} ${mx + w} ${rY}`;
    const bottom = `Q${mx} ${mid + 4 + open * 16} ${mx - w} ${lY} Z`;
    return (
      <g>
        <path d={`${top} ${bottom}`} fill={mouthColor} />
        {face.teeth > 0.05 ? (
          <path
            d={`${top} Q${mx} ${mid + 1 + open * 6 * face.teeth} ${mx - w} ${lY} Z`}
            fill={P.white}
            opacity={Math.min(1, face.teeth * 1.4)}
          />
        ) : null}
      </g>
    );
  })();

  const eyes = [-1, 1].map((s) => {
    const x = ex(s);
    const smile = face.eyeSmile;
    if (smile > 0.6) {
      return (
        <path
          key={s}
          d={`M${x - 5.5} ${eyeY + 1.5} Q${x} ${eyeY - 5} ${x + 5.5} ${eyeY + 1.5}`}
          stroke={P.ink}
          strokeWidth={3}
          strokeLinecap="round"
          fill="none"
        />
      );
    }
    const ry = 5.4 * face.eyeOpen * eye * (1 - smile * 0.45);
    return (
      <g key={s}>
        <ellipse cx={x + lx * 0.8} cy={eyeY} rx={4.4 * Math.min(1.15, face.eyeOpen)} ry={Math.max(0.6, ry)} fill={P.ink} />
        {ry > 3 ? <circle cx={x + lx * 0.8 - 1.4} cy={eyeY - 1.8} r={1.25} fill={P.white} /> : null}
      </g>
    );
  });

  const brows = [-1, 1].map((s) => {
    const x = ex(s);
    const inner = x - s * 7;
    const outer = x + s * 9;
    const asym = s === 1 ? face.browAsym : 0;
    const iy = browY - face.browLift - face.browTilt - asym;
    const oy = browY - face.browLift + face.browTilt * 0.35 - asym;
    return (
      <path
        key={s}
        d={`M${inner} ${iy} Q${(inner + outer) / 2} ${Math.min(iy, oy) - 2.5} ${outer} ${oy}`}
        stroke={browColor}
        strokeWidth={3.8}
        strokeLinecap="round"
        fill="none"
      />
    );
  });

  const headPath = `M156 ${HEAD_Y - 6} C156 ${HEAD_Y - 44} 176 ${HEAD_Y - 56} 200 ${HEAD_Y - 56} C224 ${HEAD_Y - 56} 244 ${HEAD_Y - 44} 244 ${HEAD_Y - 6} C244 ${HEAD_Y + 30} 226 ${HEAD_Y + 54} 200 ${HEAD_Y + 54} C174 ${HEAD_Y + 54} 156 ${HEAD_Y + 30} 156 ${HEAD_Y - 6} Z`;
  const cheekShade = `M${222 + LX * 0.3} ${HEAD_Y - 52} C240 ${HEAD_Y - 44} 244 ${HEAD_Y - 26} 244 ${HEAD_Y - 6} C244 ${HEAD_Y + 30} 226 ${HEAD_Y + 54} 200 ${HEAD_Y + 54} C216 ${HEAD_Y + 46} 233 ${HEAD_Y + 28} 235 ${HEAD_Y - 6} C236 ${HEAD_Y - 26} 232 ${HEAD_Y - 42} ${222 + LX * 0.3} ${HEAD_Y - 52} Z`;

  const twoHandMid = {
    x: (armL.hx + armR.hx) / 2,
    y: (armL.hy + armR.hy) / 2,
  };

  return (
    <svg
      width={widthPx}
      height={heightPx}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      style={{ display: "block", overflow: "visible", ...style }}
    >
      <g transform={flip ? `translate(400 0) scale(-1 1)` : undefined}>
        {/* contact shadow */}
        {crop === "full" ? (
          <ellipse cx={CX} cy={624} rx={78} ry={9} fill={P.ink} opacity={0.08} />
        ) : null}
        <g transform={`translate(0 ${bob})`}>
          {legs}
          <g transform={`translate(${shift} ${lift})`}>
            {/* back hair / drape */}
            <g transform={`rotate(${tilt} ${CX} ${HEAD_Y + 50})`}>{ap.Back ? <ap.Back lx={LX} f={face} /> : null}</g>
            {/* neck */}
            <rect x={CX - 15} y={HEAD_Y + 30} width={30} height={60} rx={10} fill={ap.skin} />
            <rect x={CX - 15} y={HEAD_Y + 40} width={30} height={22} rx={6} fill={ap.skinShade} />
            {/* torso */}
            <g transform={`translate(0 ${-b * 0.4}) scale(1 ${1 + b * 0.006})`} style={{ transformOrigin: `${CX}px ${hem}px` }}>
              <path d={torsoPath} fill={ap.top} />
              {outfit}
              <path d={shadePath} fill={ap.topShade} opacity={0.75} />
              {ap.Chest ? <ap.Chest /> : null}
            </g>
            {/* head */}
            <g transform={`translate(0 ${-b * 0.6}) rotate(${tilt} ${CX} ${HEAD_Y + 50})`}>
              <ellipse cx={156 - LX * 0.35} cy={HEAD_Y + 4} rx={8} ry={12} fill={ap.skin} />
              <ellipse cx={244 - LX * 0.35} cy={HEAD_Y + 4} rx={8} ry={12} fill={ap.skinShade} />
              <path d={headPath} fill={ap.skin} />
              <path d={cheekShade} fill={ap.skinShade} opacity={0.55} />
              {face.blush > 0.02
                ? [-1, 1].map((s) => (
                    <ellipse key={s} cx={CX + s * 25 + LX} cy={HEAD_Y + 20} rx={7} ry={4} fill="#E2675A" opacity={face.blush * 0.22} />
                  ))
                : null}
              {ap.Beard ? <ap.Beard lx={LX} f={face} /> : null}
              {brows}
              {eyes}
              <path
                d={`M${CX + LX * 1.1 + 1} ${HEAD_Y + 8} Q${CX + LX * 1.1 - 4} ${HEAD_Y + 19} ${CX + LX * 1.1 + 2} ${HEAD_Y + 21}`}
                stroke={ap.skinShade}
                strokeWidth={3}
                strokeLinecap="round"
                fill="none"
              />
              {mouth}
              {ap.Front ? <ap.Front lx={LX} f={face} /> : null}
            </g>
            {/* arms */}
            {prop === "umbrella" ? <HeldProp item="umbrella" x={armL.hx} y={armL.hy} dir={armL.dir} /> : null}
            {drawSleeve(CX - pivot, armL, ap.top)}
            {drawSleeve(CX + pivot, armR, ap.topShade)}
            {pose === "crossed" && gesture === "none" ? (
              // the top forearm laps over the lower one; hands tuck under the opposite arm
              <path d={`M${armL.ex} ${armL.ey} L${armL.hx} ${armL.hy}`} stroke={ap.top} strokeWidth={sleeveW} strokeLinecap="round" />
            ) : null}
            {pose === "crossed" && gesture === "none" ? null : cuff(armL)}
            {pose === "crossed" && gesture === "none" ? null : cuff(armR)}
            {prop !== "none" && prop !== "umbrella" ? (
              twoHanded ? (
                <HeldProp item={prop} x={twoHandMid.x} y={twoHandMid.y} dir={0} />
              ) : (
                <HeldProp item={prop} x={armL.hx} y={armL.hy} dir={armL.dir} oneHand />
              )
            ) : null}
            {propRight !== "none" && !rightGesture ? <HeldProp item={propRight} x={armR.hx} y={armR.hy} dir={armR.dir} oneHand right /> : null}
            {hand(armL, kindL)}
            {pose === "crossed" && gesture === "none" ? null : hand(armR, kindR)}
          </g>
        </g>
      </g>
    </svg>
  );
};
