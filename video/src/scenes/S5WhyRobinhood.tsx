import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { InkBg } from "../components/Backgrounds";
import { Check } from "../components/Icons";
import { Eyebrow, Mark, Pill, Reveal, useRise } from "../components/ui";
import { C, F } from "../theme";
import { prog } from "../lib/anim";
import { CONTRACTS, short } from "../data/contracts";
import { BLOCK_INTERVAL, CHAIN_ID, FEE_PER_TX_ETH } from "../data/facts";

// 2:45–3:05 · 600 frames

const Reason: React.FC<{
  delay: number;
  n: string;
  title: string;
  children: React.ReactNode;
}> = ({ delay, n, title, children }) => {
  const rise = useRise(delay, 30);
  return (
    <div style={{ display: "flex", gap: 26, ...rise }}>
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 22,
          color: C.signal,
          paddingTop: 8,
          width: 40,
        }}
      >
        {n}
      </div>
      <div>
        <div
          style={{
            fontFamily: F.display,
            fontWeight: 700,
            fontSize: 44,
            letterSpacing: "-0.03em",
            color: C.paper,
          }}
        >
          {title}
        </div>
        <div style={{ marginTop: 12 }}>{children}</div>
      </div>
    </div>
  );
};

const FlowChips: React.FC<{ delay: number }> = ({ delay }) => {
  const frame = useCurrentFrame();
  const steps = ["Escrow", "Tranches", "Settlement"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      {steps.map((s, i) => {
        const p = prog(frame, delay + 10 + i * 12, delay + 26 + i * 12);
        return (
          <React.Fragment key={s}>
            {i > 0 && (
              <svg width={44} height={20} style={{ opacity: p }}>
                <path
                  d="M2 10h34M28 3l8 7-8 7"
                  fill="none"
                  stroke={C.signal}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            <span
              style={{
                opacity: p,
                padding: "10px 18px",
                borderRadius: 12,
                background: "rgba(247,249,244,0.08)",
                boxShadow: "inset 0 0 0 1.5px rgba(247,249,244,0.14)",
                fontFamily: F.body,
                fontWeight: 600,
                fontSize: 26,
                color: C.paper,
              }}
            >
              {s}{" "}
              <span
                style={{ fontFamily: F.mono, color: C.signal, fontWeight: 500 }}
              >
                USDG
              </span>
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
};

const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      fontFamily: F.body,
      fontSize: 28,
      color: "rgba(247,249,244,0.72)",
      lineHeight: 1.4,
    }}
  >
    {children}
  </div>
);

export const S5WhyRobinhood: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <InkBg grid />
      <div style={{ position: "absolute", left: 120, top: 96, width: 960 }}>
        <Reveal delay={4}>
          <Eyebrow onDark>Why Robinhood Chain</Eyebrow>
        </Reveal>
        <div
          style={{
            fontFamily: F.display,
            fontWeight: 700,
            fontSize: 84,
            lineHeight: 1.02,
            letterSpacing: "-0.045em",
            color: C.paper,
            marginTop: 20,
          }}
        >
          <Reveal delay={8}>Real settlement money,</Reveal>
          <Reveal delay={14}>on a chain built for it.</Reveal>
        </div>
        <div
          style={{
            display: "flex",
            gap: 14,
            marginTop: 30,
            ...useRise(30, 16),
          }}
        >
          <Pill tone="verified" onDark size={24}>
            Robinhood Chain Testnet · {CHAIN_ID}
          </Pill>
          <Pill tone="slate" onDark size={24} dot={false}>
            Paxos USDG · 6 decimals
          </Pill>
        </div>
        <div style={{ display: "grid", gap: 30, marginTop: 52 }}>
          <Reason delay={70} n="01" title="USDG carries every dollar">
            <FlowChips delay={150} />
            <div style={{ marginTop: 12 }}>
              <Sub>
                Issued by Paxos Digital Singapore, where Meera&apos;s cargo
                lands.
              </Sub>
            </div>
          </Reason>
          <Reason
            delay={300}
            n="02"
            title={`${FEE_PER_TX_ETH} per transaction`}
          >
            <Sub>
              {BLOCK_INTERVAL} average block interval · measured on testnet, 2
              Oct 2026
            </Sub>
          </Reason>
          <Reason delay={420} n="03" title="7 contracts, source-verified">
            <Sub>Immutable core, no proxy. Every address on the explorer.</Sub>
          </Reason>
        </div>
      </div>

      {/* contract addresses */}
      <div style={{ position: "absolute", left: 1150, top: 130, width: 650 }}>
        <Eyebrow onDark style={{ opacity: prog(frame, 80, 96) }}>
          Deployed · chain {CHAIN_ID}
        </Eyebrow>
        <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
          {CONTRACTS.map((c, i) => {
            const d = 90 + i * 12;
            const p = prog(frame, d, d + 20);
            return (
              <div
                key={c.address}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "15px 20px",
                  borderRadius: 16,
                  background:
                    i === 0
                      ? "rgba(198,244,50,0.12)"
                      : "rgba(247,249,244,0.06)",
                  boxShadow:
                    i === 0
                      ? "inset 0 0 0 1.5px rgba(198,244,50,0.5)"
                      : "inset 0 0 0 1.5px rgba(247,249,244,0.1)",
                  opacity: p,
                  translate: `${(1 - p) * 40}px 0`,
                }}
              >
                <Check size={28} draw={prog(frame, d + 10, d + 26)} />
                <span
                  style={{
                    fontFamily: F.body,
                    fontWeight: 600,
                    fontSize: 25,
                    color: C.paper,
                    flex: 1,
                  }}
                >
                  {c.name}
                </span>
                <span
                  style={{
                    fontFamily: F.mono,
                    fontSize: 23,
                    color: i === 0 ? C.signal : "rgba(247,249,244,0.8)",
                  }}
                >
                  {short(c.address, 8, 6)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* hackathon fit */}
      <div
        style={{
          position: "absolute",
          left: 1150,
          top: 790,
          width: 680,
          lineHeight: 1.15,
          fontFamily: F.display,
          fontWeight: 700,
          fontSize: 46,
          letterSpacing: "-0.035em",
          color: C.paper,
        }}
      >
        <Reveal delay={470} duration={24}>
          Hackathon fit:
        </Reveal>
        <Reveal delay={480} duration={24}>
          <Mark delay={505} onDark>
            USDG integrated end to end.
          </Mark>
        </Reveal>
      </div>
    </AbsoluteFill>
  );
};
