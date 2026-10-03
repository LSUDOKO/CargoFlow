import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { KenBurns, Vignette } from "../components/Backgrounds";
import { Check } from "../components/Icons";
import { Mark, Pill, Reveal } from "../components/ui";
import { C, F } from "../theme";
import { lerp, prog } from "../lib/anim";

// 0:00–0:08 · 240 frames
const READINGS = [
  { at: 0, v: 5.2 },
  { at: 90, v: 6.8 },
  { at: 150, v: 6.8 },
  { at: 198, v: 6.8 },
];
const SPARK = [4.6, 4.7, 4.6, 4.7, 4.8, 4.9, 5.0, 5.1, 5.2, 6.1, 6.8];

export const S0ColdOpen: React.FC = () => {
  const frame = useCurrentFrame();
  const current =
    [...READINGS].reverse().find((r) => frame >= r.at) ?? READINGS[0];
  const tickPulse = 1 - prog(frame, current.at, current.at + 12);
  const card = prog(frame, 8, 40);
  const sparkDraw = lerp(frame, [20, 220], [0, 1]);

  const sx = (i: number) => (i / (SPARK.length - 1)) * 360;
  const sy = (v: number) => 78 - ((v - 4) / 4) * 64; // 4 °C at the bottom, 8 °C limit at y=14
  const path = SPARK.map(
    (v, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`,
  ).join(" ");

  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <KenBurns
        src="assets/port-night.webp"
        from={[1.08, 4, 0]}
        to={[1.3, 7, -3]}
        dim={0.12}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(11,27,43,0.85) 0%, rgba(11,27,43,0.35) 40%, rgba(11,27,43,0) 65%), linear-gradient(0deg, rgba(11,27,43,0.8) 0%, rgba(11,27,43,0) 40%)",
        }}
      />
      <Vignette strength={0.6} />

      {/* location stamp */}
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 96,
          fontFamily: F.mono,
          fontSize: 22,
          letterSpacing: "0.12em",
          color: "rgba(247,249,244,0.6)",
          opacity: prog(frame, 4, 30),
        }}
      >
        02:14 UTC · IN TRANSIT · REEFER 2041
      </div>

      {/* reefer readout */}
      <div
        style={{
          position: "absolute",
          right: 120,
          top: 150,
          width: 460,
          padding: "30px 34px 28px",
          borderRadius: 24,
          background: "rgba(11,27,43,0.72)",
          boxShadow:
            "inset 0 0 0 1.5px rgba(247,249,244,0.12), 0 40px 80px -30px rgba(0,0,0,0.7)",
          backdropFilter: "blur(10px)",
          opacity: card,
          translate: `0 ${(1 - card) * 30}px`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 18,
              letterSpacing: "0.16em",
              color: "rgba(247,249,244,0.6)",
            }}
          >
            SUPPLY AIR · REEFER 2041
          </div>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: 99,
              background: C.verified,
              opacity: 0.5 + 0.5 * Math.abs(Math.sin(frame / 9)),
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            marginTop: 14,
          }}
        >
          <span
            style={{
              fontFamily: F.mono,
              fontWeight: 500,
              fontSize: 132,
              lineHeight: 1,
              letterSpacing: "-0.04em",
              color: C.paper,
              translate: `0 ${tickPulse * -6}px`,
              textShadow: `0 0 ${tickPulse * 30}px rgba(198,244,50,0.6)`,
            }}
          >
            {current.v.toFixed(1)}
          </span>
          <span
            style={{
              fontFamily: F.mono,
              fontSize: 48,
              color: "rgba(247,249,244,0.7)",
            }}
          >
            °C
          </span>
        </div>
        <svg
          width={392}
          height={84}
          viewBox="-6 0 372 84"
          style={{ marginTop: 10, display: "block" }}
        >
          <path
            d="M0 14 H310"
            stroke={C.alert}
            strokeOpacity={0.5}
            strokeWidth={2}
            strokeDasharray="6 8"
          />
          <text
            x="360"
            y="20"
            textAnchor="end"
            fontFamily={F.mono}
            fontSize="17"
            fill={C.alert}
            fillOpacity={0.8}
          >
            8 °C
          </text>
          <path
            d={path}
            fill="none"
            stroke={C.signal}
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - sparkDraw}
          />
        </svg>
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 18,
            color: "rgba(247,249,244,0.5)",
            marginTop: 6,
          }}
        >
          band 2–8 °C · 1 reading / 30 s
        </div>
      </div>

      {/* what the money sees: a calm, green financing portal */}
      <div
        style={{
          position: "absolute",
          right: 120,
          top: 540,
          width: 460,
          padding: "24px 28px",
          borderRadius: 24,
          background: C.paper,
          boxShadow: "0 40px 80px -30px rgba(0,0,0,0.7)",
          opacity: prog(frame, 141, 151),
          translate: `0 ${(1 - prog(frame, 141, 160)) * 24}px`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 17,
              letterSpacing: "0.14em",
              color: C.slate,
            }}
          >
            FINANCING PORTAL
          </div>
          <Pill tone="verified" size={18}>
            In transit
          </Pill>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginTop: 18,
          }}
        >
          <Check size={40} draw={prog(frame, 150, 164)} />
          <div
            style={{
              fontFamily: F.display,
              fontWeight: 700,
              fontSize: 34,
              letterSpacing: "-0.02em",
              color: C.ink,
            }}
          >
            All documents OK
          </div>
        </div>
      </div>

      {/* statement */}
      <div
        style={{
          position: "absolute",
          left: 120,
          bottom: 190,
          width: 1200,
          fontFamily: F.display,
          fontWeight: 700,
          letterSpacing: "-0.035em",
          color: C.paper,
        }}
      >
        <Reveal
          delay={14}
          duration={26}
          style={{
            fontSize: 64,
            fontWeight: 500,
            color: "rgba(247,249,244,0.82)",
          }}
        >
          A container of vaccines.{" "}
          <span style={{ color: C.signal, fontVariantNumeric: "tabular-nums", fontFamily: F.mono, letterSpacing: "-0.02em" }}>
            6.8°C
          </span>
          , and climbing.
        </Reveal>
        <Reveal
          delay={138}
          duration={24}
          style={{ fontSize: 104, lineHeight: 1.05, marginTop: 18 }}
        >
          The money behind it{" "}
          <Mark delay={168} onDark>
            can&apos;t see it.
          </Mark>
        </Reveal>
      </div>
    </AbsoluteFill>
  );
};
