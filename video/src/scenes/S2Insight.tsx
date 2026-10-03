import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { InkBg } from "../components/Backgrounds";
import { Beat } from "../components/Beat";
import { Logo, MARK_FRACTION } from "../components/Logo";
import { Mark, Reveal } from "../components/ui";
import { C, F } from "../theme";
import { EASE_IN_OUT, lerp, prog } from "../lib/anim";

// 0:40–0:58 · 540 frames
// 0–118 the question · 112+ logo, "one shipment, one escrow", pitch line, tranche bar (timed to captions.json)

const Question: React.FC = () => (
  <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
    <div
      style={{
        fontFamily: F.display,
        fontWeight: 700,
        fontSize: 124,
        lineHeight: 1.04,
        letterSpacing: "-0.045em",
        color: C.paper,
        textAlign: "center",
      }}
    >
      <Reveal delay={6} duration={24}>
        What if the money
      </Reveal>
      <Reveal delay={12} duration={24}>
        could{" "}
        <Mark delay={44} duration={16} onDark>
          see the cargo?
        </Mark>
      </Reveal>
    </div>
  </AbsoluteFill>
);

const LOGO_W = 1000;

/** Five tranche segments; two fill as evidence clears the policy gate. */
const Tranches: React.FC<{ start: number }> = ({ start }) => {
  const frame = useCurrentFrame();
  const appear = prog(frame, start, start + 20);
  const fills = [start + 70, start + 150];
  return (
    <div
      style={{
        opacity: appear,
        translate: `0 ${(1 - appear) * 20}px`,
        display: "flex",
        alignItems: "center",
        gap: 28,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            background: C.signal,
          }}
        />
        <span
          style={{
            fontFamily: F.mono,
            fontSize: 24,
            color: "rgba(247,249,244,0.75)",
          }}
        >
          evidence
        </span>
      </div>
      <svg width={60} height={20}>
        <path
          d="M2 10h48M42 3l8 7-8 7"
          fill="none"
          stroke={C.signal}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 24,
          color: C.ink,
          background: C.signal,
          padding: "8px 14px",
          borderRadius: 10,
        }}
      >
        policy ✓
      </div>
      <svg width={60} height={20}>
        <path
          d="M2 10h48M42 3l8 7-8 7"
          fill="none"
          stroke={C.signal}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div style={{ display: "flex", gap: 10 }}>
        {[0, 1, 2, 3, 4].map((i) => {
          const f = i < 2 ? prog(frame, fills[i], fills[i] + 18) : 0;
          return (
            <div
              key={i}
              style={{
                width: 110,
                height: 48,
                borderRadius: 12,
                background: "rgba(247,249,244,0.07)",
                boxShadow: "inset 0 0 0 1.5px rgba(247,249,244,0.16)",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: C.verified,
                  scale: `${f} 1`,
                  transformOrigin: "left",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  fontFamily: F.mono,
                  fontSize: 19,
                  fontWeight: 700,
                  color: f > 0.5 ? C.ink : "rgba(247,249,244,0.5)",
                }}
              >
                {f > 0.5 ? "released" : `T${i + 1}`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Reveal2: React.FC = () => {
  const frame = useCurrentFrame();
  const markIn = interpolate(frame, [0, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.spring({ damping: 14, mass: 0.8 }),
  });
  const wipe = lerp(frame, [24, 54], [MARK_FRACTION, 1], EASE_IN_OUT);
  // keep the visible part centred while the wordmark wipes in
  const shift = ((1 - wipe) * LOGO_W) / 2;
  // local frames: logo 0, "one shipment" 38, pitch 131, tranches 200
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div
        style={{
          position: "absolute",
          top: 170,
          translate: `${shift}px 0`,
          scale: String(0.7 + 0.3 * markIn),
          opacity: prog(frame, 0, 8),
        }}
      >
        <Logo width={LOGO_W} reveal={wipe} />
      </div>
      <div
        style={{
          position: "absolute",
          top: 500,
          width: 1600,
          textAlign: "center",
          fontFamily: F.display,
          fontWeight: 500,
          fontSize: 56,
          lineHeight: 1.18,
          letterSpacing: "-0.03em",
          color: C.paper,
        }}
      >
        <Beatless from={38} to={124}>
          <Reveal delay={38} duration={22} out={112}>
            One shipment.{" "}
            <Mark delay={60} duration={16} onDark>
              One USDG escrow.
            </Mark>
          </Reveal>
        </Beatless>
        <Beatless from={128} to={9999}>
          <Reveal delay={131} duration={24}>
            Working capital that releases only when
          </Reveal>
          <Reveal delay={138} duration={24}>
            <Mark delay={178} duration={18} onDark>
              the cargo&apos;s own evidence
            </Mark>{" "}
            says it should.
          </Reveal>
        </Beatless>
      </div>
      <div style={{ position: "absolute", top: 760 }}>
        <Tranches start={200} />
      </div>
    </AbsoluteFill>
  );
};

/** Renders children only inside [from, to) of the parent's local frame. */
const Beatless: React.FC<{
  from: number;
  to: number;
  children: React.ReactNode;
}> = ({ from, to, children }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame >= to) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
      {children}
    </div>
  );
};

export const S2Insight: React.FC = () => (
  <AbsoluteFill>
    <InkBg grid />
    <Beat from={0} duration={118} fadeIn={0} fadeOut={14} name="Question">
      <Question />
    </Beat>
    <Beat from={112} duration={460} fadeIn={0} fadeOut={0} name="Logo + pitch">
      <Reveal2 />
    </Beat>
  </AbsoluteFill>
);
