import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { PortCrane } from "../assets/Crane";
import { BLToken } from "../assets/Documents";
import { P } from "../assets/palette";
import { ReeferContainer } from "../assets/Reefer";
import { BarFlow, TrancheVault, USDGBar, Waterfall } from "../assets/Vault";
import { cameraAt, PORTS } from "../maps";
import { F } from "../theme";
import { Actor, At, Cam, IN_OUT_CUBIC, OnLine, Stage, StatusPill, clamp, env, leanIn } from "./kit";
import { CAM_WIDE, Inset, MapBand, RefTag, T, pips } from "./S05Set";
import { beats } from "./timing";

const VAULT = { x: 840, y: 80, w: 240 };

export const S05fSettlement: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = beats("S05f");
  const confirms = at("c054", "confirms");
  const pays = at("c054", "pays");
  const payment = at("c055", "payment");
  const daniel = at("c055", "Daniel");
  const fee = at("c055", "fee");
  const meera = at("c056", "Meera");
  const hands = at("c057", "hands");
  const documents = at("c059", "Documents");

  // phase 1: arrival + delivery
  const progress = interpolate(frame, [0, 60], [T.m4 - 0.08, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const camera = cameraAt(frame, [
    { f: 0, cam: { ...CAM_WIDE, lon: 92 } },
    { f: 30, cam: { ...CAM_WIDE, lon: 92 } },
    { f: 80, cam: { lon: 102.6, lat: 2.4, zoom: 3.0 } },
  ]);
  const m4 = progress >= T.m4;
  const m5 = progress >= 0.998;
  const phase1 = env(frame, 0, pays + 10, 12);
  const phase2 = env(frame, pays + 4, undefined, 12);
  const crane = interpolate(frame, [10, 70], [0.35, 0.62], clamp);

  // phase 2: one payment, one transaction
  const split = interpolate(frame, [payment - 6, payment + 20], [0, 1], clamp);
  const travel = interpolate(frame, [daniel - 6, meera + 10], [0, 1], clamp);
  const residualHome = frame >= meera + 12;
  const cardT = interpolate(frame, [hands - 6, hands + 24], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const cardFrom = { x: VAULT.x + VAULT.w, y: VAULT.y + 160 };
  const cardTo = { x: 1270, y: 480 };
  const card = { x: cardFrom.x + (cardTo.x - cardFrom.x) * cardT, y: cardFrom.y + (cardTo.y - cardFrom.y) * cardT };
  const vaultOut = interpolate(frame, [documents - 30, documents - 10], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const lean = leanIn(frame, documents - 6, 60, 1.06);
  const carrierK = spring({ frame: frame - (hands + 8), fps, config: { damping: 18 } }) - spring({ frame: frame - (documents - 6), fps, config: { damping: 20 } });

  return (
    <Stage tone="paper">
      {phase1 > 0.01 ? (
        <AbsoluteFill style={{ opacity: phase1 }}>
          <MapBand height={440} camera={camera} progress={progress} milestones={pips(1, [true, true, true, m4, m5])} colorStops={[{ at: 0, color: P.verified }]} places={[{ center: PORTS.singapore.ll, km: 100, state: m5 ? "met" : "active" }]} />
          {/* Singapore quay */}
          <div style={{ position: "absolute", left: 0, top: 960, width: 1920, height: 120, background: P.paperShade }} />
          <At x={1080} y={960} anchor="bl">
            <PortCrane width={520} at={crane} animate={false} />
          </At>
          <At x={1120} y={958} anchor="bl" style={{ opacity: interpolate(frame, [60, 66], [0, 1], clamp) }}>
            <ReeferContainer view="side" width={460} temp={4.6} status="ok" />
          </At>
          <Actor who="weilin" x={760} y={1080} h={460} crop="waist" pose="hold" prop="tablet" expression={frame >= confirms ? "relieved" : "focused"} look={0.8} />
          <At x={1700} y={640} anchor="tc" style={{ opacity: env(frame, 16, undefined, 10) }}>
            <StatusPill text={frame >= confirms + 6 ? "Delivered · 4.6 °C" : "M4 · M5 released"} tone="verified" size={22} />
          </At>
        </AbsoluteFill>
      ) : null}

      {phase2 > 0.01 ? (
        <AbsoluteFill style={{ opacity: phase2 }}>
          <Cam scale={lean} ox={760} oy={560}>
            <At x={VAULT.x} y={VAULT.y} style={{ opacity: 1 - vaultOut }}>
              <TrancheVault width={VAULT.w} drawers={["released", "released", "released", "released", "released"]} titleBound={cardT <= 0} />
            </At>
            {/* the single payment rises into the vault, then splits */}
            <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
              <BarFlow path={[{ x: 960, y: 760 }, { x: 960, y: 420 }, { x: 960, y: 330 }]} start={pays + 8} duration={22} amount="100,000" barW={170} />
            </svg>
            <At x={460} y={430} style={{ opacity: interpolate(frame, [pays + 26, pays + 34], [0, 1], clamp) }}>
              <Waterfall width={1000} split={split} travel={travel} />
            </At>
            {residualHome ? (
              <At x={180} y={560} style={{ opacity: interpolate(frame, [meera + 12, meera + 20], [0, 1], clamp) }}>
                <USDGBar width={230} amount="58,800" fill="flow" />
              </At>
            ) : null}
            {residualHome ? (
              <At x={1520} y={560} style={{ opacity: interpolate(frame, [meera + 12, meera + 20], [0, 1], clamp) * (1 - vaultOut) }}>
                <USDGBar width={230} amount="41,200" fill="emerald" />
              </At>
            ) : null}

            {/* eBL title card: out of the vault, to Wei Lin, in the same transaction */}
            {cardT > 0 ? (
              <At x={card.x} y={card.y} anchor="center" style={{ transform: `translate(-50%,-50%) scale(${0.55 + 0.45 * cardT})` }}>
                <BLToken width={330} status={cardT >= 1 ? "SURRENDERED" : "BOUND"} holder={cardT >= 1 ? "Wei Lin · Buyer" : "Escrow · controller"} history={["Issued to Meera", "Bound into escrow", "Released to Wei Lin"]} historyAt={hands + 26} />
              </At>
            ) : null}

            <Actor who="meera" x={260} y={1080} h={440} crop="waist" pose="hold" prop="tablet" expression={residualHome ? "happy" : "focused"} look={0.6} />
            <Actor who="weilin" x={1180} y={1080} h={420} crop="waist" pose={frame >= pays && frame < pays + 30 ? "stand" : "hold"} gesture={frame >= pays && frame < pays + 30 ? "present" : "none"} gestureAt={pays} gestureEnd={pays + 30} prop={cardT >= 1 ? "none" : "tablet"} expression={cardT >= 1 ? "happy" : "neutral"} look={-0.4} />
            <Actor who="daniel" x={1700} y={1080} h={440} crop="waist" pose="hold" prop="phone" gesture={frame >= fee && frame < hands ? "thumbsUp" : "none"} gestureAt={fee + 4} gestureEnd={hands - 6} expression={frame >= fee ? "confident" : "focused"} look={-0.6} />
          </Cam>

          <At x={40} y={60} style={{ opacity: Math.max(0, carrierK) }}>
            <Inset who="carrier" size={150} k={Math.max(0, carrierK)} label="Carrier · issued it" expression="confident" />
          </At>
          <At x={960} y={110} anchor="tc">
            <OnLine text="Documents against payment" keyword="against" size={76} k={env(frame, documents + 4, undefined, 14)} />
          </At>
          <At x={960} y={206} anchor="tc" style={{ opacity: env(frame, documents + 12, undefined, 12) }}>
            <div style={{ fontFamily: F.body, fontWeight: 500, fontSize: 20, color: P.slate, whiteSpace: "nowrap" }}>Designed around MLETR concepts; not a legal compliance claim.</div>
          </At>
        </AbsoluteFill>
      ) : null}
      <RefTag />
    </Stage>
  );
};
