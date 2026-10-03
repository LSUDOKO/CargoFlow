import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BLToken } from "../assets/Documents";
import { PolicyCard } from "../assets/Story";
import { BarFlow, DrawerState, TrancheVault } from "../assets/Vault";
import { cameraAt } from "../maps";
import { Actor, At, IN_OUT_CUBIC, OUT, Stage, StatusPill, clamp, env } from "./kit";
import { CAM_COLOMBO, CAM_WIDE, COLOMBO, LedgerMini, MapBand, RefTag, pips, vaultDrawer, vaultSlot } from "./S05Set";
import { beats } from "./timing";

const VAULT = { x: 1270, y: 600, w: 290 };

export const S05aFacility: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = beats("S05a");
  const meera = at("c028", "Meera");
  const policy = at("c028", "policy");
  const band = at("c029", "two");
  const daniel = at("c030", "Daniel");
  const escrows = at("c030", "escrows");
  const pays = at("c031", "It");
  const optionally = at("c032", "optionally");
  const place = at("c032", "place");

  // map
  const landIn = interpolate(frame, [0, 20], [0, 1], { ...clamp, easing: OUT });
  const portsIn = [10, 16, 22].map((f) => spring({ frame: frame - f, fps, config: { damping: 12, stiffness: 170 } }));
  const routeDraw = interpolate(frame, [pays, pays + 60], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const pipShow = [0.004, 0.25, 0.5, 0.75, 0.999].map((t) => interpolate(routeDraw, [t - 0.02, t + 0.04], [0, 1], clamp));
  const camera = cameraAt(frame, [
    { f: 0, cam: CAM_WIDE },
    { f: optionally - 6, cam: CAM_WIDE },
    { f: optionally + 36, cam: CAM_COLOMBO },
  ]);
  const grow = spring({ frame: frame - place, fps, config: { damping: 14, stiffness: 140 } });

  // stage
  const danielIn = interpolate(frame, [daniel - 10, daniel + 14], [0, 1], { ...clamp, easing: OUT });
  const drawers: DrawerState[] = [0, 1, 2, 3, 4].map((i) => (frame >= escrows + i * 4 + 18 ? "filled" : "empty"));
  const labelChars = interpolate(frame, [escrows, escrows + 24], [0, 15], clamp);
  const carrierAt = escrows + 50;
  const carrierK = env(frame, carrierAt - 8, carrierAt + 40, 10);
  const cardT = interpolate(frame, [carrierAt + 8, carrierAt + 30], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const slot = vaultSlot(VAULT.x, VAULT.y, VAULT.w);
  const cardFrom = { x: 560, y: 760 };
  const card = { x: cardFrom.x + (slot.x - cardFrom.x) * cardT, y: cardFrom.y + (slot.y - cardFrom.y) * cardT - Math.sin(cardT * Math.PI) * 90 };
  const bound = frame >= carrierAt + 30;
  const policyK = env(frame, meera + 6, escrows - 10, 14);
  const bandPulse = 1 + 0.04 * Math.sin(Math.max(0, Math.min(1, (frame - band) / 14)) * Math.PI);

  return (
    <Stage tone="paper">
      <MapBand
        camera={camera}
        progress={0}
        routeDraw={routeDraw}
        landIn={landIn}
        portsIn={portsIn}
        ship={false}
        milestones={pips(pipShow, [], frame < optionally)}
        places={[{ center: COLOMBO, km: 50, grow, state: "active", label: "M3 · within 50 km of Colombo" }]}
      />
      <RefTag at={4} />

      {/* Meera + policy */}
      <Actor who="meera" x={230} y={1080} h={440} crop="waist" pose={frame < escrows ? "stand" : "hold"} gesture={frame < escrows ? "present" : "none"} gestureAt={meera} gestureEnd={escrows - 10} prop="tablet" expression={frame >= band ? "happy" : "focused"} look={0.7} />
      <At x={400} y={612} style={{ transform: `scale(${bandPulse})`, transformOrigin: "0 0" }}>
        <div style={{ opacity: policyK }}>
          <PolicyCard at={meera + 8} width={360} />
        </div>
      </At>

      {/* carrier hands the bill; it becomes the eBL title card and binds into the vault */}
      {carrierK > 0.01 ? <Actor who="carrier" x={560} y={1080} h={400} crop="waist" gesture="present" gestureAt={carrierAt} prop="bol" expression="confident" look={0.6} opacity={carrierK} /> : null}
      {frame >= carrierAt + 6 && !bound ? (
        <At x={card.x} y={card.y} anchor="center" style={{ transform: `translate(-50%,-50%) scale(${1 - cardT * 0.55})` }}>
          <BLToken width={220} status="ISSUED" holder="Meera · Exporter" />
        </At>
      ) : null}

      {/* vault + escrow */}
      <At x={VAULT.x} y={VAULT.y}>
        <TrancheVault width={VAULT.w} drawers={drawers} labelChars={labelChars} titleBound={bound} />
      </At>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        {[0, 1, 2, 3, 4].map((i) => {
          const d = vaultDrawer(VAULT.x, VAULT.y, VAULT.w, i);
          return <BarFlow key={i} path={[{ x: 1690, y: 820 }, { x: 1600, y: d.y - 40 }, { x: d.x + 20, y: d.y }]} start={escrows + i * 4} duration={18} barW={110} trail={i === 0} />;
        })}
      </svg>
      <Actor who="daniel" x={1730 + (1 - danielIn) * 220} y={1080} h={440} crop="waist" pose="hold" prop="phone" expression={frame > escrows + 40 ? "confident" : "neutral"} look={-0.8} opacity={danielIn} />
      <At x={1730} y={612} anchor="tc" style={{ opacity: env(frame, escrows + 2, pays + 70, 10) }}>
        <StatusPill text="40,000 USDG → escrow" tone="lime" size={20} />
      </At>

      <At x={790} y={604} style={{ opacity: env(frame, policy + 4, undefined, 10) }}>
        <LedgerMini width={440} visible={1} rows={[{ block: 18402113, call: "registerShipment · setPolicy", hash: "", at: policy + 4 }]} />
      </At>
    </Stage>
  );
};
