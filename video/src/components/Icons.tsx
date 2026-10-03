import React from "react";
import { C, F } from "../theme";

const S = {
  stroke: C.ink,
  strokeWidth: 4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Side view of a reefer container with its refrigeration unit and a data logger. */
export const Reefer: React.FC<{
  width: number;
  body?: string;
  ribs?: string;
  stroke?: string;
  question?: number; // 0..1 shows a question mark over it
  ledColor?: string;
}> = ({
  width,
  body = C.paper,
  ribs = C.line,
  stroke = C.ink,
  question = 0,
  ledColor = C.verified,
}) => (
  <svg
    width={width}
    viewBox="0 0 400 200"
    style={{ display: "block", overflow: "visible" }}
  >
    <rect
      x="6"
      y="20"
      width="388"
      height="164"
      rx="8"
      fill={body}
      stroke={stroke}
      strokeWidth={4}
    />
    {Array.from({ length: 15 }).map((_, i) => (
      <path
        key={i}
        d={`M${72 + i * 21} 32v140`}
        stroke={ribs}
        strokeWidth={6}
      />
    ))}
    {/* reefer unit on the end wall */}
    <rect
      x="16"
      y="32"
      width="46"
      height="140"
      rx="5"
      fill={C.ink2}
      stroke={stroke}
      strokeWidth={4}
    />
    <circle
      cx="39"
      cy="66"
      r="13"
      fill={C.ink3}
      stroke={C.paper}
      strokeOpacity={0.25}
      strokeWidth={2}
    />
    <rect x="24" y="104" width="30" height="16" rx="3" fill={C.ink} />
    <circle cx="39" cy="140" r="4.5" fill={ledColor} />
    {/* logger */}
    <rect
      x="300"
      y="70"
      width="40"
      height="52"
      rx="8"
      fill={C.ink2}
      stroke={stroke}
      strokeWidth={3}
    />
    <rect x="308" y="80" width="24" height="14" rx="3" fill={C.signal} />
    <path d="M6 184h388" stroke={stroke} strokeWidth={4} />
    {question > 0 && (
      <g
        opacity={question}
        transform={`translate(200 102) scale(${0.6 + 0.4 * question}) translate(-200 -102)`}
      >
        <circle cx="200" cy="102" r="56" fill={C.ink} />
        <text
          x="200"
          y="128"
          textAnchor="middle"
          fontFamily={F.display}
          fontWeight={700}
          fontSize="78"
          fill={C.signal}
        >
          ?
        </text>
      </g>
    )}
  </svg>
);

export const Coin: React.FC<{
  size: number;
  color?: string;
  style?: React.CSSProperties;
}> = ({ size, color = C.signal, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 40 40"
    style={{ display: "block", ...style }}
  >
    <circle cx="20" cy="20" r="17" fill={color} {...S} strokeWidth={3} />
    <circle
      cx="20"
      cy="20"
      r="10.5"
      fill="none"
      stroke={C.ink}
      strokeOpacity={0.35}
      strokeWidth={2}
    />
    <text
      x="20"
      y="25.5"
      textAnchor="middle"
      fontFamily={F.display}
      fontWeight={700}
      fontSize="15"
      fill={C.ink}
    >
      $
    </text>
  </svg>
);

/** Sealed proof: envelope under a shield with a check. `seal` 0..1 draws the check. */
export const ProofSeal: React.FC<{ size: number; seal?: number }> = ({
  size,
  seal = 1,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 120 120"
    style={{ display: "block", overflow: "visible" }}
  >
    <rect x="8" y="44" width="76" height="56" rx="8" fill={C.paper} {...S} />
    <path d="M8 50l38 28 38-28" fill="none" {...S} />
    <circle cx="46" cy="84" r="8" fill={C.alert} {...S} strokeWidth={3} />
    <path
      d="M82 14l30 10v26c0 22-14 36-30 42-16-6-30-20-30-42V24z"
      fill={C.ink2}
      {...S}
    />
    <path
      d="M69 50l9 9 17-20"
      fill="none"
      stroke={C.signal}
      strokeWidth={7}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={40}
      strokeDashoffset={40 * (1 - seal)}
    />
  </svg>
);

export const Lock: React.FC<{ size: number; color?: string }> = ({
  size,
  color = C.alert,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 40 40"
    style={{ display: "block" }}
  >
    <path
      d="M12 18v-5a8 8 0 0116 0v5"
      fill="none"
      stroke={C.ink}
      strokeWidth={3.5}
      strokeLinecap="round"
    />
    <rect
      x="8"
      y="18"
      width="24"
      height="18"
      rx="4"
      fill={color}
      stroke={C.ink}
      strokeWidth={3.5}
    />
    <circle cx="20" cy="27" r="2.6" fill={C.ink} />
  </svg>
);

export const Check: React.FC<{
  size: number;
  color?: string;
  bg?: string;
  draw?: number;
}> = ({ size, color = C.ink, bg = C.verified, draw = 1 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 40 40"
    style={{ display: "block" }}
  >
    <circle cx="20" cy="20" r="18" fill={bg} />
    <path
      d="M12 20.5l5.5 5.5L28.5 14"
      fill="none"
      stroke={color}
      strokeWidth={4}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={26}
      strokeDashoffset={26 * (1 - draw)}
    />
  </svg>
);

/** Minimal party glyphs for the flow diagram. */
export const PartyGlyph: React.FC<{
  kind: "exporter" | "financier" | "buyer";
  size: number;
}> = ({ kind, size }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    style={{ display: "block" }}
  >
    {kind === "exporter" && (
      <>
        <path
          d="M6 40V22l10 6v-6l10 6v-6l10 6V10h6v30z"
          fill={C.signal}
          {...S}
          strokeWidth={3}
        />
        <path
          d="M12 34h4M22 34h4M32 34h4"
          stroke={C.ink}
          strokeWidth={3}
          strokeLinecap="round"
        />
      </>
    )}
    {kind === "financier" && (
      <>
        <path d="M24 6L6 15h36z" fill={C.signal} {...S} strokeWidth={3} />
        <path
          d="M10 19v14M19 19v14M29 19v14M38 19v14"
          stroke={C.ink}
          strokeWidth={3.5}
          strokeLinecap="round"
        />
        <path
          d="M6 38h36"
          stroke={C.ink}
          strokeWidth={4}
          strokeLinecap="round"
        />
      </>
    )}
    {kind === "buyer" && (
      <>
        <path d="M8 18l3-9h26l3 9z" fill={C.signal} {...S} strokeWidth={3} />
        <rect
          x="9"
          y="18"
          width="30"
          height="22"
          rx="2"
          fill={C.paper}
          {...S}
          strokeWidth={3}
        />
        <rect x="20" y="28" width="8" height="12" fill={C.ink} />
      </>
    )}
  </svg>
);
