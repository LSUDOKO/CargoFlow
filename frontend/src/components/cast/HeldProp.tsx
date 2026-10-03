import { FONT, P } from "./palette";
import type { HeldItem } from "./rig";

/** Small objects a character holds (ported from video/src/characters/HeldProp.tsx). (x, y) is the grip point. */
export function HeldProp({ item, x, y, oneHand = false, right = false }: { item: HeldItem; x: number; y: number; oneHand?: boolean; right?: boolean }) {
  if (right && item !== "pencil") {
    return (
      <g transform={`translate(${2 * x} 0) scale(-1 1)`}>
        <HeldProp item={item} x={x} y={y} oneHand={oneHand} />
      </g>
    );
  }
  if (oneHand && (item === "tablet" || item === "folder")) {
    return (
      <g transform={`translate(${x + 30} ${y - 6}) rotate(-10) scale(0.78) translate(${-x} ${-y})`}>
        <HeldProp item={item} x={x} y={y} />
      </g>
    );
  }
  switch (item) {
    case "pencil":
      return (
        <g transform={`translate(${x - 4} ${y - 8}) rotate(-35)`}>
          <rect x={-4} y={-46} width={8} height={44} rx={2} fill={P.signal} />
          <path d="M-4 -46 L0 -58 L4 -46 Z" fill={P.paperShade} />
          <path d="M-1.5 -53 L0 -58 L1.5 -53 Z" fill={P.ink} />
          <rect x={-4} y={-6} width={8} height={6} rx={2} fill={P.ink3} />
        </g>
      );
    case "tablet":
      return (
        <g transform={`translate(${x} ${y - 34}) rotate(-4)`}>
          <rect x={-58} y={-42} width={116} height={82} rx={10} fill={P.ink} />
          <rect x={-51} y={-35} width={102} height={68} rx={5} fill={P.paper} />
          <rect x={-45} y={-29} width={40} height={6} rx={3} fill={P.ink} opacity={0.8} />
          <rect x={20} y={-29} width={25} height={9} rx={4.5} fill={P.signal} />
          <path d="M-45 22 L-28 12 L-14 16 L2 2 L16 6 L44 -12" stroke={P.verified} strokeWidth={3.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <rect x={-45} y={-15} width={58} height={4} rx={2} fill={P.line} />
        </g>
      );
    case "folder":
      return (
        <g transform={`translate(${x} ${y - 30}) rotate(-3)`}>
          <path d="M-54 -38 h34 l8 8 h66 v70 h-108 Z" fill={P.teal} />
          <rect x={-46} y={-28} width={92} height={60} rx={3} fill={P.white} />
          <rect x={-54} y={-20} width={108} height={60} rx={4} fill={P.teal} />
          <rect x={-38} y={-4} width={46} height={5} rx={2.5} fill={P.signal} />
        </g>
      );
    case "bol":
    case "invoice": {
      const isBol = item === "bol";
      return (
        <g transform={`translate(${x + 18} ${y - 30}) rotate(-8)`}>
          <rect x={-34} y={-44} width={68} height={88} rx={5} fill={P.white} />
          <path d="M34 -44 v88 h-6 v-88 Z" fill={P.whiteShade} />
          <rect x={-34} y={-44} width={68} height={16} rx={5} fill={isBol ? P.ink : P.signal} />
          <rect x={-34} y={-34} width={68} height={6} fill={isBol ? P.ink : P.signal} />
          <text x={0} y={-32} textAnchor="middle" fontFamily={FONT.mono} fontSize={9} fontWeight={700} fill={isBol ? P.white : P.ink}>
            {isBol ? "B/L" : "INVOICE"}
          </text>
          {[-16, -6, 4, 14].map((yy, i) => (
            <rect key={yy} x={-24} y={yy} width={i % 2 ? 34 : 48} height={4} rx={2} fill={P.line} />
          ))}
          {isBol ? <circle cx={18} cy={30} r={7} fill="none" stroke={P.verified} strokeWidth={2.5} /> : <rect x={6} y={26} width={20} height={6} rx={3} fill={P.ink} />}
        </g>
      );
    }
    case "phone":
      return (
        <g transform={`translate(${x + 6} ${y - 26}) rotate(-6)`}>
          <rect x={-18} y={-34} width={36} height={68} rx={7} fill={P.ink} />
          <rect x={-14} y={-29} width={28} height={56} rx={4} fill={P.paper} />
          <rect x={-9} y={-20} width={18} height={18} rx={5} fill={P.emeraldSoft} />
          <rect x={-9} y={6} width={18} height={6} rx={3} fill={P.signal} />
        </g>
      );
    case "vial":
      return (
        <g transform={`translate(${x + 4} ${y - 22}) rotate(-10)`}>
          <rect x={-8} y={-26} width={16} height={8} rx={2} fill={P.verified} />
          <rect x={-7} y={-19} width={14} height={36} rx={4} fill={P.whiteShade} />
          <rect x={-7} y={-2} width={14} height={19} rx={4} fill={P.limeSoft} />
        </g>
      );
    case "logger":
      return (
        <g transform={`translate(${x + 10} ${y - 26}) rotate(-6)`}>
          <path d="M0 -32 C-10 -52 -16 -60 -24 -62" stroke={P.ink} strokeWidth={3} fill="none" strokeLinecap="round" />
          <rect x={-22} y={-32} width={44} height={64} rx={9} fill={P.white} />
          <rect x={14} y={-28} width={6} height={56} rx={3} fill={P.whiteShade} />
          <rect x={-16} y={-25} width={32} height={22} rx={4} fill={P.ink} />
          <rect x={-14} y={-23} width={28} height={18} rx={3} fill={P.limeSoft} />
          <text x={0} y={-9} textAnchor="middle" fontFamily={FONT.mono} fontSize={11} fontWeight={700} fill={P.ink}>4.8</text>
          <circle cx={0} cy={6} r={2.6} fill={P.verified} />
          <circle cx={0} cy={18} r={6} fill={P.mist} />
        </g>
      );
    case "umbrella": {
      const tx = x + 74;
      const ty = y - 236;
      return (
        <g>
          <path d={`M${x} ${y + 16} L${tx} ${ty}`} stroke={P.ink} strokeWidth={5} strokeLinecap="round" />
          <path d={`M${x} ${y + 16} q -2 14 -12 12`} stroke={P.ink} strokeWidth={5} fill="none" strokeLinecap="round" />
          <g transform={`translate(${tx} ${ty}) rotate(16)`}>
            <path d="M-150 66 C-140 6 -76 -26 0 -26 C76 -26 140 6 150 66 C130 52 110 52 90 66 C70 52 48 52 30 66 C12 52 -12 52 -30 66 C-48 52 -70 52 -90 66 C-110 52 -130 52 -150 66 Z" fill={P.ink} />
            <path d="M0 -26 C40 -26 70 6 90 66 C70 52 48 52 30 66 C26 20 16 -6 0 -26 Z" fill={P.ink3} />
            <path d="M0 -26 C-40 -26 -70 6 -90 66 C-70 52 -48 52 -30 66 C-26 20 -16 -6 0 -26 Z" fill={P.ink3} />
            <path d="M-150 66 C-130 52 -110 52 -90 66 C-70 52 -48 52 -30 66 C-12 52 12 52 30 66 C48 52 70 52 90 66 C110 52 130 52 150 66" stroke={P.signal} strokeWidth={4} fill="none" strokeLinejoin="round" />
            <rect x={-3} y={-38} width={6} height={14} rx={3} fill={P.ink} />
          </g>
        </g>
      );
    }
    default:
      return null;
  }
}
