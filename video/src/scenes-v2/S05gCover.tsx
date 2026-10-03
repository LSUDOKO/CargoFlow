import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { P } from "../assets/palette";
import { BarFlow, BarStack, TrancheVault } from "../assets/Vault";
import { F } from "../theme";
import { Actor, At, CornerTag, Grade, IN_OUT_CUBIC, Stage, Stamp, StatusPill, clamp, env } from "./kit";
import { LedgerMini, RefTag } from "./S05Set";
import { beats } from "./timing";

const FLOOR = 1000;
const VAULT = { x: 1420, y: 400, w: 340 };

/** Padlock with a mono label. */
const Padlock: React.FC<{ k: number; label?: string }> = ({ k, label = "no role" }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, opacity: Math.min(1, k * 1.5), transform: `scale(${0.7 + 0.3 * k})` }}>
    <svg width={64} height={74} viewBox="-32 -40 64 74">
      <path d="M-16 -6 V-18 a16 16 0 0 1 32 0 V-6" stroke={P.ink} strokeWidth={7} fill="none" strokeLinecap="round" />
      <rect x={-26} y={-8} width={52} height={40} rx={9} fill={P.ink} />
      <circle cx={0} cy={9} r={6} fill={P.white} />
    </svg>
    <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 18, color: P.ink, background: P.white, borderRadius: 999, padding: "4px 12px", border: `2px solid ${P.ink}` }}>{label}</span>
  </div>
);

export const S05gCover: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = beats("S05g");
  const insurer = at("c060", "insurer");
  const cover = at("c060", "cover");
  const parametric = at("c061", "Parametric");
  const failed = at("c061", "failed");
  const proven = at("c062", "proven");
  const arbiter = at("c063", "arbiter");
  const resolves = at("c063", "resolves");
  const never = at("c064", "never");
  const release = at("c064", "release");

  const end = 495;
  const desat = interpolate(frame, [0, 10, end, end + 12], [0, 0.2, 0.2, 0], clamp);
  const insurerIn = interpolate(frame, [insurer - 16, insurer + 6], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const phase12 = env(frame, 0, arbiter - 14, 12);
  const phase3 = env(frame, arbiter - 8, undefined, 12);
  const pay = proven + 6;
  const stack = frame >= pay + 26 ? 4 : 2;
  const arbIn = interpolate(frame, [arbiter - 10, arbiter + 10], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const lockK = spring({ frame: frame - (never + 4), fps, config: { damping: 14 } });

  return (
    <Stage tone="paper">
      <Grade desat={desat}>
        <div style={{ position: "absolute", left: 0, top: FLOOR, width: 1920, height: 3, background: P.ink, opacity: 0.14 }} />

        {/* phases 1-2: default cover and parametric cover */}
        <div style={{ position: "absolute", inset: 0, opacity: phase12 }}>
          <Actor who="meera" x={170} y={1080} h={400} crop="waist" pose="hold" prop="tablet" expression={frame >= pay + 20 ? "relieved" : "worried"} look={0.7} />
          <Actor who="insurer" x={720 - (1 - insurerIn) * 300} y={FLOOR} h={620} pose="stand" prop="umbrella" flip expression="focused" look={-0.7} opacity={insurerIn} />
          <Actor who="daniel" x={1000} y={FLOOR} h={620} pose="hold" prop="phone" expression={frame >= pay + 20 ? "relieved" : "focused"} look={-0.6} />
          <At x={1080} y={FLOOR - 6} anchor="bl">
            <BarStack count={stack} amount="8,000" width={170} label="drawn principal" />
          </At>
          <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
            <BarFlow path={[{ x: 1040, y: 760 }, { x: 900, y: 700 }, { x: 760, y: 760 }]} start={cover + 8} duration={18} amount="premium" barW={90} />
            <BarFlow path={[{ x: 960, y: 400 }, { x: 1100, y: 560 }, { x: 1160, y: 860 }]} start={pay} duration={22} count={2} gap={6} barW={120} />
            <BarFlow path={[{ x: 860, y: 400 }, { x: 500, y: 560 }, { x: 230, y: 760 }]} start={pay + 14} duration={22} amount="salvage" barW={100} />
          </svg>
          <At x={1180} y={170} style={{ opacity: env(frame, parametric - 4, undefined, 10) }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <LedgerMini
                width={600}
                visible={3}
                title="committed epochs · in order"
                rows={[
                  { block: 18402124, call: "commitEpoch", note: "failed", hash: "0x1d0e…88a2", at: parametric, tone: "danger" },
                  { block: 18402125, call: "commitEpoch", note: "failed", hash: "0x6b3c…e019", at: parametric + 8, tone: "danger" },
                  { block: 18402126, call: "commitEpoch", note: "failed", hash: "0x0f9a…4c77", at: parametric + 16, tone: "danger" },
                ]}
              />
              <div style={{ opacity: env(frame, failed, undefined, 10), display: "flex", alignItems: "center", gap: 10 }}>
                <svg width={22} height={150} viewBox="0 0 22 150">
                  <path d="M2 4 H14 V146 H2" stroke={P.ink} strokeWidth={3} fill="none" />
                </svg>
                <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 28, color: P.ink }}>N = 3</span>
              </div>
            </div>
            <div style={{ marginTop: 14, opacity: env(frame, failed + 16, undefined, 10) }}>
              <StatusPill text="✓ commit order verified" tone="verified" size={18} />
            </div>
          </At>
          <At x={1180} y={500} style={{ opacity: env(frame, proven, undefined, 10) }}>
            <div style={{ fontFamily: F.mono, fontSize: 16, color: P.slate }}>proven from the evidence on chain · illustrative N</div>
          </At>
        </div>

        {/* phase 3: the arbiter */}
        <div style={{ position: "absolute", inset: 0, opacity: phase3 }}>
          <At x={VAULT.x} y={VAULT.y}>
            <TrancheVault width={VAULT.w} drawers={["released", "released", "filled", "filled", "filled"]} titleBound />
          </At>
          <At x={VAULT.x + VAULT.w / 2 - 10} y={VAULT.y + 150} anchor="center">
            <Padlock k={lockK} />
          </At>
          <Actor who="arbiter" x={1130 - (1 - arbIn) * 200} y={FLOOR} h={760} pose={frame >= release - 4 ? "stand" : "hips"} gesture={frame >= release - 4 ? "present" : "none"} gestureAt={release - 4} expression={frame >= never ? "confident" : "neutral"} look={0.6} opacity={arbIn} />
          <At x={420} y={470} style={{ transform: "scale(1.3)", transformOrigin: "0 0" }}>
            <div style={{ width: 330, padding: "20px 22px", borderRadius: 16, background: P.white, boxShadow: "0 18px 36px -24px rgba(11,27,43,0.4)", position: "relative" }}>
              <div style={{ fontFamily: F.mono, fontSize: 13, letterSpacing: 1, color: P.slate }}>DISPUTE · CF-2026-SG01</div>
              {[84, 70, 58].map((w, i) => (
                <div key={i} style={{ marginTop: 12, height: 8, width: `${w}%`, borderRadius: 4, background: P.line }} />
              ))}
              <div style={{ position: "absolute", right: 18, bottom: 16 }}>
                <Stamp text="RESOLVED" at={resolves + 6} size={26} rotate={-8} />
              </div>
            </div>
          </At>
        </div>
      </Grade>

      <CornerTag text="what if" side="tl" tone="ink" at={2} out={end} />
      <RefTag />
      <At x={960} y={92} anchor="tc" style={{ opacity: env(frame, insurer - 8, parametric - 8, 10) }}>
        <StatusPill text="Default cover · pays min(cover, drawn principal)" tone="outline-ink" size={24} />
      </At>
      <At x={960} y={92} anchor="tc" style={{ opacity: env(frame, parametric, arbiter - 10, 10) }}>
        <StatusPill text="Parametric · N failed epochs in a row → principal to Daniel + salvage to Meera" tone="outline-ink" size={22} />
      </At>
      <At x={960} y={92} anchor="tc" style={{ opacity: env(frame, arbiter, undefined, 10) }}>
        <StatusPill text="Dispute role · resolve, resume or default · no release" tone="outline-ink" size={24} />
      </At>
    </Stage>
  );
};
