import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Gauge } from "../assets/Data";
import { P } from "../assets/palette";
import { BarFlow, DrawerState, TrancheVault } from "../assets/Vault";
import { cameraAt } from "../maps";
import { F } from "../theme";
import { Actor, At, IN_OUT_CUBIC, Stage, StatusPill, clamp, env } from "./kit";
import { CAM_WIDE, COLOMBO, LedgerMini, MapBand, RefTag, T, pips, vaultDrawer } from "./S05Set";
import { beats } from "./timing";

const VAULT = { x: 830, y: 596, w: 300 };

export const S05cRelease: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = beats("S05c");
  const pass = at("c038", "Pass");
  const tranche = at("c039", "tranche");
  const wrong = at("c040", "Wrong");
  const waits = at("c040", "waits");
  const humidity = at("c041", "Humidity");

  const rel1 = pass + 6;
  const rel2 = tranche - 4;
  const progress = interpolate(frame, [0, rel1 + 30, rel2, rel2 + 30, wrong + 10], [T.m1, T.m1 + 0.03, T.m2 - 0.004, T.m2 + 0.01, T.hold412], { ...clamp, easing: IN_OUT_CUBIC });
  const camera = cameraAt(frame, [
    { f: 0, cam: CAM_WIDE },
    { f: wrong - 14, cam: CAM_WIDE },
    { f: wrong + 22, cam: { lon: 77.6, lat: 7.9, zoom: 2.4 } },
  ]);
  const m1 = frame >= rel1 + 16;
  const m2 = frame >= rel2 + 12;
  const held = frame >= wrong + 12;
  const drawers: DrawerState[] = [m1 ? "released" : "filled", m2 ? "released" : "filled", held ? "held" : "filled", "filled", "filled"];
  const open = {
    0: interpolate(frame, [rel1, rel1 + 8, rel1 + 30, rel1 + 40], [0, 1, 1, 0], clamp),
    1: interpolate(frame, [rel2, rel2 + 6, rel2 + 20, rel2 + 28], [0, 1, 1, 0], clamp),
  };
  const d1 = vaultDrawer(VAULT.x, VAULT.y, VAULT.w, 0);
  const d2 = vaultDrawer(VAULT.x, VAULT.y, VAULT.w, 1);
  const thumbs = frame >= rel1 + 22 && frame < wrong;
  const gK = spring({ frame: frame - humidity, fps, config: { damping: 18 } });

  return (
    <Stage tone="paper">
      <MapBand
        camera={camera}
        progress={progress}
        milestones={pips(1, [m1, m2, false, false, false])}
        colorStops={[{ at: 0, color: P.verified }]}
        places={[{ center: COLOMBO, km: 50, state: held ? "held" : "active", label: "M3 · within 50 km of Colombo", distance: "412 km away" }]}
      />
      <RefTag />

      <Actor who="meera" x={300} y={1080} h={440} crop="waist" pose="hold" prop="tablet" gesture={thumbs ? "thumbsUp" : "none"} gestureAt={rel1 + 22} gestureEnd={wrong - 8} expression={held ? "focused" : m1 ? "happy" : "focused"} look={0.6} />

      <At x={VAULT.x} y={VAULT.y}>
        <TrancheVault width={VAULT.w} drawers={drawers} open={open} titleBound />
      </At>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <BarFlow path={[{ x: d1.x - 60, y: d1.y }, { x: 600, y: d1.y - 30 }, { x: 420, y: 820 }]} start={rel1 + 6} duration={20} barW={110} />
        <BarFlow path={[{ x: d2.x - 60, y: d2.y }, { x: 600, y: d2.y - 30 }, { x: 420, y: 820 }]} start={rel2 + 4} duration={12} barW={110} />
      </svg>
      <At x={980} y={572} anchor="bc" style={{ opacity: env(frame, rel1 + 8, wrong - 6, 10) }}>
        <StatusPill text={m2 ? "M1 · M2 released · 8,000 USDG each" : "M1 released · 8,000 USDG"} tone="verified" size={20} />
      </At>

      <At x={1220} y={604}>
        <LedgerMini
          width={620}
          visible={3}
          rows={[
            { block: 18402117, call: "commitEpoch", note: "score 100", hash: "0x7e79…40c6", at: -20, tickAt: 0, tone: "verified" },
            { block: 18402118, call: "releaseTranche", note: "M1", hash: "0x91b2…0d1e", at: rel1, tone: "verified" },
            { block: 18402119, call: "commitEpoch", note: "score 100", hash: "0x3f0a…77c2", at: rel2 - 8, tickAt: rel2 - 2, tone: "verified" },
            { block: 18402120, call: "releaseTranche", note: "M2", hash: "0xa4d8…19f3", at: rel2 + 2, tone: "verified" },
          ]}
        />
      </At>

      {/* place hold: the app's own explanation line */}
      <At x={1220} y={790} style={{ opacity: env(frame, waits, undefined, 12) }}>
        <div style={{ width: 620, padding: "16px 20px", borderRadius: 16, background: "rgba(255,176,32,0.08)", border: `2px solid ${P.alert}`, boxSizing: "border-box" }}>
          <div style={{ fontFamily: F.body, fontWeight: 600, fontSize: 21, lineHeight: 1.35, color: P.ink }}>Milestone 3 waits until the cargo is within 50 km of Colombo; it is 412 km away</div>
          <div style={{ marginTop: 6, fontFamily: F.mono, fontSize: 15, color: P.slate }}>held · not a failure, not a pause</div>
        </div>
      </At>

      {/* humidity + shock limits */}
      <At x={480} y={610} style={{ opacity: Math.min(1, gK * 1.4), transform: `translateY(${(1 - gK) * 20}px)` }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", width: 180 }}>
          <Gauge value={0.66} mode="risk" threshold={0.15} label="humidity ≤ 85%" display="66%" start={humidity} width={170} />
          <Gauge value={0.05} mode="risk" threshold={0.25} label="shock ≤ 3 g" display="0.2 g" start={humidity + 6} width={170} />
        </div>
      </At>
    </Stage>
  );
};
