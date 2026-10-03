import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { P } from "../assets/palette";
import { F } from "../theme";
import { DemoShell, ShotSpec } from "./DemoShell";
import { IN_OUT_CUBIC, OUT, clamp, env } from "./kit";
import { beats } from "./timing";

/**
 * S10 · Proof (recording R4): the v3 run's settled dashboard, a one-second flash of the settle
 * transaction on the explorer, the /deployments list, then a designed counter grid whose numbers
 * roll up in 600 ms with a 120 ms stagger.
 */

export const S10_SHOTS: ShotSpec[] = [
  { shot: "R4-01", from: 0, frames: 141, url: "cargoflow.adoranto737.workers.dev/track/0xc57490f8…f9e5", punches: [{ from: 30, to: 128, scale: 1.4, cx: 0.4, cy: 0.3, label: "CF-LIVE-1791029236301 · Settled" }] },
  { shot: "R4-02", from: 141, frames: 36, url: "explorer.testnet.chain.robinhood.com/tx/0x37571b49…4e365a35", title: "Robinhood Chain explorer" },
  { shot: "R4-03", from: 177, frames: 123, url: "cargoflow.adoranto737.workers.dev/deployments" },
];

const COUNTERS = [
  { n: 366, label: "contract tests", big: true },
  { n: 25, label: "circuit" },
  { n: 245, label: "frontend unit" },
  { n: 18, label: "end-to-end" },
];

const Hash: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <span style={{ display: "inline-flex", gap: 8, padding: "7px 14px", borderRadius: 999, background: P.white, border: `1px solid ${P.line}`, fontFamily: F.mono, fontSize: 15, color: P.ink }}>
    <span style={{ color: P.slate }}>{k}</span>
    {v}
  </span>
);

export const S10Proof: React.FC = () => {
  const frame = useCurrentFrame();
  const at = beats("S10");
  const grid = at("c096", "Three") - 3;
  const gridK = interpolate(frame, [grid - 8, grid + 6], [0, 1], { ...clamp, easing: OUT });

  return (
    <AbsoluteFill>
      <DemoShell
        shots={S10_SHOTS}
        overlays={[
          { text: "CF-LIVE-1791029236301 · settled", from: 12, to: 172 },
          { text: "10 contracts · source-verified", from: at("c095", "Ten"), to: 300 },
        ]}
      >
        <div style={{ position: "absolute", left: 960, top: 20, transform: "translateX(-50%)", display: "flex", gap: 10, opacity: env(frame, 18, 172, 10) }}>
          <Hash k="proof" v="0xadfe3b2f…1f503a9f52" />
          <Hash k="paid" v="0x37571b49…cf4e365a35" />
        </div>
      </DemoShell>

      {gridK > 0.001 ? (
        <AbsoluteFill style={{ background: `rgba(247,249,244,${0.96 * gridK})`, alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", gap: 28, alignItems: "stretch", opacity: gridK }}>
            {COUNTERS.map((c, i) => {
              const t = interpolate(frame, [grid + i * 4, grid + i * 4 + 18], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
              return (
                <div key={c.label} style={{ width: c.big ? 420 : 280, padding: "30px 32px", borderRadius: 26, background: c.big ? P.ink : P.white, border: c.big ? "none" : `1px solid ${P.line}`, boxShadow: "0 24px 48px -30px rgba(11,27,43,0.35)" }}>
                  <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: c.big ? 120 : 92, lineHeight: 1, color: c.big ? P.signal : P.ink, letterSpacing: -3 }}>{Math.round(c.n * t)}</div>
                  <div style={{ marginTop: 12, fontFamily: F.body, fontWeight: 500, fontSize: 24, color: c.big ? "rgba(255,255,255,0.8)" : P.slate }}>{c.label}</div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 30, fontFamily: F.mono, fontSize: 24, color: P.ink, opacity: env(frame, grid + 14, undefined, 10) }}>SDK 92 · MCP 27 · gateway 36 · Python 25</div>
        </AbsoluteFill>
      ) : null}
      <div style={{ position: "absolute", left: 40, top: 28, width: 190, fontFamily: F.body, fontWeight: 500, fontSize: 15, lineHeight: 1.35, color: "rgba(11,27,43,0.6)", pointerEvents: "none" }}>Testnet only · not audited · testnet USDG has no value</div>
    </AbsoluteFill>
  );
};
