"use client";

import { Character } from "@/components/cast/Cast";
import { FONT, P } from "@/components/cast/palette";
import { Avatar, Chip, Logger, Notification, ReeferCutaway, RouteMap, SealedReading, Shield, Usdg, Vault } from "./art";

/*
 * The six scenes of the scroll story, each a 640 × 440 SVG drawn in its final state (so it reads with no JavaScript
 * and under reduced motion). `a()` marks what StoryMotion animates in: draw, pop, drop, rise, fade, slide, leave
 * (ends hidden) and count (a number ticking from `from`).
 */
export const SCENE = { w: 640, h: 440 } as const;

type AnimKind = "draw" | "pop" | "drop" | "rise" | "fade" | "slide" | "leave" | "count";
const a = (kind: AnimKind, at: number, d = 0.3, extra: { x?: number; y?: number; from?: number; dec?: number } = {}) => ({
  "data-a": kind,
  "data-at": at,
  "data-d": d,
  "data-x": extra.x,
  "data-y": extra.y,
  "data-from": extra.from,
  "data-dec": extra.dec,
});

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <svg viewBox={`0 0 ${SCENE.w} ${SCENE.h}`} role="img" aria-label={label} className="block h-full w-full" preserveAspectRatio="xMidYMid meet">
      {children}
    </svg>
  );
}

const Arrow = ({ d, anim, color = P.ink }: { d: string; anim?: ReturnType<typeof a>; color?: string }) => (
  <path d={d} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeDasharray="2 8" opacity={0.55} {...anim} />
);

/* 1 · Meera registers the shipment: the lane draws Nhava Sheva → Singapore and the five milestones land on it. */
export function SceneRegister() {
  return (
    <Frame label="Meera, holding a tablet, beside a map of the route from Nhava Sheva around Sri Lanka to Singapore, with five milestones marked along it">
      <RouteMap x={176} y={34} scale={0.82} clipId="story-map-1" routeAnim={a("draw", 0.05, 0.62)} pipAnim={(i) => a("pop", 0.1 + i * 0.13, 0.12)} />
      <Chip x={190} y={368} text="40 ft reefer · vaccines" anim={a("rise", 0.72, 0.16)} />
      <Chip x={190} y={406} text="2–8 °C · 5 milestones" tone="paper" anim={a("rise", 0.8, 0.16)} />
      <Character who="meera" prop="tablet" expression="confident" look="right" size={380} x={-34} y={60} />
    </Frame>
  );
}

/* 2 · Daniel funds the facility: five USDG bars drop into the vault's drawers. */
export function SceneFund() {
  return (
    <Frame label="Daniel, holding his phone, beside an escrow vault whose five drawers each fill with an 8,000 USDG bar">
      <Arrow d="M150 240 C220 200 260 190 322 196" anim={a("draw", 0, 0.22)} />
      <Vault x={330} y={14} scale={0.8} drawers={["filled", "filled", "filled", "filled", "filled"]} barAnim={(i) => a("drop", 0.14 + i * 0.12, 0.16)} />
      <g transform="translate(474 400)">
        <rect x={-122} y={-22} width={244} height={44} rx={22} fill={P.ink} />
        <text x={-14} y={7} textAnchor="end" fontFamily={FONT.body} fontSize={19} fontWeight={700} fill={P.signal} {...a("count", 0.14, 0.7, { from: 0 })}>40,000</text>
        <text x={-6} y={7} fontFamily={FONT.body} fontSize={15} fontWeight={600} fill={P.white}>USDG in escrow</text>
      </g>
      <Character who="daniel" prop="phone" expression="confident" look="right" size={380} x={-30} y={60} />
    </Frame>
  );
}

/* 3 · Readings tick on the logger, the evidence passes, drawer M1 opens and 8,000 USDG slides to Meera. */
export function SceneRelease() {
  return (
    <Frame label="A data logger reading 4.8 °C, signed; the evidence passes and the vault's first drawer releases an 8,000 USDG bar to Meera">
      <Logger x={20} y={58} scale={0.7} value="4.8" valueAnim={a("count", 0, 0.42, { from: 4.6, dec: 1 })} sigAnim={a("pop", 0.3, 0.12)} />
      <Arrow d="M196 172 L338 172" anim={a("draw", 0.36, 0.14)} />
      <Chip x={267} y={140} text="in range ✓" tone="emerald" anchor="middle" anim={a("pop", 0.42, 0.12)} />
      <Vault x={350} y={16} scale={0.74} drawers={["released", "filled", "filled", "filled", "filled"]} barAnim={(i) => (i === 0 ? a("leave", 0.5, 0.18, { x: -60 }) : undefined)} markAnim={(i) => (i === 0 ? a("pop", 0.58, 0.12) : undefined)} />
      <Avatar who="meera" expression="happy" x={92} y={378} r={44} id="story-av-3" />
      <Usdg x={150} y={360} w={120} anim={a("slide", 0.62, 0.22, { x: 240, y: -260 })} />
      <Chip x={290} y={376} text="Tranche 1 released" tone="paper" anim={a("rise", 0.84, 0.14)} />
    </Frame>
  );
}

/* 4 · Off Sri Lanka the door probe warms to 9.1 °C, and the vault's pause latch drops. */
export function ScenePause() {
  return (
    <Frame label="Inside the refrigerated container the door probe reads 9.1 °C while the core probe reads 4.6 °C; the vault is paused with an amber latch, and Meera looks worried">
      <ReeferCutaway x={20} y={18} scale={0.6} probes={["9.1", "4.6"]} status="paused" probeAnim={(k) => (k === 0 ? a("count", 0, 0.5, { from: 4.8, dec: 1 }) : undefined)} outAnim={() => a("fade", 0.36, 0.1)} />
      <Chip x={24} y={246} text="Off Sri Lanka" tone="paper" anim={a("fade", 0, 0.16)} />
      <Chip x={156} y={246} text="probe-1 out of range" tone="danger" anim={a("pop", 0.46, 0.12)} />
      <Character who="meera" crop="waist" expression="worried" look="right" size={196} x={14} y={262} />
      <Vault x={424} y={234} scale={0.46} drawers={["released", "held", "filled", "filled", "filled"]} latchAnim={a("drop", 0.6, 0.18)} latch markAnim={(i) => (i === 1 ? a("pop", 0.7, 0.12) : undefined)} />
      <Chip x={306} y={316} text="Payments paused" tone="amber" anchor="middle" anim={a("pop", 0.78, 0.14)} />
    </Frame>
  );
}

/* 5 · "Proof ready": eight sealed readings fold into a verified shield, the latch lifts, Meera is relieved. */
export function SceneProve() {
  const cells = Array.from({ length: 8 }, (_, i) => ({ x: 296 + (i % 4) * 52, y: 34 + Math.floor(i / 4) * 52 }));
  return (
    <Frame label="A 'Proof ready' notification; eight sealed readings become a green verified shield; the vault's pause latch lifts and Meera smiles with relief">
      <Notification x={18} y={22} w={250} anim={a("drop", 0, 0.16)} />
      {cells.map((c, i) => (
        <SealedReading key={i} x={c.x} y={c.y} anim={a("pop", 0.12 + i * 0.03, 0.1)} />
      ))}
      <Arrow d="M506 86 L524 86" anim={a("draw", 0.42, 0.06)} />
      <Shield x={566} y={90} s={0.48} anim={a("pop", 0.46, 0.14)} checkAnim={a("draw", 0.56, 0.12)} />
      <text x={566} y={164} textAnchor="middle" fontFamily={FONT.mono} fontSize={11} fontWeight={700} fill={P.ink} {...a("fade", 0.6, 0.1)}>verified on chain</text>
      <text x={398} y={164} textAnchor="middle" fontFamily={FONT.body} fontSize={13} fill={P.slate} {...a("fade", 0.3, 0.1)}>8 readings · values stay private</text>
      <Character who="meera" crop="waist" expression="relieved" look="right" size={196} x={14} y={262} />
      <Vault x={424} y={234} scale={0.46} drawers={["released", "filled", "filled", "filled", "filled"]} latchAnim={a("leave", 0.64, 0.16, { y: -60 })} />
      <Chip x={306} y={316} text="Payments resume" tone="emerald" anchor="middle" anim={a("pop", 0.8, 0.14)} />
    </Frame>
  );
}

/* 6 · Wei Lin pays the invoice; the bar splits into Meera's residual and Daniel's principal and fee. */
export function SceneSettle() {
  const x0 = 170;
  const width = 440;
  const residual = Math.round(width * 0.588);
  const principal = Math.round(width * 0.4);
  const fee = 10;
  const g = 8;
  return (
    <Frame label="Wei Lin holding the paid invoice; the 100,000 USDG payment splits into 58,800 for Meera and 41,200 for Daniel, principal plus fee">
      <defs>
        <linearGradient id="story-wf" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={P.signal} />
          <stop offset="1" stopColor={P.verified} />
        </linearGradient>
      </defs>
      <text x={x0 + width / 2} y={66} textAnchor="middle" fontFamily={FONT.mono} fontSize={16} fontWeight={700} fill={P.ink} {...a("fade", 0, 0.12)}>100,000 USDG invoice, paid</text>
      <g {...a("slide", 0.16, 0.2, { x: 6 })}>
        <rect x={x0} y={92} width={residual} height={48} rx={12} fill={P.signalShade} transform="translate(0 4)" />
        <rect x={x0} y={92} width={residual} height={48} rx={12} fill="url(#story-wf)" />
        <text x={x0 + 14} y={122} fontFamily={FONT.mono} fontSize={14} fontWeight={700} fill={P.ink}>58,800 residual</text>
      </g>
      <g {...a("slide", 0.16, 0.2, { x: -2 })}>
        <rect x={x0 + residual + g} y={92} width={principal} height={48} rx={12} fill={P.ink3} />
        <text x={x0 + residual + g + 14} y={122} fontFamily={FONT.mono} fontSize={14} fontWeight={700} fill={P.white}>40,000 principal</text>
      </g>
      <g {...a("slide", 0.16, 0.2, { x: -10 })}>
        <rect x={x0 + residual + principal + 2 * g} y={92} width={fee} height={48} rx={5} fill={P.alert} />
      </g>
      <text x={x0 + residual + principal + 2 * g + fee / 2} y={160} textAnchor="end" fontFamily={FONT.mono} fontSize={12} fontWeight={700} fill={P.ink} {...a("fade", 0.3, 0.1)}>+1,200 fee</text>
      <Arrow d={`M${x0 + residual / 2} 148 C${x0 + residual / 2} 210 300 220 300 268`} anim={a("draw", 0.36, 0.2)} />
      <Arrow d={`M${x0 + residual + g + principal / 2} 148 C${x0 + residual + g + principal / 2} 210 546 220 546 268`} anim={a("draw", 0.36, 0.2)} />
      <Avatar who="meera" expression="happy" x={300} y={318} r={46} id="story-av-6a" anim={a("pop", 0.5, 0.12)} />
      <Avatar who="daniel" expression="happy" x={546} y={318} r={46} id="story-av-6b" anim={a("pop", 0.56, 0.12)} />
      <text x={300} y={398} textAnchor="middle" fontFamily={FONT.body} fontSize={18} fontWeight={700} fill={P.ink} {...a("count", 0.56, 0.3, { from: 0 })}>58,800</text>
      <text x={300} y={420} textAnchor="middle" fontFamily={FONT.body} fontSize={13} fill={P.slate}>USDG to Meera</text>
      <text x={546} y={398} textAnchor="middle" fontFamily={FONT.body} fontSize={18} fontWeight={700} fill={P.ink} {...a("count", 0.6, 0.3, { from: 0 })}>41,200</text>
      <text x={546} y={420} textAnchor="middle" fontFamily={FONT.body} fontSize={13} fill={P.slate}>USDG to Daniel</text>
      <Character who="weilin" prop="invoice" expression="happy" look="right" size={380} x={-34} y={60} />
    </Frame>
  );
}

const SCENES = [SceneRegister, SceneFund, SceneRelease, ScenePause, SceneProve, SceneSettle];

/**
 * One scene by index. A client component so the server page references it by number instead of serialising every
 * path of the illustration into the RSC payload; it still renders to HTML on the server.
 */
export function StoryScene({ index }: { index: number }) {
  const Scene = SCENES[index];
  return Scene ? <Scene /> : null;
}
