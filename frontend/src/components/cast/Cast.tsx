"use client";

import { P } from "./palette";
import type { CharacterName } from "./data";

export type { CharacterName } from "./data";
import { type Appearance, type CharacterProps, type FaceLayerProps, Person } from "./Person";

/*
 * A client module on purpose: server pages reference <Character who=… /> by name instead of serialising every
 * SVG path into the RSC payload twice. Names, roles and sentences live in data.ts.
 *
 * The six people of CargoFlow, ported 1:1 from the film (video/src/characters/Cast.tsx). All hair is built on the
 * same head (x 156..244, crown y 62, chin 172), so every character keeps identical proportions.
 */

const Glasses = ({ lx, color = P.ink }: { lx: number; color?: string }) => (
  <g fill="none" stroke={color} strokeWidth={2.8}>
    {[-1, 1].map((s) => (
      <rect key={s} x={200 + s * 18 + lx - 11.5} y={111} width={23} height={18} rx={7} fill={P.white} fillOpacity={0.14} />
    ))}
    <path d={`M${200 + lx - 6.5} 118 Q${200 + lx} 114 ${200 + lx + 6.5} 118`} strokeLinecap="round" />
  </g>
);

/* Meera */
const MEERA_HAIR = "#1C1A22";
const MEERA: Appearance = {
  build: "f",
  skin: "#B57A54",
  skinShade: "#9A6143",
  hair: MEERA_HAIR,
  outfit: "lab",
  top: P.white,
  topShade: P.paperShade,
  inner: P.teal,
  innerShade: P.signal,
  trousers: P.ink2,
  trousersShade: P.ink,
  shoes: P.ink,
  cuff: P.teal,
  Back: () => <path d="M150 120 C146 64 176 52 200 52 C224 52 254 64 250 120 L250 182 C250 196 232 200 200 200 C168 200 150 196 150 182 Z" fill={MEERA_HAIR} />,
  Front: ({ lx }: FaceLayerProps) => {
    const p = 200 + lx * 0.5;
    return (
      <g>
        <path d={`M152 126 C147 70 174 53 200 53 C226 53 253 70 248 126 C246 104 238 88 224 81 C214 76 ${p + 6} 77 ${p} 85 C${p - 6} 77 186 76 176 81 C162 88 154 104 152 126 Z`} fill={MEERA_HAIR} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <ellipse key={i} cx={238 + i * 2.2} cy={168 + i * 21} rx={11 - i * 0.6} ry={13} fill={MEERA_HAIR} />
        ))}
        <rect x={244} y={286} width={12} height={8} rx={3} fill={P.signal} />
        <circle cx={156 - lx * 0.35} cy={134} r={2.6} fill={P.signal} />
      </g>
    );
  },
  Chest: () => (
    <g>
      <rect x={148} y={258} width={26} height={34} rx={4} fill={P.white} />
      <rect x={148} y={258} width={26} height={8} rx={3} fill={P.ink} />
      <rect x={153} y={272} width={16} height={3} rx={1.5} fill={P.line} />
      <rect x={153} y={279} width={11} height={3} rx={1.5} fill={P.line} />
    </g>
  ),
  mouth: "#2B1212",
};

/* Daniel */
const DANIEL_HAIR = "#17131A";
const DANIEL: Appearance = {
  build: "m",
  skin: "#7B4B30",
  skinShade: "#653B24",
  hair: DANIEL_HAIR,
  outfit: "blazer",
  top: P.ink3,
  topShade: P.ink2,
  inner: P.white,
  innerShade: P.whiteShade,
  trousers: P.ink2,
  trousersShade: P.ink,
  shoes: P.ink,
  cuff: P.white,
  Front: ({ lx }: FaceLayerProps) => (
    <g>
      <path d="M156 110 C153 68 176 56 200 56 C226 56 247 68 244 110 C241 94 236 85 228 81 C214 76 186 76 172 81 C164 85 159 95 156 110 Z" fill={DANIEL_HAIR} />
      <rect x={155} y={96} width={6} height={16} rx={3} fill="#8E99A3" />
      <rect x={239} y={96} width={6} height={16} rx={3} fill="#8E99A3" />
      <Glasses lx={lx} />
    </g>
  ),
  Beard: ({ lx }: FaceLayerProps) => (
    <g>
      <path d="M158 126 C160 157 178 173 200 173 C222 173 240 157 242 126 C238 150 226 162 200 162 C174 162 162 150 158 126 Z" fill={DANIEL_HAIR} opacity={0.5} />
      <path d={`M${186 + lx} 144 Q${200 + lx} 137 ${214 + lx} 144 Q${200 + lx} 141 ${186 + lx} 144 Z`} fill={DANIEL_HAIR} opacity={0.7} />
    </g>
  ),
  Chest: () => <path d="M226 246 L246 246 L242 236 L234 242 L230 236 Z" fill={P.white} />,
  mouth: "#1A0C0C",
};

/* Wei Lin */
const WEI_HAIR = "#1E1B23";
const WEI_LIN: Appearance = {
  build: "f",
  skin: "#EBC6A2",
  skinShade: "#D5A781",
  hair: WEI_HAIR,
  outfit: "blazer",
  top: P.emeraldDeep,
  topShade: P.emeraldDeepShade,
  inner: P.white,
  innerShade: P.whiteShade,
  trousers: P.ink2,
  trousersShade: P.ink,
  shoes: P.ink,
  Back: () => <path d="M146 118 C142 62 174 50 200 50 C226 50 258 62 254 118 L256 160 C256 174 248 180 238 178 L162 178 C152 180 144 174 144 160 Z" fill={WEI_HAIR} />,
  Front: ({ lx }: FaceLayerProps) => (
    <g>
      <path d={`M149 146 C143 72 172 52 202 52 C232 52 258 72 251 146 C248 116 245 100 240 90 C222 100 ${196 + lx} 101 ${170 + lx * 0.5} 90 C160 104 153 122 149 146 Z`} fill={WEI_HAIR} />
      <circle cx={156 - lx * 0.35} cy={134} r={3.4} fill={P.white} />
    </g>
  ),
  Chest: () => <circle cx={228} cy={232} r={4.5} fill={P.signal} />,
};

/* Arbiter */
const ARB_HAIR = "#C3CBD2";
const ARBITER: Appearance = {
  build: "m",
  skin: "#E8BE9C",
  skinShade: "#D1A17D",
  hair: ARB_HAIR,
  brow: "#9AA5AF",
  outfit: "longcoat",
  top: P.ink2,
  topShade: P.ink,
  inner: P.white,
  trousers: P.ink,
  trousersShade: "#071420",
  shoes: P.ink,
  Front: () => (
    <g>
      <path d="M155 116 C152 92 156 76 166 70 C164 82 162 96 162 116 Z" fill={ARB_HAIR} />
      <path d="M245 116 C248 92 244 76 234 70 C236 82 238 96 238 116 Z" fill={ARB_HAIR} />
      <path d="M170 70 C182 60 218 60 230 70 C218 66 182 66 170 70 Z" fill={ARB_HAIR} />
    </g>
  ),
  Beard: ({ lx }: FaceLayerProps) => (
    <g>
      <path d={`M158 124 C160 160 178 178 200 178 C222 178 240 160 242 124 C238 148 230 156 ${214 + lx} 154 C${206 + lx} 141 ${194 + lx} 141 ${186 + lx} 154 C170 156 162 148 158 124 Z`} fill={ARB_HAIR} />
      <path d={`M${184 + lx} 145 Q${200 + lx} 136 ${216 + lx} 145 Q${200 + lx} 141 ${184 + lx} 145 Z`} fill={ARB_HAIR} />
    </g>
  ),
  Chest: () => (
    <g transform="translate(226 252)">
      <path d="M0 -15 L13 -10 V1 C13 9 7 14 0 17 C-7 14 -13 9 -13 1 V-10 Z" fill={P.verified} />
      <path d="M-7 -3 H7 M0 -7 V8 M-6 -3 L-8 3 H-4 Z M6 -3 L4 3 H8 Z" stroke={P.white} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
};

/* Insurer */
const HIJAB = P.ink3;
const HIJAB_SHADE = P.ink2;
const INSURER: Appearance = {
  build: "f",
  skin: "#C8916A",
  skinShade: "#AD7652",
  hair: HIJAB,
  brow: "#2A1E1E",
  outfit: "cardigan",
  top: P.mist,
  topShade: P.line,
  inner: P.teal,
  trousers: P.ink2,
  trousersShade: P.ink,
  shoes: P.ink,
  Back: () => <path d="M146 120 C142 58 172 46 200 46 C228 46 258 58 254 120 C254 160 262 192 278 216 L122 216 C138 192 146 160 146 120 Z" fill={HIJAB} />,
  Front: () => (
    <g>
      <path
        fillRule="evenodd"
        d="M147 118 C145 60 174 48 200 48 C226 48 255 60 253 118 C253 152 238 180 200 188 C162 180 147 152 147 118 Z M163 116 C163 84 179 70 200 70 C221 70 237 84 237 116 C237 144 221 165 200 166 C179 165 163 144 163 116 Z"
        fill={HIJAB}
      />
      <path d="M237 116 C237 146 221 168 200 170 L200 188 C238 180 253 152 253 118 C253 92 246 72 232 60 C236 78 237 96 237 116 Z" fill={HIJAB_SHADE} opacity={0.6} />
      <path d="M158 172 C172 194 228 194 242 172 L268 216 L132 216 Z" fill={HIJAB} />
    </g>
  ),
};

/* Carrier */
const CAR_HAIR = "#1A1720";
const CARRIER: Appearance = {
  build: "m",
  skin: "#B98058",
  skinShade: "#9D6643",
  hair: CAR_HAIR,
  outfit: "uniform",
  top: P.white,
  topShade: P.paperShade,
  inner: P.white,
  trousers: P.ink,
  trousersShade: "#071420",
  shoes: P.ink,
  Front: () => (
    <g>
      <rect x={155} y={92} width={7} height={22} rx={3.5} fill={CAR_HAIR} />
      <rect x={238} y={92} width={7} height={22} rx={3.5} fill={CAR_HAIR} />
      <path d="M148 86 C148 58 174 44 200 44 C226 44 252 58 252 86 Z" fill={P.white} />
      <path d="M222 47 C240 53 252 66 252 86 L232 86 C232 70 230 58 222 47 Z" fill={P.whiteShade} />
      <rect x={153} y={80} width={94} height={15} rx={4} fill={P.ink} />
      <path d="M156 94 Q200 108 244 94 L241 101 Q200 116 159 101 Z" fill={P.ink2} />
      <circle cx={200} cy={87} r={5.5} fill={P.signal} />
      <circle cx={200} cy={87} r={2.2} fill={P.ink} />
    </g>
  ),
  Chest: () => (
    <g>
      <rect x={218} y={234} width={22} height={7} rx={2} fill={P.ink} />
      <rect x={221} y={236.5} width={10} height={2} rx={1} fill={P.signal} />
    </g>
  ),
  mouth: "#2B1212",
};

export const APPEARANCES: Record<CharacterName, Appearance> = { meera: MEERA, daniel: DANIEL, weilin: WEI_LIN, arbiter: ARBITER, insurer: INSURER, carrier: CARRIER };
const SEED: Record<CharacterName, number> = { meera: 1, daniel: 2, weilin: 3, arbiter: 4, insurer: 5, carrier: 6 };

/** Render any cast member by name. */
export function Character({ who, ...p }: CharacterProps & { who: CharacterName }) {
  return <Person look_={APPEARANCES[who]} seed={SEED[who]} {...p} />;
}
