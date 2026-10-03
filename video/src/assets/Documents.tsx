import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE_IN_OUT } from "../lib/anim";
import { F } from "../theme";
import { P, hash } from "./palette";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** A rubber stamp that thumps down at `at` (scale 1.6 → 1 with a spring). */
const Stamp: React.FC<{ text: string; color: string; at?: number; x: number; y: number; rotate?: number }> = ({ text, color, at, x, y, rotate = -12 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = at === undefined ? 1 : spring({ frame: frame - at, fps, config: { damping: 11, stiffness: 220 } });
  if (k <= 0.001) return null;
  const s = 1.6 - 0.6 * k;
  const w = text.length * 15 + 34;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${s})`} opacity={Math.min(1, k * 1.6)}>
      <rect x={-w / 2} y={-22} width={w} height={44} rx={8} fill="none" stroke={color} strokeWidth={4} />
      <text x={0} y={8} textAnchor="middle" fontFamily={F.mono} fontSize={22} fontWeight={700} fill={color} letterSpacing={2}>
        {text}
      </text>
    </g>
  );
};

/** Commercial invoice. Optional stamp ("FINANCED", "PAID") thumps on at `stampAt`. */
export const Invoice: React.FC<{
  width?: number;
  number?: string;
  amount?: string;
  from?: string;
  to?: string;
  item?: string;
  terms?: string;
  stamp?: string;
  stampColor?: string;
  stampAt?: number;
  style?: React.CSSProperties;
}> = ({
  width = 340,
  number = "INV-2026-0412",
  amount = "100,000 USDG",
  from = "Exporter · Pune, IN",
  to = "Importer · Singapore, SG",
  item = "Vaccine vials, 2–8 °C",
  terms = "Net 60",
  stamp,
  stampColor = P.verified,
  stampAt,
  style,
}) => (
  <svg width={width} viewBox="0 0 340 440" style={{ display: "block", overflow: "visible", ...style }}>
    <rect x={14} y={430} width={312} height={10} rx={5} fill={P.ink} opacity={0.08} />
    <rect x={0} y={0} width={340} height={430} rx={14} fill={P.white} />
    <rect x={318} y={14} width={8} height={402} rx={4} fill={P.whiteShade} />
    <rect x={28} y={30} width={40} height={40} rx={10} fill={P.signal} />
    <rect x={38} y={40} width={20} height={20} rx={5} fill={P.ink} />
    <rect x={44} y={46} width={8} height={8} rx={2} fill={P.signal} />
    <text x={312} y={48} textAnchor="end" fontFamily={F.display} fontSize={24} fontWeight={700} fill={P.ink}>
      Invoice
    </text>
    <text x={312} y={68} textAnchor="end" fontFamily={F.mono} fontSize={12} fill={P.slate}>
      {number}
    </text>
    <text x={28} y={110} fontFamily={F.mono} fontSize={11} fill={P.slate} letterSpacing={1}>
      FROM
    </text>
    <text x={28} y={128} fontFamily={F.body} fontSize={14} fontWeight={600} fill={P.ink}>
      {from}
    </text>
    <text x={28} y={156} fontFamily={F.mono} fontSize={11} fill={P.slate} letterSpacing={1}>
      BILL TO
    </text>
    <text x={28} y={174} fontFamily={F.body} fontSize={14} fontWeight={600} fill={P.ink}>
      {to}
    </text>
    <rect x={28} y={200} width={284} height={1.5} fill={P.line} />
    <text x={28} y={228} fontFamily={F.body} fontSize={14} fill={P.ink}>
      {item}
    </text>
    {[252, 274].map((y, i) => (
      <rect key={y} x={28} y={y} width={i ? 120 : 180} height={6} rx={3} fill={P.line} />
    ))}
    <rect x={28} y={304} width={284} height={1.5} fill={P.line} />
    <text x={28} y={328} fontFamily={F.mono} fontSize={11} fill={P.slate} letterSpacing={1}>
      TOTAL · {terms.toUpperCase()}
    </text>
    <text x={28} y={360} fontFamily={F.display} fontSize={28} fontWeight={700} fill={P.ink}>
      {amount}
    </text>
    <rect x={28} y={378} width={284} height={34} rx={8} fill={P.mist} />
    <text x={40} y={400} fontFamily={F.mono} fontSize={11} fill={P.slate}>
      Payment due on delivery + 60 days
    </text>
    {stamp ? <Stamp text={stamp} color={stampColor} at={stampAt} x={200} y={250} /> : null}
  </svg>
);

export type BLStatus = "ISSUED" | "BOUND" | "SURRENDERED";

const BL_STATUS: Record<BLStatus, { bg: string; fg: string }> = {
  ISSUED: { bg: P.signal, fg: P.ink },
  BOUND: { bg: P.white, fg: P.ink },
  SURRENDERED: { bg: P.verified, fg: P.white },
};

/**
 * Electronic bill of lading as a token card. Status pill swaps with a quick flip when the
 * status prop changes over time (pass `statusAt` = frame of the latest change).
 */
export const BLToken: React.FC<{
  width?: number;
  status?: BLStatus;
  statusAt?: number;
  holder?: string;
  holderRole?: string;
  tokenId?: string;
  vessel?: string;
  route?: string;
  /** Document fingerprint shown under the title. */
  fingerprint?: string;
  shipper?: string;
  consignee?: string;
  /** Possession history rows (oldest first). The last row types on from `historyAt`. */
  history?: string[];
  historyAt?: number;
  style?: React.CSSProperties;
}> = ({
  width = 380,
  status = "ISSUED",
  statusAt,
  holder = "Meera · Exporter",
  holderRole = "HOLDER",
  tokenId = "CFEBL #12",
  vessel = "CF VEGA · V.026E",
  route = "INNSA → SGSIN",
  fingerprint = "0x3b1f…9e07",
  shipper = "Meera · Pune",
  consignee = "Wei Lin · Singapore",
  history,
  historyAt,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const flip = statusAt === undefined ? 1 : spring({ frame: frame - statusAt, fps, config: { damping: 14, stiffness: 180 } });
  const st = BL_STATUS[status];
  const hist = history ?? [];
  const extra = hist.length ? 40 + hist.length * 28 : 0;
  const lastChars = historyAt === undefined ? Infinity : Math.max(0, Math.floor((frame - historyAt) * 1.6));
  return (
    <svg width={width} viewBox={`0 0 380 ${236 + extra}`} style={{ display: "block", overflow: "visible", ...style }}>
      <defs>
        <linearGradient id="bl-card" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={P.ink2} />
          <stop offset="1" stopColor={P.ink} />
        </linearGradient>
      </defs>
      <rect x={10} y={226 + extra} width={360} height={10} rx={5} fill={P.ink} opacity={0.1} />
      <rect x={0} y={0} width={380} height={228 + extra} rx={20} fill="url(#bl-card)" />
      <rect x={0} y={0} width={380} height={6} rx={3} fill={P.signal} opacity={0.9} />
      <text x={24} y={40} fontFamily={F.mono} fontSize={12} fontWeight={700} fill={P.signal} letterSpacing={1.5}>
        eBL · TITLE TOKEN
      </text>
      <text x={356} y={40} textAnchor="end" fontFamily={F.mono} fontSize={12} fill={P.white} opacity={0.6}>
        {tokenId}
      </text>
      <text x={24} y={78} fontFamily={F.display} fontSize={28} fontWeight={700} fill={P.white}>
        Bill of Lading
      </text>
      <text x={24} y={104} fontFamily={F.mono} fontSize={13} fill={P.white} opacity={0.65}>
        {vessel} · {route}
      </text>
      <text x={24} y={124} fontFamily={F.mono} fontSize={13} fill={P.white} opacity={0.65}>
        doc {fingerprint}
      </text>
      <rect x={24} y={144} width={332} height={1} fill={P.white} opacity={0.15} />
      <circle cx={44} cy={186} r={18} fill={P.ink3} />
      <text x={44} y={192} textAnchor="middle" fontFamily={F.display} fontSize={16} fontWeight={700} fill={P.white}>
        {holder.charAt(0)}
      </text>
      <text x={72} y={178} fontFamily={F.mono} fontSize={10} fill={P.white} opacity={0.55} letterSpacing={1}>
        {holderRole}
      </text>
      <text x={72} y={198} fontFamily={F.body} fontSize={15} fontWeight={600} fill={P.white}>
        {holder}
      </text>
      <g transform={`translate(296 186) scale(1 ${Math.max(0.05, flip)})`}>
        <rect x={-58} y={-17} width={116} height={34} rx={17} fill={st.bg} />
        <text x={0} y={5} textAnchor="middle" fontFamily={F.mono} fontSize={12} fontWeight={700} fill={st.fg} letterSpacing={1}>
          {status}
        </text>
      </g>
      {hist.length ? (
        <g transform="translate(24 236)">
          <text x={0} y={0} fontFamily={F.mono} fontSize={10} fill={P.white} opacity={0.55} letterSpacing={1}>
            POSSESSION HISTORY · {shipper.split(" ·")[0].toUpperCase()} → {consignee.split(" ·")[0].toUpperCase()}
          </text>
          {hist.map((h, i) => {
            const last = i === hist.length - 1;
            const text = last ? h.slice(0, lastChars) : h;
            return (
              <g key={h} transform={`translate(0 ${22 + i * 28})`}>
                <circle cx={6} cy={-4} r={5} fill={last ? P.signal : P.inkSoft} />
                {i < hist.length - 1 ? <rect x={5} y={1} width={2} height={22} fill={P.inkSoft} /> : null}
                <text x={22} y={1} fontFamily={F.body} fontSize={15} fill={P.white} opacity={last ? 1 : 0.75}>
                  {text}
                </text>
              </g>
            );
          })}
        </g>
      ) : null}
    </svg>
  );
};

export type Holder = { name: string; role: string; status?: BLStatus };

/**
 * The eBL moving between holders: a row of holder chips with the card travelling to the
 * current holder. `position` is a float index (animate 0 → 1 → 2 …); each holder may carry the
 * status the token has while they hold it.
 */
export const BLHandoff: React.FC<{ holders: Holder[]; position: number; width?: number; cardWidth?: number }> = ({ holders, position, width = 1400, cardWidth = 300 }) => {
  const n = holders.length;
  const step = width / n;
  const idx = Math.max(0, Math.min(n - 1, Math.round(position)));
  const cardX = step * position + step / 2 - cardWidth / 2;
  const lift = Math.sin((position % 1) * Math.PI) * -40;
  return (
    <div style={{ position: "relative", width, height: cardWidth * 0.62 + 170 }}>
      {holders.map((h, i) => {
        const active = i === idx;
        return (
          <div key={h.name} style={{ position: "absolute", left: step * i, width: step, bottom: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div style={{ width: 64, height: 64, borderRadius: 32, background: active ? P.ink : P.white, color: active ? P.signal : P.ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.display, fontWeight: 700, fontSize: 26, border: `2px solid ${active ? P.ink : P.line}` }}>
              {h.name.charAt(0)}
            </div>
            <div style={{ fontFamily: F.body, fontWeight: 600, fontSize: 20, color: P.ink }}>{h.name}</div>
            <div style={{ fontFamily: F.mono, fontSize: 14, color: P.slate }}>{h.role}</div>
          </div>
        );
      })}
      {holders.slice(1).map((h, i) => (
        <div key={`a${h.name}`} style={{ position: "absolute", left: step * (i + 1) - 24, bottom: 76, width: 48, height: 2, background: P.line }} />
      ))}
      <div style={{ position: "absolute", left: cardX, top: 0 + lift + 10 }}>
        <BLToken width={cardWidth} status={holders[idx].status ?? "BOUND"} holder={`${holders[idx].name} · ${holders[idx].role}`} />
      </div>
    </div>
  );
};

/**
 * "The bank finances the paperwork, not the container": a growing pile of documents with
 * stamps and a paper clip. Sheets drop in one by one from `revealAt`.
 */
export const PaperworkStack: React.FC<{ width?: number; sheets?: number; revealAt?: number; style?: React.CSSProperties }> = ({ width = 420, sheets = 8, revealAt, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titles = ["LETTER OF CREDIT", "BILL OF LADING", "PACKING LIST", "CERT. OF ORIGIN", "INSURANCE CERT.", "INVOICE", "INSPECTION REPORT", "DRAFT · 3/3"];
  const stamps = [
    { t: "PENDING", c: P.slate },
    { t: "COPY", c: P.ink3 },
    { t: "ORIGINAL", c: P.ink3 },
  ];
  return (
    <svg width={width} viewBox="0 0 420 420" style={{ display: "block", overflow: "visible", ...style }}>
      <ellipse cx={210} cy={402} rx={170} ry={12} fill={P.ink} opacity={0.08} />
      {Array.from({ length: sheets }).map((_, i) => {
        const k = revealAt === undefined ? 1 : spring({ frame: frame - revealAt - i * 5, fps, config: { damping: 15, stiffness: 150 } });
        const rot = (hash(i * 3.1) - 0.5) * 14;
        const dx = (hash(i * 7.7) - 0.5) * 40;
        const y = 120 - i * 8 - (1 - k) * 160;
        const top = i === sheets - 1;
        return (
          <g key={i} transform={`translate(${210 + dx} ${y + 130}) rotate(${rot})`} opacity={Math.min(1, k * 2)}>
            <rect x={-130} y={-160} width={260} height={320} rx={8} fill={i % 2 ? P.white : P.whiteShade} />
            <rect x={-130} y={-160} width={260} height={320} rx={8} fill="none" stroke={P.line} strokeWidth={2} />
            {top ? (
              <g>
                <text x={-104} y={-120} fontFamily={F.mono} fontSize={14} fontWeight={700} fill={P.ink} letterSpacing={1}>
                  {titles[i % titles.length]}
                </text>
                {[-92, -72, -52, -32, -12, 8, 28].map((yy, j) => (
                  <rect key={yy} x={-104} y={yy} width={j % 3 === 2 ? 120 : 200} height={6} rx={3} fill={P.line} />
                ))}
                <path d="M-104 100 q20 -26 40 0 t40 0" stroke={P.ink3} strokeWidth={3} fill="none" strokeLinecap="round" />
                <rect x={-104} y={112} width={100} height={2} fill={P.line} />
              </g>
            ) : null}
          </g>
        );
      })}
      {/* stamps on top */}
      {stamps.map((s, j) => {
        const at = revealAt === undefined ? undefined : revealAt + sheets * 5 + j * 8;
        return <Stamp key={s.t} text={s.t} color={s.c} at={at} x={[290, 130, 280][j]} y={[150, 250, 336][j]} rotate={[-14, 8, -6][j]} />;
      })}
      {/* paper clip */}
      <path d="M300 64 v-34 a12 12 0 0 1 24 0 v46 a7 7 0 0 1 -14 0 v-38" stroke={P.slate} strokeWidth={5} fill="none" strokeLinecap="round" />
    </svg>
  );
};

/** Animated hand-off arrow helper used by sheets and scenes. */
export const progressAlong = (frame: number, start: number, end: number) => interpolate(frame, [start, end], [0, 1], { ...clamp, easing: EASE_IN_OUT });
