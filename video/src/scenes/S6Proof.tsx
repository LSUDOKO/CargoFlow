import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { PaperBg } from "../components/Backgrounds";
import {
  Card,
  Eyebrow,
  HashPill,
  Mark,
  Pill,
  Reveal,
  useRise,
} from "../components/ui";
import { C, F } from "../theme";
import { lerp, prog } from "../lib/anim";
import { short } from "../data/contracts";
import {
  BROWSER_E2E_TESTS,
  CIRCUIT_TESTS,
  CONTRACT_TESTS,
  FRONTEND_UNIT_TESTS,
  LIVE_SHIPMENT,
  LIVE_TX,
  TESTNET_TRAIL_TXS,
} from "../data/facts";

// 3:05–3:15 · 300 frames. The settled shipment first (VO "It's live…"), then the counters.

const COUNTERS = [
  {
    n: CONTRACT_TESTS,
    label: "contract tests",
    sub: "unit · fuzz · invariants",
  },
  { n: CIRCUIT_TESTS, label: "circuit tests", sub: "incl. tamper cases" },
  { n: FRONTEND_UNIT_TESTS, label: "frontend unit", sub: "components + lib" },
  {
    n: BROWSER_E2E_TESTS,
    label: "end-to-end",
    sub: "browser, real wallets",
  },
  {
    n: TESTNET_TRAIL_TXS,
    label: "testnet txs",
    sub: "one shipment's trail",
  },
];

const COUNT_START = 140;

const Counter: React.FC<{
  i: number;
  n: number;
  label: string;
  sub: string;
}> = ({ i, n, label, sub }) => {
  const frame = useCurrentFrame();
  const d = COUNT_START + i * 4;
  const v = Math.round(lerp(frame, [d, d + 22], [0, n]));
  const rise = useRise(d, 30, 18);
  return (
    <Card style={{ width: 306, height: 270, padding: "34px 32px", ...rise }}>
      <div
        style={{
          fontFamily: F.mono,
          fontWeight: 500,
          fontSize: 100,
          letterSpacing: "-0.06em",
          lineHeight: 1,
          color: C.ink,
        }}
      >
        {v}
      </div>
      <div
        style={{
          fontFamily: F.display,
          fontWeight: 700,
          fontSize: 29,
          letterSpacing: "-0.02em",
          color: C.ink,
          marginTop: 24,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: F.body,
          fontSize: 20,
          color: C.slate,
          marginTop: 6,
        }}
      >
        {sub}
      </div>
    </Card>
  );
};

export const S6Proof: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <PaperBg />
      <div style={{ position: "absolute", left: 120, top: 110, width: 1680 }}>
        <Reveal delay={0} duration={16}>
          <Eyebrow>Proof · live on Robinhood Chain Testnet</Eyebrow>
        </Reveal>
        <div
          style={{
            fontFamily: F.display,
            fontWeight: 700,
            fontSize: 84,
            letterSpacing: "-0.045em",
            color: C.ink,
            marginTop: 14,
          }}
        >
          <Reveal delay={4} duration={20}>
            A shipment settled <Mark delay={28}>end to end.</Mark>
          </Reveal>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            marginTop: 34,
            ...useRise(16, 20),
          }}
        >
          <Pill tone="ink" size={24}>
            Settled
          </Pill>
          <span style={{ fontFamily: F.mono, fontSize: 26, color: C.ink }}>
            {LIVE_SHIPMENT}
          </span>
          <span style={{ fontFamily: F.body, fontSize: 24, color: C.slate }}>
            · every step signed by its party&apos;s own wallet
          </span>
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 22 }}>
          {LIVE_TX.map((t, i) => (
            <div
              key={t.hash}
              style={{
                opacity: prog(frame, 30 + i * 10, 48 + i * 10),
                translate: `0 ${(1 - prog(frame, 30 + i * 10, 48 + i * 10)) * 12}px`,
              }}
            >
              <HashPill
                label={t.label}
                value={short(t.hash, 10, 4)}
                size={24}
              />
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 530,
          display: "flex",
          gap: 37,
        }}
      >
        {COUNTERS.map((c, i) => (
          <Counter key={c.label} i={i} {...c} />
        ))}
      </div>
    </AbsoluteFill>
  );
};
