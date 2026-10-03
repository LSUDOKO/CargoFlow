import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { P } from "../assets/palette";
import { ContainerShip } from "../assets/Ship";
import { CalendarStrip, CashGauge, ExpenseTag, NameCard } from "../assets/Story";
import { VialTray } from "../assets/Devices";
import { RouteMap } from "../maps";
import { Actor, At, Cam, FigureCard, IN_OUT_CUBIC, OUT, OnLine, SourceTag, Stage, clamp, env, leanIn, truck } from "./kit";
import { SourceShot, highlightFor } from "./SourceShot";
import { beats } from "./timing";

/** Meera's wall map: the through-line drawn from Nhava Sheva (Pune's port) to Singapore. */
const DeskMap: React.FC<{ draw: number }> = ({ draw }) => (
  <div style={{ width: 620, height: 380, borderRadius: 14, background: P.ink2, padding: 12, boxSizing: "border-box", boxShadow: "0 24px 40px -28px rgba(11,27,43,0.4)" }}>
    <div style={{ width: 596, height: 356, borderRadius: 6, overflow: "hidden", background: P.white }}>
      <RouteMap
        width={596}
        height={356}
        camera={{ lon: 88.5, lat: 10.2, zoom: 1.12 }}
        routeDraw={draw}
        progress={draw * 0.999}
        labels={false}
        scaleBar={false}
        attribution={false}
        corridorKm={0}
        portsIn={[draw > 0.02 ? 1 : 0, draw > 0.45 ? 1 : 0, draw > 0.97 ? 1 : 0]}
      />
    </div>
  </div>
);

/** Two vial cartons on a pallet, the vial tray on top: what Meera pays for today. */
const Cartons: React.FC = () => (
  <div style={{ position: "relative", width: 300, height: 330 }}>
    <svg width={300} height={250} viewBox="0 0 300 250" style={{ position: "absolute", left: 0, bottom: 0 }}>
      {[0, 1].map((i) => (
        <g key={i} transform={`translate(${14 + i * 140} 40)`}>
          <rect width={130} height={170} rx={8} fill={P.white} />
          <rect x={118} y={6} width={8} height={158} rx={4} fill={P.whiteShade} />
          <rect x={0} y={20} width={130} height={14} fill={P.paperShade} />
          <rect x={14} y={60} width={70} height={26} rx={6} fill={P.signal} />
          <text x={49} y={78} textAnchor="middle" fontFamily="monospace" fontSize={13} fontWeight={700} fill={P.ink}>
            2–8 °C
          </text>
          <rect x={14} y={100} width={92} height={7} rx={3.5} fill={P.line} />
          <rect x={14} y={114} width={64} height={7} rx={3.5} fill={P.line} />
        </g>
      ))}
      <rect x={0} y={214} width={300} height={14} rx={4} fill={P.ink3} />
      {[10, 135, 260].map((x) => (
        <rect key={x} x={x} y={228} width={30} height={22} rx={3} fill={P.ink2} />
      ))}
    </svg>
    <div style={{ position: "absolute", left: 26, top: 0 }}>
      <VialTray width={248} cols={4} />
    </div>
  </div>
);

/** A Singapore office window: sky, two simple tower outlines, a mullion. */
const SgWindow: React.FC = () => (
  <svg width={560} height={380} viewBox="0 0 560 380">
    <rect width={560} height={380} rx={16} fill={P.ink2} />
    <rect x={16} y={16} width={528} height={348} rx={8} fill={P.mist} />
    <g fill="none" stroke={P.ink3} strokeWidth={3} opacity={0.55}>
      <path d="M90 364 V150 h70 v214" />
      <path d="M104 170 h42 M104 200 h42 M104 230 h42 M104 260 h42 M104 290 h42" />
      <path d="M330 364 V96 l40 -30 l40 30 v268" />
      <path d="M346 130 h48 M346 165 h48 M346 200 h48 M346 235 h48 M346 270 h48 M346 305 h48" />
    </g>
    <rect x={274} y={16} width={12} height={348} fill={P.ink2} />
  </svg>
);

export const S01Meera: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = beats("S01");

  const meet = at("c005", "Meet");
  const vials = at("c006", "vials");
  const reefer = at("c006", "reefer");
  const freight = at("c006", "freight");
  const pays = at("c006", "She");
  const weilin = at("c007", "Her");
  const weilinName = at("c007", "Wei");
  const india = at("c008", "In");
  const fiftyTwo = at("c009", "fifty-two");
  const about = at("c010", "About");
  const cash = at("c010", "cash");
  const sea = at("c010", "sea");

  const stage1 = frame < india;
  const stage2 = frame >= about - 6;

  // --- stage 1: packing room -------------------------------------------------------------
  const camX = truck(frame, pays - 4, 26, 0, -300);
  const mapDraw = interpolate(frame, [4, 44], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const drained = [vials, reefer, freight].filter((f) => frame >= f + 4).length;
  const level = interpolate(frame, [vials + 4, vials + 14, reefer + 4, reefer + 14, freight + 4, freight + 14], [1, 0.67, 0.67, 0.42, 0.42, 0.18], clamp);
  const split = interpolate(frame, [weilin - 6, weilin + 16], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const splitLine = interpolate(frame, [weilin - 12, weilin + 2], [0, 1], { ...clamp, easing: OUT });
  const meeraExpr = frame < meet + 30 && frame >= meet ? "happy" : drained > 0 ? "worried" : "focused";

  // --- source beat ---------------------------------------------------------------------------
  const pdf = highlightFor("atradius-india-pdf-terms.png");
  const figK = spring({ frame: frame - (fiftyTwo - 30), fps, config: { damping: 18, stiffness: 150 } });
  const calFill = interpolate(frame, [fiftyTwo - 30, fiftyTwo + 9], [0, 52], clamp);

  // --- stage 2: cash at sea ------------------------------------------------------------------
  const lean = leanIn(frame, cash - 8, 60, 1.06);
  const shipX = interpolate(frame, [sea, sea + 70], [0, 260], { ...clamp, easing: IN_OUT_CUBIC });
  const snap = frame >= sea + 46;
  const snapK = interpolate(frame, [sea + 46, sea + 62], [0, 1], { ...clamp, easing: OUT });

  return (
    <Stage tone="paper">
      {stage1 ? (
        <AbsoluteFill>
          <Cam x={camX}>
            <div style={{ position: "absolute", left: -200, top: 930, width: 2600, height: 4, background: P.ink, opacity: 0.85 }} />
            <At x={640} y={250}>
              <DeskMap draw={mapDraw} />
            </At>
            <At x={1290} y={930} anchor="bl">
              <Cartons />
            </At>
            {/* expense tags on a line + cash gauge */}
            <svg width={2400} height={400} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
              <path d="M1600 252 Q1880 274 2160 252" stroke={P.ink} strokeWidth={3} fill="none" />
            </svg>
            {["vials", "reefer", "freight"].map((l, i) => (
              <At key={l} x={1610 + i * 190} y={240}>
                <ExpenseTag label={l} width={170} stampAt={[vials, reefer, freight][i]} />
              </At>
            ))}
            <At x={1620} y={470}>
              <CashGauge level={level} width={520} />
            </At>
            <Actor
              who="meera"
              x={420}
              y={930}
              h={700}
              pose="hold"
              prop="tablet"
              propRight={frame < 50 ? "pencil" : "none"}
              expression={meeraExpr}
              look={frame >= meet && frame < meet + 30 ? "front" : drained > 0 ? 0.8 : 0.6}
            />
          </Cam>
          <At x={170} y={150}>
            <NameCard name="Meera" role="Exporter · vaccines, Pune" illustrative at={meet + 6} outAt={meet + 6 + 75} />
          </At>

          {/* Wei Lin, split by the through-line */}
          {split > 0 ? (
            <AbsoluteFill style={{ clipPath: `inset(0 0 0 ${960 + (1 - split) * 960}px)` }}>
              <AbsoluteFill style={{ background: P.white }} />
              <At x={1010} y={190}>
                <SgWindow />
              </At>
              <div style={{ position: "absolute", left: 960, top: 930, width: 960, height: 4, background: P.ink, opacity: 0.85 }} />
              <Actor who="weilin" x={1700} y={930} h={680} pose="hold" prop="invoice" expression="neutral" look={-0.4} />
              <At x={1110} y={650}>
                <NameCard name="Wei Lin" role="Buyer · pharma importer, Singapore" at={weilinName + 6} />
              </At>
            </AbsoluteFill>
          ) : null}
          {splitLine > 0 ? <div style={{ position: "absolute", left: 957 + (1 - split) * 960, top: 0, width: 6, height: 1080 * splitLine, background: P.ink }} /> : null}
        </AbsoluteFill>
      ) : null}

      {!stage1 && !stage2 ? (
        <AbsoluteFill>
          <SourceShot
            file="atradius-india-pdf-terms.png"
            url="group.atradius.com/dam/jcr:b693e087…/payment-practices-barometer-asia-2025-india-en.pdf"
            establish={{ file: "atradius-india-top.png", until: india + 30 }}
            inAt={india}
            stops={[{ at: india + 40, box: pdf, lines: pdf.lines }]}
            rack={interpolate(frame, [fiftyTwo - 30, fiftyTwo - 18], [0, 1], clamp)}
          />
          <At x={960} y={360} anchor="center">
            <FigureCard value="52 days" label="average payment terms" k={figK} size={150} />
          </At>
          <At x={210} y={660} style={{ opacity: Math.min(1, figK * 1.4) }}>
            <CalendarStrip filled={calFill} width={1500} />
          </At>
        </AbsoluteFill>
      ) : null}
      <SourceTag text="Source · Atradius · Payment Practices Barometer, India 2025 · 29 Jul 2025" at={india} out={about - 8} />

      {stage2 ? (
        <AbsoluteFill style={{ opacity: interpolate(frame, [about - 6, about], [0, 1], clamp) }}>
          <Cam scale={lean} ox={900} oy={560}>
            <div style={{ position: "absolute", left: 0, top: 628, width: 1920, height: 452, background: "#EEF3F1" }} />
            <At x={760 + shipX} y={420}>
              <ContainerShip width={700} water={false} wake />
            </At>
            <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
              {[[300, 700, 160], [1240, 760, 120], [820, 820, 180], [1560, 700, 140]].map(([x, y, w], i) => (
                <path key={i} d={`M${x} ${y} q ${w / 4} -8 ${w / 2} 0 t ${w / 2} 0`} stroke={P.teal} strokeOpacity={0.3} strokeWidth={3} fill="none" strokeLinecap="round" />
              ))}
              {!snap ? (
                <path d={`M520 560 C 700 520, ${880 + shipX} 520, ${1080 + shipX} 520`} stroke={P.ink} strokeWidth={3} strokeDasharray="2 10" strokeLinecap="round" fill="none" />
              ) : (
                <g opacity={1 - snapK}>
                  <path d={`M520 560 C 600 545, 680 ${540 + snapK * 40}, 720 ${545 + snapK * 70}`} stroke={P.ink} strokeWidth={3} strokeDasharray="2 10" strokeLinecap="round" fill="none" />
                  <path d={`M${1080 + shipX} 520 C ${1000 + shipX} 520, ${940 + shipX} ${525 + snapK * 30}, ${900 + shipX} ${535 + snapK * 60}`} stroke={P.ink} strokeWidth={3} strokeDasharray="2 10" strokeLinecap="round" fill="none" />
                </g>
              )}
            </svg>
            <At x={120} y={520}>
              <CashGauge level={0.18} width={400} label="Meera · working capital" />
            </At>
          </Cam>
          <At x={960} y={170} anchor="tc">
            <OnLine text="About two months of cash, at sea." keyword="cash" size={76} k={env(frame, about + 2, undefined, 14)} align="center" />
          </At>
        </AbsoluteFill>
      ) : null}
    </Stage>
  );
};
