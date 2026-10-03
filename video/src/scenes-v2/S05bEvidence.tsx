import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { DataLogger } from "../assets/Devices";
import { ConflictGauge, DeviceBadges, EpochTray, FusionMeter, ReadingCardG, ScoreDial } from "../assets/Mechanisms";
import { P } from "../assets/palette";
import { ReeferContainer } from "../assets/Reefer";
import { F } from "../theme";
import { At, IN_OUT_CUBIC, Label, OUT, OnLine, Stage, StatusPill, clamp, env } from "./kit";
import { Inset, LedgerMini, RefTag } from "./S05Set";
import { beats } from "./timing";

const P1 = [4.6, 4.7, 4.6, 4.8, 4.7, 4.9, 4.8, 5.0];
const P2 = [4.5, 4.6, 4.6, 4.7, 4.6, 4.8, 4.7, 4.8];

/** Postgres drawer: the raw signed readings stay here, off chain. */
const PostgresDrawer: React.FC<{ fill: number; shut: number }> = ({ fill, shut }) => (
  <div style={{ width: 300, height: 170, borderRadius: 16, background: P.ink2, padding: 14, boxSizing: "border-box", position: "relative" }}>
    <div style={{ fontFamily: F.mono, fontSize: 13, color: P.white, opacity: 0.8, letterSpacing: 1 }}>POSTGRES · OFF CHAIN</div>
    <div style={{ position: "absolute", left: 14, right: 14, bottom: 14, height: 100, borderRadius: 10, background: P.ink, overflow: "hidden" }}>
      {Array.from({ length: Math.round(16 * fill) }).map((_, i) => (
        <div key={i} style={{ position: "absolute", left: 12 + (i % 8) * 31, top: 12 + Math.floor(i / 8) * 40, width: 26, height: 32, borderRadius: 5, background: i % 2 ? P.ink3 : P.inkSoft }} />
      ))}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${shut * 100}%`, background: P.inkSoft, borderRight: `3px solid ${P.slate}` }} />
    </div>
  </div>
);

export const S05bEvidence: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = beats("S05b");
  const logger = at("c033", "logger");
  const device = at("c033", "device");
  const eight = at("c034", "Eight");
  const fuses = at("c035", "fuses");
  const scores = at("c036", "scores");
  const hundred = at("c036", "hundred");
  const only = at("c037", "Only");
  const fingerprint = at("c037", "fingerprint");

  // phase A: logger signs readings
  const phaseA = env(frame, 0, eight - 14, 12);
  const sigBeat = 10 + Math.floor(Math.max(0, frame - 10) / 14) * 14;
  const nCards = Math.min(8, Math.max(0, Math.floor((frame - 14) / 14) + 1));

  // phase B -> C: the tray
  const trayIn = interpolate(frame, [eight - 10, eight + 6], [0, 1], { ...clamp, easing: OUT });
  const fillN = interpolate(frame, [eight, eight + 64], [0, 8], clamp);
  const toC = interpolate(frame, [fuses - 12, fuses + 12], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const trayScale = 1 - toC * 0.36;
  const trayX = interpolate(toC, [0, 1], [310, 70]);
  const trayY = interpolate(toC, [0, 1], [330, 150]);
  const flip = interpolate(frame, [only, only + 12], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const compress = interpolate(frame, [only + 14, only + 44], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });

  // fusion columns resolve to "fine" one by one; conflict needle low
  const steps = Array.from({ length: 8 }, (_, i) => {
    const k = interpolate(frame, [fuses + i * 5, fuses + i * 5 + 14], [0, 1], { ...clamp, easing: OUT });
    return { fine: 0.02 + 0.9 * k, violated: 0.01 * k, unknown: 1 - 0.91 * k };
  });
  const cK = env(frame, fuses - 4, only + 4, 14);
  const dialK = env(frame, scores - 6, undefined, 12);
  const insetK = spring({ frame: frame - (scores - 20), fps, config: { damping: 18 } });

  return (
    <Stage tone="paper">
      <RefTag />

      {/* phase A */}
      {phaseA > 0.01 ? (
        <AbsoluteFill style={{ opacity: phaseA }}>
          <At x={60} y={170}>
            <ReeferContainer view="cutaway" width={1080} probes={[4.6, 4.5]} temp={4.6} pulse="slow" />
          </At>
          <At x={1190} y={150}>
            <DataLogger width={210} value={4.6} signAt={sigBeat} beepAt={sigBeat} id="logger" />
          </At>
          <div style={{ position: "absolute", left: 1460, top: 126, fontFamily: F.mono, fontSize: 15, letterSpacing: 1, color: P.slate }}>SIGNED READINGS</div>
          {Array.from({ length: nCards }).map((_, i) => {
            const born = 14 + i * 14;
            const k = interpolate(frame, [born, born + 8], [0, 1], { ...clamp, easing: OUT });
            const x = 1460 + (i % 2) * 210;
            const y = 160 + Math.floor(i / 2) * 100;
            return (
              <svg key={i} width={140} height={80} viewBox="-8 -8 136 80" style={{ position: "absolute", left: 1300 + (x - 1300) * k, top: 300 + (y - 300) * k, opacity: k, overflow: "visible", transform: "scale(1.2)", transformOrigin: "0 0" }}>
                <ReadingCardG value={i % 2 ? P2[i >> 1] : P1[i >> 1]} sensor={i % 2 ? "probe-2" : "probe-1"} time={`14:${String((i >> 1) * 2).padStart(2, "0")}`} />
                <g transform="translate(118 -6)">
                  <rect x={-22} y={-10} width={40} height={20} rx={10} fill={P.ink} />
                  <text x={-2} y={4} textAnchor="middle" fontFamily={F.mono} fontSize={11} fontWeight={700} fill={P.signal}>
                    sig
                  </text>
                </g>
              </svg>
            );
          })}
          <At x={60} y={640} style={{ transform: "scale(1.25)", transformOrigin: "0 0" }}>
            <DeviceBadges active="software key" at={logger - 4} />
          </At>
          <At x={64} y={756} style={{ opacity: env(frame, device, undefined, 10) }}>
            <Label size={18} color={P.slate}>
              device key · reliability weight (this logger: software key)
            </Label>
          </At>
        </AbsoluteFill>
      ) : null}

      {/* the epoch tray */}
      {trayIn > 0.01 ? (
        <At x={trayX} y={trayY} style={{ opacity: trayIn, transform: `scale(${trayScale})`, transformOrigin: "0 0" }}>
          <EpochTray width={1300} rows={[{ sensor: "probe-1", values: P1 }, { sensor: "probe-2", values: P2 }]} filled={[Math.min(8, fillN * 1.1), Math.max(0, fillN * 1.1 - 0.8)]} flip={flip} compress={compress} root="0x7e79…40c6" />
        </At>
      ) : null}
      <At x={960} y={650} anchor="tc" style={{ opacity: env(frame, eight + 8, fuses - 12, 10) }}>
        <StatusPill text="8 readings × 2 probes = 1 epoch" tone="ink" size={26} />
      </At>

      {/* fusion, conflict, score */}
      {cK > 0.01 ? (
        <AbsoluteFill style={{ opacity: cK }}>
          <At x={1040} y={170}>
            <FusionMeter steps={steps} width={520} height={180} label="fusion · two probes, per time step" />
          </At>
          <At x={1600} y={150}>
            <ConflictGauge value={0.017} start={fuses + 30} width={250} />
          </At>
        </AbsoluteFill>
      ) : null}
      <At x={150} y={480} style={{ opacity: dialK }}>
        <ScoreDial start={scores} width={640} />
      </At>

      {/* commitment: root + score on chain, readings to Postgres */}
      <At x={1040} y={150} style={{ opacity: env(frame, only + 10, undefined, 12) }}>
        <PostgresDrawer fill={interpolate(frame, [only + 14, only + 44], [0, 1], clamp)} shut={interpolate(frame, [only + 50, only + 64], [0, 1], { ...clamp, easing: IN_OUT_CUBIC })} />
      </At>
      <At x={1040} y={360} style={{ opacity: env(frame, fingerprint + 8, undefined, 12) }}>
        <LedgerMini width={600} visible={1} rows={[{ block: 18402117, call: "commitEpoch", note: "root · score 100", hash: "0x7e79…40c6", at: fingerprint + 10, tickAt: fingerprint + 34, tone: "verified" }]} />
      </At>
      <At x={1040} y={470} w={600}>
        <OnLine text="Readings stay off chain. Root + score go on." keyword="Root + score" size={42} maxWidth={600} k={env(frame, only + 30, undefined, 14)} />
      </At>

      <At x={1640} y={640}>
        <Inset who="meera" size={200} k={insetK} label="Meera" expression={frame >= hundred + 4 ? "relieved" : "focused"} prevExpression="focused" expressionAt={hundred + 4} />
      </At>
    </Stage>
  );
};
