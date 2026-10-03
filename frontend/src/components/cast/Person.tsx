import type { CSSProperties, ReactNode } from "react";
import s from "./cast.module.css";
import { HeldProp } from "./HeldProp";
import { P } from "./palette";
import { EXPRESSIONS, type Expression, type FaceParams, type Gesture, type HeldItem, isTwoHanded, type Look, lookToNumber, type Pose } from "./rig";

/**
 * One rig for the whole cast, ported from the film (video/src/characters/Person.tsx) as a plain SVG with no
 * Remotion and no hooks, so it renders on the server. Same skeleton, head:body ratio (1 : 5.6), face construction
 * and flat, strokeless rendering with one shade tone on the right. Idle breathing and blinking are CSS
 * (cast.module.css), paused under prefers-reduced-motion.
 *
 * Coordinate space: x 0..400, y -60..640. Feet rest on y = 620, head centre (200, 118).
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
  top: string;
  topShade: string;
  inner: string;
  innerShade?: string;
  trousers: string;
  trousersShade: string;
  shoes: string;
  cuff?: string;
  Back?: (p: FaceLayerProps) => ReactNode;
  Front?: (p: FaceLayerProps) => ReactNode;
  Beard?: (p: FaceLayerProps) => ReactNode;
  Chest?: () => ReactNode;
  mouth?: string;
};

export type CharacterProps = {
  pose?: Pose;
  expression?: Expression;
  look?: Look;
  gesture?: Gesture;
  /** Which hand points when gesture is "point". */
  pointSide?: "left" | "right";
  prop?: HeldItem;
  /** Second held item in the screen-right hand; ignored while that arm gestures. */
  propRight?: HeldItem;
  /** Rendered height in px (or in the parent's user units when nested inside another SVG). */
  size?: number;
  /** full body, waist-up, bust (head and shoulders), or a square portrait that fits a wave. */
  crop?: "full" | "waist" | "bust" | "portrait";
  flip?: boolean;
  /** Idle breathing, weight shift and blinking (CSS). */
  idle?: boolean;
  /** Accessible name. Without it the figure is decorative (aria-hidden). */
  label?: string;
  /** Position when nested inside another SVG. */
  x?: number;
  y?: number;
  className?: string;
  style?: CSSProperties;
  /** Per-character offset so a group of people never breathes or blinks in unison. */
  seed?: number;
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

const rad = (d: number) => (d * Math.PI) / 180;
const r1 = (v: number) => Math.round(v * 10) / 10;

const solveArm = (sx: number, sy: number, side: number, arm: Arm) => {
  const L1 = 90 * (arm.l1 ?? 1);
  const L2 = 92 * (arm.l2 ?? 1);
  const ex = sx + side * Math.sin(rad(arm.a)) * L1;
  const ey = sy + Math.cos(rad(arm.a)) * L1;
  const fa = arm.a + arm.e;
  const hx = ex + side * Math.sin(rad(fa)) * L2;
  const hy = ey + Math.cos(rad(fa)) * L2;
  const dir = (Math.atan2(hy - ey, hx - ex) * 180) / Math.PI;
  return { ex: r1(ex), ey: r1(ey), hx: r1(hx), hy: r1(hy), dir };
};
type Solved = ReturnType<typeof solveArm>;

const VIEW = {
  bust: { x: 82, y: 40, w: 236, h: 300 },
  /** square head-and-shoulders with room for a raised (waving) right hand */
  portrait: { x: 66, y: 26, w: 290, h: 290 },
  waist: { x: 30, y: 36, w: 340, h: 380 },
  full: { x: 0, y: -60, w: 400, h: 700 },
} as const;

export function Person({
  look_: ap,
  pose = "stand",
  expression = "neutral",
  look,
  gesture = "none",
  pointSide = "right",
  prop = "none",
  propRight = "none",
  size,
  crop = "full",
  flip = false,
  idle = true,
  label,
  x,
  y,
  className,
  style,
  seed = 1,
}: CharacterProps & { look_: Appearance }) {
  const pointLeft = gesture === "point" && pointSide === "left";
  let lx = lookToNumber(look);
  if (gesture === "point" && look === undefined) lx = pointLeft ? -1 : 1;
  const LX = lx * 7;
  const face = EXPRESSIONS[expression];

  const base = POSES[pose];
  const twoHanded = isTwoHanded(prop) && gesture === "none" && propRight === "none";
  let L: Arm = base.L;
  let R: Arm = base.R;
  if (prop !== "none" && !twoHanded) L = prop === "umbrella" ? UMBRELLA : ONE_HAND;
  if (twoHanded && pose === "stand") {
    L = POSES.hold.L;
    R = POSES.hold.R;
  }
  const rightGesture = gesture !== "none" && !pointLeft;
  if (propRight !== "none" && !rightGesture) R = ONE_HAND;
  if (gesture !== "none") {
    if (pointLeft) L = GESTURES.point;
    else R = GESTURES[gesture];
  }
  const sw = ap.build === "f" ? 58 : 66;
  const hw = ap.build === "f" ? 47 : 53;
  const pivot = sw - 12;
  const armL = solveArm(CX - pivot, SHOULDER_Y, -1, L);
  const armR = solveArm(CX + pivot, SHOULDER_Y, 1, R);
  const sleeveW = ap.build === "f" ? 32 : 36;
  const isLong = ap.outfit === "lab" || ap.outfit === "longcoat";
  const hem = isLong ? 474 : 392;
  const hemW = isLong ? hw + 12 : hw;
  const vb = VIEW[crop];
  const heightPx = size;
  const widthPx = size === undefined ? undefined : r1((vb.w / vb.h) * size);
  const tilt = face.tilt + lx * 1.5;
  const crossed = pose === "crossed" && gesture === "none";
  const waving = gesture === "wave";
  // stagger idle loops by seed so a row of people never moves in unison
  const delay = (k: number) => ({ animationDelay: `${-((seed * k) % 9)}s` });

  const legs = (
    <g>
      {[-1, 1].map((side) => {
        const hx = CX + side * (ap.build === "f" ? 22 : 25);
        const lw = ap.build === "f" ? 40 : 44;
        return (
          <g key={side}>
            <path
              d={`M${hx - lw / 2 - 3} ${HIP_Y - 20} L${hx + lw / 2 + 3} ${HIP_Y - 20} L${hx + lw / 2 - 3} ${ANKLE_Y + 4} Q${hx} ${ANKLE_Y + 8} ${hx - lw / 2 + 3} ${ANKLE_Y + 4} Z`}
              fill={side === 1 ? ap.trousersShade : ap.trousers}
            />
            <rect x={hx - lw / 2 - 4 + side * 5} y={ANKLE_Y - 2} width={lw + 8} height={18} rx={8} fill={ap.shoes} />
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
            <path d={`M${CX - 12} 195 Q${CX} 222 ${CX + 12} 195 Z`} fill={ap.innerShade ?? ap.inner} />
            <path d={`M${CX - 24} 196 L${CX - 40} 206 L${CX - 30} 238 L${CX - 22} 300 Z`} fill={ap.topShade} />
            <path d={`M${CX + 24} 196 L${CX + 40} 206 L${CX + 30} 238 L${CX + 22} 300 Z`} fill={ap.topShade} />
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
            {[318, 356].map((yy) => (
              <circle key={yy} cx={CX + 9} cy={yy} r={4} fill={ap.topShade} />
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
            {[236, 268, 300, 332].map((yy) => (
              <circle key={yy} cx={CX} cy={yy} r={2.6} fill={ap.topShade} />
            ))}
            <rect x={CX - 40} y={244} width={24} height={22} rx={4} fill={ap.topShade} />
            <rect x={CX + 16} y={244} width={24} height={22} rx={4} fill={ap.topShade} />
            {[-1, 1].map((side) => (
              <g key={side} transform={`rotate(${side * 8} ${CX + side * (sw - 22)} 205)`}>
                <rect x={CX + side * (sw - 22) - 15} y={200} width={30} height={11} rx={4} fill={P.ink} />
                <rect x={CX + side * (sw - 22) - 11} y={203.5} width={22} height={2.4} rx={1.2} fill={P.signal} />
              </g>
            ))}
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

  const sleeve = (sx: number, arm: Solved, color: string) => (
    <path d={`M${sx} ${SHOULDER_Y} L${arm.ex} ${arm.ey} L${arm.hx} ${arm.hy}`} stroke={color} strokeWidth={sleeveW} strokeLinecap="round" strokeLinejoin="round" fill="none" />
  );
  const cuff = (arm: Solved) => {
    if (!ap.cuff) return null;
    const ux = Math.cos(rad(arm.dir));
    const uy = Math.sin(rad(arm.dir));
    const cx0 = arm.hx - ux * 11;
    const cy0 = arm.hy - uy * 11;
    return <path d={`M${r1(cx0 - ux * 3)} ${r1(cy0 - uy * 3)} L${r1(cx0 + ux * 3)} ${r1(cy0 + uy * 3)}`} stroke={ap.cuff} strokeWidth={sleeveW - 1} strokeLinecap="butt" />;
  };
  const hand = (arm: Solved, kind: "open" | "point" | "thumb") => {
    const ux = Math.cos(rad(arm.dir));
    const uy = Math.sin(rad(arm.dir));
    const hx = r1(arm.hx + ux * 6);
    const hy = r1(arm.hy + uy * 6);
    return (
      <g>
        {kind === "point" ? <path d={`M${hx} ${hy} L${r1(hx + ux * 20)} ${r1(hy + uy * 20)}`} stroke={ap.skin} strokeWidth={8} strokeLinecap="round" /> : null}
        {kind === "thumb" ? <path d={`M${hx - 2} ${hy - 4} L${hx - 2} ${hy - 22}`} stroke={ap.skin} strokeWidth={8} strokeLinecap="round" /> : null}
        <circle cx={hx} cy={hy} r={14} fill={ap.skin} />
        <path d={`M${hx + 4} ${hy - 10} A14 14 0 0 1 ${hx + 4} ${hy + 10}`} fill="none" stroke={ap.skinShade} strokeWidth={3} opacity={0.5} strokeLinecap="round" />
      </g>
    );
  };
  const kindR = gesture === "point" && !pointLeft ? "point" : gesture === "thumbsUp" ? "thumb" : "open";
  const kindL = pointLeft ? "point" : "open";

  // ---- face ----
  const ex = (side: number) => CX + side * 18 + LX;
  const eyeY = HEAD_Y + 2;
  const browY = HEAD_Y - 15;
  const browColor = ap.brow ?? ap.hair;
  const mouthColor = ap.mouth ?? "#3A1C1C";
  const mouth = (() => {
    const mx = CX + LX * 0.95;
    const my = HEAD_Y + 32;
    const w = face.mouthWidth;
    const open = face.mouthOpen;
    const lY = my - face.mouthCurve * 4;
    const rY = my - face.mouthCurve * 4 - face.mouthSkew;
    const mid = my + face.mouthCurve * 5;
    if (open < 0.07) {
      return <path d={`M${mx - w} ${lY} Q${mx} ${mid + face.mouthCurve * 3} ${mx + w} ${rY}`} stroke={mouthColor} strokeWidth={3} strokeLinecap="round" fill="none" />;
    }
    const top = `M${mx - w} ${lY} Q${mx} ${mid - 1} ${mx + w} ${rY}`;
    const bottom = `Q${mx} ${mid + 4 + open * 16} ${mx - w} ${lY} Z`;
    return (
      <g>
        <path d={`${top} ${bottom}`} fill={mouthColor} />
        {face.teeth > 0.05 ? <path d={`${top} Q${mx} ${mid + 1 + open * 6 * face.teeth} ${mx - w} ${lY} Z`} fill={P.white} opacity={Math.min(1, face.teeth * 1.4)} /> : null}
      </g>
    );
  })();
  const eyes = [-1, 1].map((side) => {
    const ix = ex(side);
    const smile = face.eyeSmile;
    if (smile > 0.6) {
      return <path key={side} d={`M${ix - 5.5} ${eyeY + 1.5} Q${ix} ${eyeY - 5} ${ix + 5.5} ${eyeY + 1.5}`} stroke={P.ink} strokeWidth={3} strokeLinecap="round" fill="none" />;
    }
    const ry = 5.4 * face.eyeOpen * (1 - smile * 0.45);
    return (
      <g key={side} className={idle ? s.eye : undefined} style={idle ? delay(1.3) : undefined}>
        <ellipse cx={ix + lx * 0.8} cy={eyeY} rx={r1(4.4 * Math.min(1.15, face.eyeOpen))} ry={r1(Math.max(0.6, ry))} fill={P.ink} />
        {ry > 3 ? <circle cx={ix + lx * 0.8 - 1.4} cy={eyeY - 1.8} r={1.25} fill={P.white} /> : null}
      </g>
    );
  });
  const brows = [-1, 1].map((side) => {
    const bx = ex(side);
    const inner = bx - side * 7;
    const outer = bx + side * 9;
    const asym = side === 1 ? face.browAsym : 0;
    const iy = browY - face.browLift - face.browTilt - asym;
    const oy = browY - face.browLift + face.browTilt * 0.35 - asym;
    return <path key={side} d={`M${inner} ${iy} Q${(inner + outer) / 2} ${Math.min(iy, oy) - 2.5} ${outer} ${oy}`} stroke={browColor} strokeWidth={3.8} strokeLinecap="round" fill="none" />;
  });
  const headPath = `M156 ${HEAD_Y - 6} C156 ${HEAD_Y - 44} 176 ${HEAD_Y - 56} 200 ${HEAD_Y - 56} C224 ${HEAD_Y - 56} 244 ${HEAD_Y - 44} 244 ${HEAD_Y - 6} C244 ${HEAD_Y + 30} 226 ${HEAD_Y + 54} 200 ${HEAD_Y + 54} C174 ${HEAD_Y + 54} 156 ${HEAD_Y + 30} 156 ${HEAD_Y - 6} Z`;
  const cheekShade = `M${222 + LX * 0.3} ${HEAD_Y - 52} C240 ${HEAD_Y - 44} 244 ${HEAD_Y - 26} 244 ${HEAD_Y - 6} C244 ${HEAD_Y + 30} 226 ${HEAD_Y + 54} 200 ${HEAD_Y + 54} C216 ${HEAD_Y + 46} 233 ${HEAD_Y + 28} 235 ${HEAD_Y - 6} C236 ${HEAD_Y - 26} 232 ${HEAD_Y - 42} ${222 + LX * 0.3} ${HEAD_Y - 52} Z`;
  const twoHandMid = { x: (armL.hx + armR.hx) / 2, y: (armL.hy + armR.hy) / 2 };
  const a11y = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const, focusable: "false" as const };

  // a waving right arm: the forearm, cuff and hand swing about the elbow
  const rightArm = waving ? (
    <g>
      <path d={`M${CX + pivot} ${SHOULDER_Y} L${armR.ex} ${armR.ey}`} stroke={ap.topShade} strokeWidth={sleeveW} strokeLinecap="round" fill="none" />
      <g className={idle ? s.wave : undefined} style={{ transformOrigin: `${armR.ex}px ${armR.ey}px` }}>
        <path d={`M${armR.ex} ${armR.ey} L${armR.hx} ${armR.hy}`} stroke={ap.topShade} strokeWidth={sleeveW} strokeLinecap="round" fill="none" />
        {cuff(armR)}
        {hand(armR, "open")}
      </g>
    </g>
  ) : null;

  return (
    <svg
      x={x}
      y={y}
      width={widthPx}
      height={heightPx}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      overflow={crop === "full" ? "visible" : "hidden"}
      className={className}
      style={style}
      data-cast=""
      {...a11y}
    >
      <g transform={flip ? "translate(400 0) scale(-1 1)" : undefined}>
        {crop === "full" ? <ellipse cx={CX} cy={624} rx={78} ry={9} fill={P.ink} opacity={0.08} /> : null}
        {legs}
        <g className={idle ? s.sway : undefined} style={idle ? delay(2.1) : undefined}>
          <g className={idle ? s.breathe : undefined} style={idle ? delay(0.7) : undefined}>
            <g transform={`rotate(${tilt} ${CX} ${HEAD_Y + 50})`}>{ap.Back ? ap.Back({ lx: LX, f: face }) : null}</g>
            <rect x={CX - 15} y={HEAD_Y + 30} width={30} height={60} rx={10} fill={ap.skin} />
            <rect x={CX - 15} y={HEAD_Y + 40} width={30} height={22} rx={6} fill={ap.skinShade} />
            <path d={torsoPath} fill={ap.top} />
            {outfit}
            <path d={shadePath} fill={ap.topShade} opacity={0.75} />
            {ap.Chest ? ap.Chest() : null}
            <g className={idle ? s.head : undefined} style={idle ? delay(0.7) : undefined}>
              <g transform={`rotate(${tilt} ${CX} ${HEAD_Y + 50})`}>
                <ellipse cx={156 - LX * 0.35} cy={HEAD_Y + 4} rx={8} ry={12} fill={ap.skin} />
                <ellipse cx={244 - LX * 0.35} cy={HEAD_Y + 4} rx={8} ry={12} fill={ap.skinShade} />
                <path d={headPath} fill={ap.skin} />
                <path d={cheekShade} fill={ap.skinShade} opacity={0.55} />
                {face.blush > 0.02 ? [-1, 1].map((side) => <ellipse key={side} cx={CX + side * 25 + LX} cy={HEAD_Y + 20} rx={7} ry={4} fill="#E2675A" opacity={face.blush * 0.22} />) : null}
                {ap.Beard ? ap.Beard({ lx: LX, f: face }) : null}
                {brows}
                {eyes}
                <path d={`M${CX + LX * 1.1 + 1} ${HEAD_Y + 8} Q${CX + LX * 1.1 - 4} ${HEAD_Y + 19} ${CX + LX * 1.1 + 2} ${HEAD_Y + 21}`} stroke={ap.skinShade} strokeWidth={3} strokeLinecap="round" fill="none" />
                {mouth}
                {ap.Front ? ap.Front({ lx: LX, f: face }) : null}
              </g>
            </g>
            {prop === "umbrella" ? <HeldProp item="umbrella" x={armL.hx} y={armL.hy} /> : null}
            {sleeve(CX - pivot, armL, ap.top)}
            {waving ? null : sleeve(CX + pivot, armR, ap.topShade)}
            {crossed ? <path d={`M${armL.ex} ${armL.ey} L${armL.hx} ${armL.hy}`} stroke={ap.top} strokeWidth={sleeveW} strokeLinecap="round" /> : null}
            {crossed ? null : cuff(armL)}
            {crossed || waving ? null : cuff(armR)}
            {prop !== "none" && prop !== "umbrella" ? (
              twoHanded ? <HeldProp item={prop} x={twoHandMid.x} y={twoHandMid.y} /> : <HeldProp item={prop} x={armL.hx} y={armL.hy} oneHand />
            ) : null}
            {propRight !== "none" && !rightGesture ? <HeldProp item={propRight} x={armR.hx} y={armR.hy} oneHand right /> : null}
            {hand(armL, kindL)}
            {crossed || waving ? null : hand(armR, kindR)}
            {rightArm}
          </g>
        </g>
      </g>
    </svg>
  );
}
