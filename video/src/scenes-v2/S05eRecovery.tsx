import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { EpochTray, ProofEnvelope } from "../assets/Mechanisms";
import { P } from "../assets/palette";
import { NotificationCard } from "../assets/Story";
import { BarFlow, TrancheVault } from "../assets/Vault";
import { Actor, At, IN_OUT_CUBIC, OUT, SHADOW, Stage, StatusPill, clamp, env } from "./kit";
import { COLOMBO, LedgerMini, MapBand, RefTag, T, pips, vaultDrawer } from "./S05Set";
import { beats } from "./timing";

const P2_FRESH = [4.6, 4.5, 4.6, 4.7, 4.6, 4.6, 4.5, 4.6];
const VAULT = { x: 1600, y: 560, w: 250 };

export const S05eRecovery: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = beats("S05e");
  const once = at("c048", "Once");
  const proves = at("c049", "proves");
  const zero = at("c049", "zero");
  const meera = at("c051", "Meera");
  const notification = at("c051", "notification");
  const signs = at("c051", "signs");
  const contract = at("c052", "The");
  const proof = at("c052", "proof");
  const releases = at("c053", "Releases");

  const fill = interpolate(frame, [once + 4, once + 70], [0, 8], clamp);
  const flip = interpolate(frame, [proves - 2, proves + 10], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const trayOut = interpolate(frame, [proves + 12, proves + 30], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const envFill = interpolate(frame, [proves + 14, proves + 40], [0, 1], clamp);
  const seal = interpolate(frame, [proves + 42, proves + 56], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const stamp = spring({ frame: frame - (zero - 4), fps, config: { damping: 11, stiffness: 220 } });
  const travel = interpolate(frame, [contract - 4, contract + 20], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const verified = spring({ frame: frame - proof, fps, config: { damping: 13, stiffness: 170 } });
  const active = frame >= releases;
  const envPos = { x: 600 + (1020 - 600) * travel, y: 470 + (500 - 470) * travel };
  const envScale = 1 - travel * 0.55;
  const latch = interpolate(frame, [releases, releases + 12], [1, 0], { ...clamp, easing: OUT });
  const d3 = vaultDrawer(VAULT.x, VAULT.y, VAULT.w, 2);
  const meeraK = env(frame, meera - 10, undefined, 14);

  return (
    <Stage tone="paper">
      <MapBand
        top={90}
        height={260}
        camera={{ lon: 80.9, lat: 6.3, zoom: 2.2 }}
        progress={T.excursion + 0.004}
        milestones={pips(1, [true, true, active, false, false], false)}
        colorStops={[
          { at: 0, color: P.verified },
          { at: T.excursion - 0.011, color: P.danger },
        ]}
        places={[{ center: COLOMBO, km: 50, state: active ? "met" : "held" }]}
        shipStatus={active ? "ok" : "paused"}
        shipLabel={active ? "ACTIVE" : "PAUSED"}
        scaleBar={false}
      />
      <div style={{ position: "absolute", left: 0, top: 90, width: 1920, height: 260, boxShadow: "inset 0 1px 0 rgba(11,27,43,0.08)" }} />
      <RefTag />

      {/* probe-2 refills its epoch; probe-1 stays empty and greyed */}
      <At x={60} y={392} style={{ opacity: 1 - trayOut, transform: `scale(${0.82 - trayOut * 0.1})`, transformOrigin: "0 0" }}>
        <EpochTray width={1300} rows={[{ sensor: "probe-1", values: [0, 0, 0, 0, 0, 0, 0, 0] }, { sensor: "probe-2", values: P2_FRESH }]} filled={[0, fill]} dimRow={0} dots flip={flip} />
      </At>
      <At x={70} y={370} anchor="bl" style={{ opacity: env(frame, once + 10, proves - 4, 10) }}>
        <StatusPill text="probe-2 · 8 fresh readings · in band" tone="ink" size={20} />
      </At>

      {/* the proof envelope */}
      <At x={envPos.x} y={envPos.y} style={{ opacity: env(frame, proves + 8, undefined, 10), transform: `scale(${envScale})`, transformOrigin: "0 0" }}>
        <ProofEnvelope width={400} fill={envFill} seal={seal} stamp={stamp} verified={verified} bracket={frame >= zero + 6} />
      </At>
      <At x={800} y={900} anchor="tc" style={{ opacity: env(frame, proves + 40, contract - 6, 10) }}>
        <StatusPill text="Groth16 · readings never revealed" tone="ink" size={22} />
      </At>

      {/* Meera signs from the notification */}
      <Actor who="meera" x={300} y={1080} h={470} crop="waist" pose="hold" prop="phone" expression={frame >= signs + 6 ? "relieved" : "determined"} prevExpression="determined" expressionAt={signs + 6} look={0.6} opacity={meeraK} />
      <At x={1080} y={430} style={{ opacity: 1 - interpolate(frame, [contract - 8, contract], [0, 1], clamp) }}>
        {frame >= notification - 8 ? <NotificationCard at={notification - 8} channelsAt={notification + 4} pressedAt={signs} width={440} /> : null}
      </At>

      {/* contract checks the proof, releases resume */}
      <At x={1010} y={470} style={{ opacity: env(frame, contract - 2, undefined, 10) }}>
        <LedgerMini
          width={540}
          visible={2}
          rows={[
            { block: 18402121, call: "pauseFinancing", note: "score 48", hash: "", at: -40, tone: "alert" },
            { block: 18402130, call: "resumeWithProof", note: "Groth16", hash: "0xc582…1a82", at: contract, tickAt: proof, tone: "verified" },
          ]}
        />
      </At>
      <At x={1280} y={640} anchor="tc" style={{ opacity: env(frame, proof + 4, undefined, 10) }}>
        <StatusPill text="Proof verified on chain" tone="verified" size={22} />
      </At>

      <At x={VAULT.x} y={VAULT.y}>
        <TrancheVault width={VAULT.w} drawers={["released", "released", active && frame > releases + 24 ? "released" : "filled", "filled", "filled"]} open={{ 2: interpolate(frame, [releases + 6, releases + 14, releases + 30, releases + 38], [0, 1, 1, 0], clamp) }} latch={latch} titleBound />
      </At>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <BarFlow path={[{ x: d3.x - 40, y: d3.y }, { x: 1000, y: 760 }, { x: 420, y: 860 }]} start={releases + 10} duration={20} barW={110} />
      </svg>
      <At x={1725} y={880} anchor="tc" style={{ opacity: env(frame, releases + 4, undefined, 10) }}>
        <StatusPill text="ACTIVE" tone="verified" size={22} style={{ boxShadow: SHADOW }} />
      </At>
    </Stage>
  );
};
