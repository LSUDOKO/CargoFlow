import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ConflictGauge, EpochTray, FusionMeter, Ratchet, ScoreDial } from "../assets/Mechanisms";
import { P } from "../assets/palette";
import { ReeferContainer } from "../assets/Reefer";
import { TrancheVault } from "../assets/Vault";
import { F } from "../theme";
import { At, IN_OUT_CUBIC, OUT, Stage, StatusPill, clamp, env } from "./kit";
import { COLOMBO, Inset, LedgerMini, MapBand, RefTag, T, pips } from "./S05Set";
import { beats } from "./timing";

const READINGS = [5.2, 6.8, 8.9, 10.4, 11.7];
const P1_ROW = [4.7, 4.8, 4.9, 5.2, 6.8, 8.9, 10.4, 11.7];
const P2_ROW = [4.5, 4.6, 4.6, 4.7, 4.6, 4.6, 4.7, 4.6];
const BAND = 460;

export const S05dExcursion: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = beats("S05d");
  const off = at("c042", "Off");
  const climbs = at("c042", "climbs");
  const eleven = at("c042", "eleven");
  const probe2 = at("c043", "Probe");
  const disagree = at("c044", "sensors");
  const falls = at("c044", "falls");
  const pauses = at("c045", "pauses");
  const monitor = at("c046", "An");
  const stricter = at("c046", "stricter");
  const never = at("c047", "Never");

  // probe-1 climbs through the five demo readings (one every ~20 f), red from 8.9
  const step = Math.max(0, Math.min(4, Math.floor(interpolate(frame, [off + 4, eleven + 4], [0, 4.99], clamp))));
  const p1 = frame < off + 4 ? 5.2 : READINGS[step];
  const climbT = interpolate(frame, [off + 4, eleven + 4], [0, 1], clamp);
  const exT = T.excursion;
  const progress = interpolate(frame, [0, eleven + 10], [exT - 0.012, exT + 0.004], clamp);
  const paused = frame >= pauses;
  const phaseA = env(frame, 0, disagree - 12, 12);
  const phaseB1 = Math.min(env(frame, disagree - 6, undefined, 12), interpolate(frame, [falls - 6, falls + 6], [1, 0], clamp));
  const phaseB2 = env(frame, falls - 1, undefined, 10);
  const dialOut = interpolate(frame, [monitor - 6, monitor + 8], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });

  const steps = Array.from({ length: 8 }, (_, i) => {
    if (i < 3) return { fine: 0.92, violated: 0.01, unknown: 0.07 };
    const k = interpolate(frame, [disagree + (i - 3) * 5, disagree + (i - 3) * 5 + 12], [0, 1], { ...clamp, easing: OUT });
    return { fine: 0.92 - 0.7 * k, violated: 0.01 + 0.62 * k, unknown: 0.07 + 0.08 * k };
  });
  const insetK = spring({ frame: frame - (pauses - 6), fps, config: { damping: 18 } });

  return (
    <Stage tone="paper">
      <MapBand
        height={BAND}
        camera={{ lon: 80.6, lat: 6.6, zoom: 2.9 }}
        progress={progress}
        milestones={pips(1, [true, true, false, false, false])}
        colorStops={[
          { at: 0, color: P.verified },
          { at: exT - 0.011, color: frame >= climbs + 20 ? P.danger : P.verified },
        ]}
        places={[{ center: COLOMBO, km: 50, state: "held", label: "M3 · within 50 km of Colombo" }]}
        excursion={frame >= eleven ? { t: exT, label: "11.7 °C · probe-1" } : null}
        shipStatus={paused ? "paused" : frame >= climbs + 20 ? "excursion" : "ok"}
        shipLabel={paused ? "PAUSED" : undefined}
      />
      <RefTag />

      {/* phase A: the two probes disagree */}
      {phaseA > 0.01 ? (
        <AbsoluteFill style={{ opacity: phaseA }}>
          <At x={60} y={500}>
            <ReeferContainer
              view="cutaway"
              width={1040}
              probes={[p1, 4.6]}
              temp={p1}
              status={p1 > 8 ? "excursion" : "ok"}
              frost={[1 - climbT * 0.8, 1]}
              pulse={frame >= off ? "fast" : "slow"}
              warm={climbT * 0.25}
            />
          </At>
          <At x={1180} y={520}>
            <div style={{ fontFamily: F.mono, fontSize: 15, letterSpacing: 1, color: P.slate }}>PROBE-1 · SIGNED READINGS</div>
            <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 14, fontFamily: F.mono, fontWeight: 700, fontSize: 40 }}>
              {READINGS.slice(0, frame < off + 4 ? 1 : step + 1).map((r, i) => (
                <React.Fragment key={i}>
                  {i ? <span style={{ color: P.slate, fontSize: 28 }}>→</span> : null}
                  <span style={{ color: r > 8 ? P.danger : P.ink }}>{r.toFixed(1)}</span>
                </React.Fragment>
              ))}
              <span style={{ color: P.slate, fontSize: 26 }}>°C</span>
            </div>
            <div style={{ marginTop: 30, opacity: env(frame, probe2, undefined, 10) }}>
              <div style={{ fontFamily: F.mono, fontSize: 15, letterSpacing: 1, color: P.slate }}>PROBE-2</div>
              <div style={{ marginTop: 8, fontFamily: F.mono, fontWeight: 700, fontSize: 40, color: P.ink }}>
                4.6 <span style={{ color: P.slate, fontSize: 26 }}>°C · holds</span>
              </div>
            </div>
          </At>
        </AbsoluteFill>
      ) : null}

      {/* phase B1 ("the sensors disagree"): the epoch tray, fusion per time step, conflict */}
      {phaseB1 > 0.01 ? (
        <AbsoluteFill style={{ opacity: phaseB1 }}>
          <At x={80} y={496} style={{ transform: "scale(0.72)", transformOrigin: "0 0" }}>
            <EpochTray width={1300} rows={[{ sensor: "probe-1", values: P1_ROW }, { sensor: "probe-2", values: P2_ROW }]} filled={8} />
          </At>
          <At x={1120} y={500}>
            <FusionMeter steps={steps} width={480} height={170} label="fusion · per time step" />
          </At>
          <At x={1620} y={500}>
            <ConflictGauge value={0.748} start={disagree + 6} width={230} />
          </At>
        </AbsoluteFill>
      ) : null}

      {/* phase B2 ("the score falls to 48, and the facility pauses"; then the AI ratchet): dial -> ratchet, vault, ledger */}
      {phaseB2 > 0.01 ? (
        <AbsoluteFill style={{ opacity: phaseB2 }}>
          <At x={150} y={500} style={{ opacity: 1 - dialOut }}>
            <ScoreDial penalties={{ physical: 30, conflict: 22 }} start={falls - 4} dropAt={falls - 2} width={560} />
          </At>
          <At x={280} y={490} style={{ opacity: dialOut }}>
            <Ratchet clicks={spring({ frame: frame - (stricter - 2), fps, config: { damping: 12, stiffness: 160 } })} nudgeAt={never - 14} width={300} />
          </At>
          <At x={820} y={590} style={{ opacity: env(frame, pauses + 2, undefined, 10) }}>
            <LedgerMini width={600} visible={1} rows={[{ block: 18402121, call: "pauseFinancing", note: "score 48 · conflict 74.8%", hash: "", at: pauses + 2, tone: "alert" }]} />
          </At>
          <At x={1540} y={496}>
            <TrancheVault width={250} drawers={["released", "released", "held", "filled", "filled"]} latch={interpolate(frame, [pauses, pauses + 10], [0, 1], clamp)} titleBound />
          </At>
          <At x={1665} y={816} anchor="tc" style={{ opacity: env(frame, pauses + 4, undefined, 10) }}>
            <StatusPill text="FACILITY PAUSED" tone="alert" size={20} />
          </At>
        </AbsoluteFill>
      ) : null}

      {/* who can see it now */}
      <At x={300} y={250}>
        <div style={{ display: "flex", gap: 14 }}>
          <Inset who="meera" size={150} k={insetK} label="Meera" expression="worried" />
          <Inset who="daniel" size={150} k={spring({ frame: frame - pauses, fps, config: { damping: 18 } })} label="Daniel" expression="focused" />
        </div>
      </At>
    </Stage>
  );
};
