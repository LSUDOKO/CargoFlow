import { Character, type CharacterName } from "@/components/cast/Cast";
import { FONT, P } from "@/components/cast/palette";
import type { Expression, HeldItem } from "@/components/cast/rig";
import { EXCURSION, LABELS, LAND_D, MAP, MILESTONES, PORTS, ROUTE_D } from "./geo";

/*
 * The story's objects, ported from the film's asset library (video/src/assets: Vault, Devices, Reefer, Story, Data)
 * as plain SVG groups for one shared 640 × 440 scene space. Everything renders in its final state on the server;
 * `data-a` attributes tell StoryMotion what to animate in from (see steps.ts).
 */

type Anim = Record<`data-${string}`, string | number | undefined>;

/* ── USDG bar (money never spins: it slides, stacks and splits) ─────────────────────────────────────────── */
export function Usdg({ x = 0, y = 0, w = 150, amount = "8,000", fill = "lime", anim }: { x?: number; y?: number; w?: number; amount?: string; fill?: "lime" | "emerald" | "ghost"; anim?: Anim }) {
  const h = w * 0.267;
  const base = fill === "emerald" ? P.verified : fill === "ghost" ? P.mist : P.signal;
  const shade = fill === "emerald" ? P.verifiedShade : fill === "ghost" ? P.line : P.signalShade;
  const ink = fill === "emerald" ? P.white : fill === "ghost" ? P.slate : P.ink;
  return (
    <g transform={`translate(${x} ${y})`}>
      <g {...anim}>
        <rect x={0} y={h * 0.1} width={w} height={h} rx={h * 0.28} fill={shade} />
        <rect x={0} y={0} width={w} height={h} rx={h * 0.28} fill={base} />
        <text x={w * 0.08} y={h * 0.64} fontFamily={FONT.mono} fontSize={h * 0.32} fontWeight={700} fill={ink} opacity={0.7}>USDG</text>
        <text x={w * 0.92} y={h * 0.66} textAnchor="end" fontFamily={FONT.mono} fontSize={h * 0.4} fontWeight={700} fill={ink}>{amount}</text>
      </g>
    </g>
  );
}

/* ── The tranche vault: a glass-fronted cabinet, one drawer per milestone ──────────────────────────────── */
export type DrawerState = "empty" | "filled" | "released" | "held";

export function Vault({
  x = 0,
  y = 0,
  scale = 1,
  drawers,
  barAnim,
  markAnim,
  latch = false,
  latchAnim,
  label = "Escrow vault",
}: {
  x?: number;
  y?: number;
  scale?: number;
  drawers: DrawerState[];
  /** Attributes for the bar inside drawer i (a drop-in, a release). */
  barAnim?: (i: number) => Anim | undefined;
  /** Attributes for drawer i's released / held mark. */
  markAnim?: (i: number) => Anim | undefined;
  latch?: boolean;
  latchAnim?: Anim;
  label?: string;
}) {
  const W = 360;
  const H = 440;
  const dx = 34;
  const dw = W - 2 * dx - 26;
  const dh = 58;
  const gap = 12;
  const y0 = 62;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x={18} y={H - 12} width={W - 36} height={10} rx={5} fill={P.ink} opacity={0.08} />
      <rect x={34} y={H - 34} width={30} height={22} rx={4} fill={P.ink} />
      <rect x={W - 64} y={H - 34} width={30} height={22} rx={4} fill={P.ink} />
      <rect x={0} y={0} width={W} height={H - 30} rx={22} fill={P.ink2} />
      <rect x={W - 26} y={14} width={12} height={H - 58} rx={6} fill={P.ink} opacity={0.35} />
      <rect x={dx} y={18} width={label.length * 9.4 + 24} height={28} rx={8} fill={P.ink} />
      <text x={dx + 12} y={37} fontFamily={FONT.mono} fontSize={14} fontWeight={700} fill={P.white}>{label}</text>
      {drawers.map((st, i) => {
        const dy = y0 + i * (dh + gap);
        // a bar is drawn when the drawer is filled, and also (hidden) when it was just released, so it can slide out
        const bar = st === "filled" || st === "held" || (st === "released" && barAnim?.(i));
        return (
          <g key={i}>
            <rect x={dx - 4} y={dy - 4} width={dw + 8} height={dh + 8} rx={12} fill={P.ink} />
            <rect x={dx} y={dy} width={dw} height={dh} rx={9} fill={P.inkSoft} />
            <rect x={dx + 8} y={dy + 6} width={dw * 0.5} height={5} rx={2.5} fill={P.white} opacity={0.18} />
            {bar ? (
              <g opacity={st === "released" ? 0 : undefined} {...barAnim?.(i)}>
                <Usdg x={dx + 58} y={dy + 12} w={dw - 76} />
              </g>
            ) : null}
            <text x={dx + 14} y={dy + dh / 2 + 6} fontFamily={FONT.mono} fontSize={16} fontWeight={700} fill={P.white} opacity={0.85}>M{i + 1}</text>
            {st === "released" ? (
              <g transform={`translate(${dx + dw - 30} ${dy + dh / 2})`}>
                <g {...markAnim?.(i)}>
                  <circle r={14} fill={P.verified} />
                  <path d="M-6 0.5 l4 4 l8 -8" stroke={P.white} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              </g>
            ) : null}
            {st === "held" ? (
              <g transform={`translate(${dx + dw - 30} ${dy + dh / 2})`}>
                <g {...markAnim?.(i)}>
                  <circle r={14} fill={P.alert} />
                  <path d="M0 -7 V0 L5 4" stroke={P.ink} strokeWidth={2.6} fill="none" strokeLinecap="round" />
                </g>
              </g>
            ) : null}
            <rect x={dx + dw / 2 - 20} y={dy + dh - 9} width={40} height={5} rx={2.5} fill={P.slate} />
          </g>
        );
      })}
      {latch || latchAnim ? (
        <g opacity={latch ? undefined : 0} {...latchAnim}>
          {[dx - 16, dx + dw + 6].map((lxp) => (
            <g key={lxp}>
              <rect x={lxp} y={y0 - 4} width={10} height={5 * (dh + gap) - 4} rx={5} fill={P.alert} />
              {[0, 1, 2, 3, 4].map((i) => (
                <rect key={i} x={lxp - 2} y={y0 + i * (dh + gap) + dh / 2 - 5} width={14} height={10} rx={3} fill={P.alertShade} />
              ))}
            </g>
          ))}
          <rect x={W - 26 - 112} y={18} width={104} height={28} rx={8} fill={P.alert} />
          <text x={W - 26 - 60} y={37} textAnchor="middle" fontFamily={FONT.mono} fontSize={14} fontWeight={700} fill={P.ink} letterSpacing={2.5}>PAUSED</text>
        </g>
      ) : null}
    </g>
  );
}

/* ── The cold-chain data logger ───────────────────────────────────────────────────────────────────────── */
export function Logger({ x = 0, y = 0, scale = 1, value = "4.8", alarm = false, valueAnim, sigAnim, id = "probe-1" }: { x?: number; y?: number; scale?: number; value?: string; alarm?: boolean; valueAnim?: Anim; sigAnim?: Anim; id?: string }) {
  const led = alarm ? P.danger : P.verified;
  const lcd = alarm ? "#FBE3E3" : P.limeSoft;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M110 30 C96 -10 70 -40 40 -56 M110 30 C124 -10 150 -40 180 -56" stroke={P.ink} strokeWidth={5} fill="none" strokeLinecap="round" />
      <rect x={96} y={18} width={28} height={22} rx={6} fill={P.ink} />
      <rect x={30} y={326} width={160} height={10} rx={5} fill={P.ink} opacity={0.08} />
      <rect x={30} y={34} width={160} height={288} rx={30} fill={P.white} />
      <rect x={160} y={56} width={16} height={246} rx={8} fill={P.whiteShade} />
      <rect x={48} y={62} width={124} height={100} rx={12} fill={P.ink} />
      <rect x={55} y={69} width={110} height={86} rx={7} fill={lcd} />
      <text x={64} y={88} fontFamily={FONT.mono} fontSize={12} fontWeight={700} fill={P.ink} opacity={0.65}>SIGNED</text>
      <text x={156} y={140} textAnchor="end" fontFamily={FONT.mono} fontSize={40} fontWeight={700} fill={alarm ? P.danger : P.ink} {...valueAnim}>{value}</text>
      <text x={64} y={142} fontFamily={FONT.mono} fontSize={13} fontWeight={700} fill={P.ink} opacity={0.65}>°C</text>
      <circle cx={110} cy={194} r={8} fill={P.mist} />
      <circle cx={110} cy={194} r={5} fill={led} />
      <circle cx={110} cy={248} r={28} fill={P.mist} />
      <circle cx={110} cy={248} r={20} fill={P.whiteShade} />
      <circle cx={110} cy={248} r={7} fill="none" stroke={P.slate} strokeWidth={3} />
      <text x={110} y={302} textAnchor="middle" fontFamily={FONT.mono} fontSize={12} fontWeight={700} fill={P.slate} letterSpacing={1}>{id}</text>
      {sigAnim ? (
        <g transform="translate(206 106)">
          <g {...sigAnim}>
            <rect x={0} y={-14} width={44} height={28} rx={8} fill={P.ink} />
            <text x={22} y={5} textAnchor="middle" fontFamily={FONT.mono} fontSize={13} fontWeight={700} fill={P.signal}>sig</text>
          </g>
        </g>
      ) : null}
    </g>
  );
}

/* ── The reefer, cut away: cartons on pallets and two hanging probes (door and core) ─────────────────── */
export function ReeferCutaway({ x = 0, y = 0, scale = 1, probes, probeAnim, outAnim, status = "ok" }: { x?: number; y?: number; scale?: number; probes: [string, string]; probeAnim?: (k: number) => Anim | undefined; outAnim?: (k: number) => Anim | undefined; status?: "ok" | "paused" }) {
  const W = 1000;
  const H = 330;
  const innerX = 20;
  const innerW = W - 150;
  const floor = H - 30;
  const probeX = [260, 600];
  const band: [number, number] = [2, 8];
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x={10} y={H + 2} width={W - 20} height={8} rx={4} fill={P.ink} opacity={0.08} />
      <rect x={0} y={0} width={W} height={H} rx={4} fill={P.ink2} />
      <rect x={innerX} y={20} width={innerW} height={floor - 20} fill={P.mist} />
      {Array.from({ length: 34 }).map((_, i) => (
        <rect key={i} x={innerX + 10 + i * (innerW / 34)} y={20} width={8} height={floor - 20} fill={P.paperShade} />
      ))}
      <rect x={innerX} y={floor - 10} width={innerW} height={10} fill={P.slate} opacity={0.5} />
      <rect x={innerX} y={20} width={innerW} height={14} fill={P.white} />
      <rect x={innerX} y={20} width={16} height={floor - 30} rx={6} fill={P.white} />
      {[0, 1, 2, 3].map((pi) => {
        const px = innerX + 60 + pi * 196;
        return (
          <g key={pi}>
            <rect x={px} y={floor - 26} width={160} height={14} rx={2} fill={P.ink3} />
            {[0, 1].map((row) =>
              [0, 1].map((col) => {
                const bx = px + 4 + col * 78;
                const by = floor - 26 - (row + 1) * 62;
                return (
                  <g key={`${row}${col}`}>
                    <rect x={bx} y={by} width={74} height={58} rx={4} fill={P.white} />
                    <rect x={bx + 60} y={by} width={14} height={58} rx={3} fill={P.whiteShade} />
                    <rect x={bx + 8} y={by + 10} width={30} height={10} rx={3} fill={P.signal} />
                    <rect x={bx + 8} y={by + 28} width={40} height={4} rx={2} fill={P.line} />
                  </g>
                );
              }),
            )}
          </g>
        );
      })}
      {probes.map((v, k) => {
        const px = probeX[k]!;
        const n = Number(v);
        const out = n < band[0] || n > band[1];
        return (
          <g key={k}>
            <path d={`M${px} 20 C${px} 60 ${px + 30} 80 ${px + 30} 110 L${px + 30} 150`} stroke={P.ink} strokeWidth={4} fill="none" strokeLinecap="round" />
            <rect x={px + 25} y={150} width={10} height={16} rx={4} fill={P.ink} />
            <g transform={`translate(${px + 46} 50)`}>
              <rect width={124} height={84} rx={12} fill={P.ink} />
              <rect x={7} y={7} width={110} height={44} rx={6} fill={P.limeSoft} />
              {out ? (
                <g {...outAnim?.(k)}>
                  <rect x={7} y={7} width={110} height={44} rx={6} fill="#FBE3E3" />
                  <circle cx={-16} cy={108} r={18} fill="none" stroke={P.danger} strokeWidth={3} opacity={0.7} />
                  <rect x={-21} y={100} width={10} height={16} rx={4} fill={P.danger} />
                </g>
              ) : null}
              <text x={108} y={40} textAnchor="end" fontFamily={FONT.mono} fontSize={30} fontWeight={700} fill={out ? "#A1191E" : P.ink} {...probeAnim?.(k)}>{v}</text>
              <text x={14} y={40} fontFamily={FONT.mono} fontSize={13} fontWeight={700} fill={P.ink} opacity={0.6}>°C</text>
              <text x={62} y={72} textAnchor="middle" fontFamily={FONT.mono} fontSize={13} fontWeight={700} fill={P.white}>{k === 0 ? "door probe" : "core probe"}</text>
            </g>
          </g>
        );
      })}
      <rect x={W - 130} y={20} width={110} height={floor - 20} rx={4} fill={P.ink3} />
      <rect x={W - 118} y={40} width={86} height={110} rx={8} fill={P.ink} />
      {[0, 1, 2, 3, 4].map((k) => (
        <rect key={k} x={W - 110} y={52 + k * 18} width={70} height={6} rx={3} fill={P.ink3} />
      ))}
      <circle cx={W - 75} cy={230} r={14} fill={P.ink} />
      <circle cx={W - 75} cy={230} r={10} fill={status === "paused" ? P.alert : P.verified} />
      <rect x={0} y={0} width={W} height={20} rx={3} fill={P.ink2} />
      <rect x={0} y={floor} width={W} height={H - floor} rx={3} fill={P.ink} />
    </g>
  );
}

/* ── The corridor map (the film's map kit: paper-shade land, ink coast, near-white sea) ──────────────── */
export function RouteMap({
  x = 0,
  y = 0,
  scale = 1,
  routeAnim,
  pipAnim,
  shipAt,
  shipStatus = "ok",
  shipAnim,
  clipId,
}: {
  x?: number;
  y?: number;
  scale?: number;
  routeAnim?: Anim;
  pipAnim?: (i: number) => Anim | undefined;
  /** The live dot: a milestone index or "excursion". */
  shipAt?: number | "excursion";
  shipStatus?: "ok" | "paused";
  shipAnim?: Anim;
  clipId: string;
}) {
  const ship = shipAt === undefined ? null : shipAt === "excursion" ? EXCURSION : MILESTONES[shipAt]!;
  const halo = { stroke: P.sea, strokeWidth: 5, paintOrder: "stroke" as const };
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <defs>
        <clipPath id={clipId}>
          <rect width={MAP.w} height={MAP.h} rx={18} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width={MAP.w} height={MAP.h} fill={P.sea} />
        <path d={LAND_D} fill={P.land} stroke="rgba(11,27,43,0.7)" strokeWidth={1.2} strokeLinejoin="round" />
        <text x={LABELS.india[0] + 2} y={LABELS.india[1] + 40} textAnchor="middle" fontFamily={FONT.body} fontWeight={600} fontSize={14} fill={P.ink} opacity={0.4} letterSpacing={5}>INDIA</text>
        <text x={LABELS.srilanka[0] + 30} y={LABELS.srilanka[1] - 14} textAnchor="start" fontFamily={FONT.body} fontWeight={600} fontSize={10} fill={P.ink} opacity={0.45} letterSpacing={1.5}>SRI LANKA</text>
        <text x={LABELS.arabian[0] + 16} y={LABELS.arabian[1] + 30} textAnchor="middle" fontFamily={FONT.body} fontStyle="italic" fontSize={12} fill={P.teal} opacity={0.6} letterSpacing={1}>Arabian Sea</text>
        <text x={LABELS.bengal[0]} y={LABELS.bengal[1] + 40} textAnchor="middle" fontFamily={FONT.body} fontStyle="italic" fontSize={12} fill={P.teal} opacity={0.6} letterSpacing={1}>Bay of Bengal</text>
        <text x={LABELS.ocean[0]} y={LABELS.ocean[1] + 6} textAnchor="middle" fontFamily={FONT.body} fontStyle="italic" fontSize={12} fill={P.teal} opacity={0.6} letterSpacing={1}>Indian Ocean</text>
        {/* planned lane: corridor + dotted line; travelled lane: solid ink drawn on */}
        <path d={ROUTE_D} fill="none" stroke={P.ink} strokeOpacity={0.06} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" />
        <path d={ROUTE_D} fill="none" stroke={P.ink} strokeOpacity={0.55} strokeWidth={2} strokeDasharray="1 6" strokeLinecap="round" />
        {routeAnim ? <path d={ROUTE_D} fill="none" stroke={P.ink} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" {...routeAnim} /> : null}
        {MILESTONES.map(([mx, my], i) => (
          <g key={i} transform={`translate(${mx} ${my})`}>
            <g {...pipAnim?.(i)}>
              <rect x={-15} y={-11} width={30} height={22} rx={11} fill={P.white} stroke={P.ink} strokeWidth={2} />
              <text y={4.5} textAnchor="middle" fontFamily={FONT.mono} fontSize={11} fontWeight={700} fill={P.ink}>M{i + 1}</text>
            </g>
          </g>
        ))}
        {/* port names beside their milestone pips (M1 Nhava Sheva, M3 off Colombo, M5 Singapore) */}
        <text x={PORTS.nhavaSheva[0] + 20} y={PORTS.nhavaSheva[1] + 5} fontFamily={FONT.body} fontWeight={600} fontSize={14} fill={P.ink} {...halo}>Nhava Sheva</text>
        <text x={PORTS.colombo[0] - 14} y={PORTS.colombo[1] + 32} textAnchor="end" fontFamily={FONT.body} fontWeight={600} fontSize={14} fill={P.ink} {...halo}>Colombo</text>
        <text x={PORTS.singapore[0] - 4} y={PORTS.singapore[1] - 18} textAnchor="end" fontFamily={FONT.body} fontWeight={600} fontSize={14} fill={P.ink} {...halo}>Singapore</text>
        {ship ? (
          <g transform={`translate(${ship[0]} ${ship[1]})`}>
            <g {...shipAnim}>
              <circle r={16} fill={shipStatus === "paused" ? P.alert : P.signal} opacity={0.35} />
              <circle r={8} fill={P.ink} />
              <circle r={8} fill="none" stroke={shipStatus === "paused" ? P.alert : P.signal} strokeWidth={3} />
            </g>
          </g>
        ) : null}
      </g>
      <rect width={MAP.w} height={MAP.h} rx={18} fill="none" stroke={P.line} strokeWidth={2} />
    </g>
  );
}

/* ── "Proof ready": the in-app notification ───────────────────────────────────────────────────────────── */
export function Notification({ x = 0, y = 0, w = 260, title = "Proof ready", action = "Review and sign", anim }: { x?: number; y?: number; w?: number; title?: string; action?: string; anim?: Anim }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g {...anim}>
        <rect x={0} y={6} width={w} height={128} rx={16} fill={P.ink} opacity={0.08} />
        <rect width={w} height={124} rx={16} fill={P.white} stroke={P.line} strokeWidth={1.5} />
        <rect x={16} y={16} width={34} height={34} rx={10} fill={P.ink} />
        <path d="M26 39 h14 l-2 -3 v-5 a5 5 0 0 0 -10 0 v5 Z" fill={P.signal} />
        <circle cx={33} cy={42} r={2.4} fill={P.signal} />
        <text x={62} y={29} fontFamily={FONT.mono} fontSize={10} fill={P.slate} letterSpacing={1}>CARGOFLOW · NOW</text>
        <text x={62} y={49} fontFamily={FONT.display} fontSize={19} fontWeight={700} fill={P.ink}>{title}</text>
        <rect x={16} y={66} width={w - 32} height={40} rx={10} fill={P.ink} />
        <text x={w / 2} y={91} textAnchor="middle" fontFamily={FONT.body} fontSize={14} fontWeight={600} fill={P.white}>{action}</text>
      </g>
    </g>
  );
}

/* ── Zero-knowledge proof: sealed readings fold into a shield ─────────────────────────────────────────── */
export function SealedReading({ x, y, s = 1, anim }: { x: number; y: number; s?: number; anim?: Anim }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <g {...anim}>
        <rect width={44} height={44} rx={10} fill={P.ink2} />
        <rect x={5} y={5} width={34} height={34} rx={7} fill="none" stroke={P.ink3} strokeWidth={2} strokeDasharray="4 5" />
        <rect x={15} y={20} width={14} height={11} rx={2.5} fill={P.signal} />
        <path d="M18 20 v-3 a4 4 0 0 1 8 0 v3" stroke={P.signal} strokeWidth={2.4} fill="none" />
      </g>
    </g>
  );
}

export function Shield({ x, y, s = 1, anim, checkAnim, label }: { x: number; y: number; s?: number; anim?: Anim; checkAnim?: Anim; label?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <g {...anim}>
        <path d="M0 -78 L64 -54 V2 C64 44 34 70 0 84 C-34 70 -64 44 -64 2 V-54 Z" fill={P.verified} />
        <path d="M0 -78 L64 -54 V2 C64 44 34 70 0 84 Z" fill={P.verifiedShade} />
        <path d="M-26 2 L-7 21 L28 -16" stroke={P.white} strokeWidth={12} fill="none" strokeLinecap="round" strokeLinejoin="round" {...checkAnim} />
        {label ? (
          <g transform="translate(0 116)">
            <rect x={-86} y={-17} width={172} height={34} rx={17} fill={P.ink} />
            <text y={5} textAnchor="middle" fontFamily={FONT.mono} fontSize={13} fontWeight={700} fill={P.signal} letterSpacing={1}>{label}</text>
          </g>
        ) : null}
      </g>
    </g>
  );
}

/* ── A person in a round frame, for scenes where they receive something ─────────────────────────────── */
export function Avatar({ who, x, y, r = 44, expression = "neutral", prop = "none", id, anim }: { who: CharacterName; x: number; y: number; r?: number; expression?: Expression; prop?: HeldItem; id: string; anim?: Anim }) {
  const h = r * 2.4;
  return (
    <g transform={`translate(${x} ${y})`}>
      <g {...anim}>
        <defs>
          <clipPath id={id}>
            <circle r={r} />
          </clipPath>
        </defs>
        <circle r={r} fill={P.mist} />
        <g clipPath={`url(#${id})`}>
          <Character who={who} crop="bust" expression={expression} prop={prop} size={h} x={-(h * (236 / 300)) / 2} y={-r * 1.08} />
        </g>
        <circle r={r} fill="none" stroke={P.white} strokeWidth={4} />
      </g>
    </g>
  );
}

/** A small rounded label chip in scene space. */
export function Chip({ x, y, text, tone = "ink", anchor = "start", anim }: { x: number; y: number; text: string; tone?: "ink" | "amber" | "emerald" | "danger" | "paper"; anchor?: "start" | "middle"; anim?: Anim }) {
  const w = text.length * 8.1 + 26;
  const bg = { ink: P.ink, amber: P.alert, emerald: P.verified, danger: "#C8323A", paper: P.white }[tone];
  const fg = { ink: P.white, amber: P.ink, emerald: P.ink, danger: P.white, paper: P.ink }[tone];
  const x0 = anchor === "middle" ? -w / 2 : 0;
  return (
    <g transform={`translate(${x} ${y})`}>
      <g {...anim}>
        <rect x={x0} y={-15} width={w} height={30} rx={15} fill={bg} stroke={tone === "paper" ? P.line : undefined} strokeWidth={tone === "paper" ? 1.5 : undefined} />
        <text x={x0 + w / 2} y={5} textAnchor="middle" fontFamily={FONT.mono} fontSize={13} fontWeight={700} fill={fg}>{text}</text>
      </g>
    </g>
  );
}
