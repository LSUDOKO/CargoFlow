import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { InkBg, KenBurns } from "../components/Backgrounds";
import { Logo } from "../components/Logo";
import { Mark, Reveal } from "../components/ui";
import { C, F } from "../theme";
import { prog } from "../lib/anim";
import { APP_URL, REPO_URL } from "../data/facts";

// 3:15–3:25 · 300 frames

const LinkRow: React.FC<{ delay: number; kind: string; value: string }> = ({
  delay,
  kind,
  value,
}) => {
  const frame = useCurrentFrame();
  const p = prog(frame, delay, delay + 20);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "16px 24px",
        borderRadius: 16,
        background: "rgba(247,249,244,0.07)",
        boxShadow: "inset 0 0 0 1.5px rgba(247,249,244,0.14)",
        opacity: p,
        translate: `0 ${(1 - p) * 16}px`,
      }}
    >
      <span
        style={{
          fontFamily: F.mono,
          fontSize: 20,
          letterSpacing: "0.12em",
          color: "rgba(247,249,244,0.55)",
        }}
      >
        {kind}
      </span>
      <span style={{ fontFamily: F.mono, fontSize: 30, color: C.paper }}>
        {value}
      </span>
    </div>
  );
};

export const S7Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const logo = prog(frame, 8, 36);
  return (
    <AbsoluteFill>
      <InkBg />
      <AbsoluteFill style={{ opacity: 0.35 }}>
        <KenBurns
          src="assets/port-night.webp"
          from={[1.15, 0, 0]}
          to={[1.05, 0, 0]}
          dim={0.5}
          blur={6}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 60% 55% at 50% 45%, rgba(11,27,43,0.55), rgba(11,27,43,0.95))",
        }}
      />
      <AbsoluteFill style={{ alignItems: "center" }}>
        <div
          style={{
            position: "absolute",
            top: 210,
            opacity: logo,
            scale: String(0.94 + 0.06 * logo),
          }}
        >
          <Logo width={880} />
        </div>
        <div
          style={{
            position: "absolute",
            top: 520,
            fontFamily: F.display,
            fontWeight: 500,
            fontSize: 52,
            lineHeight: 1.2,
            letterSpacing: "-0.03em",
            color: C.paper,
            textAlign: "center",
          }}
        >
          <Reveal delay={36} duration={22}>
            Working capital that releases only when
          </Reveal>
          <Reveal delay={60} duration={22}>
            <Mark delay={96} onDark>
              the cargo&apos;s own evidence
            </Mark>{" "}
            says it should.
          </Reveal>
        </div>
        <div
          style={{ position: "absolute", top: 730, display: "flex", gap: 24 }}
        >
          <LinkRow delay={190} kind="LIVE" value={APP_URL} />
          <LinkRow delay={198} kind="CODE" value={REPO_URL} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
