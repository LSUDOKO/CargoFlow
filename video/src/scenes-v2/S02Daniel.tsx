import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Invoice } from "../assets/Documents";
import { P } from "../assets/palette";
import { NameCard, OfficeWindow } from "../assets/Story";
import { F } from "../theme";
import { Actor, At, Cam, FigureCard, OUT, OnLine, SourceTag, Stage, Stamp, clamp, env, keys, leanIn } from "./kit";
import { SourceShot, highlightFor, shiftBoxes, unionBox } from "./SourceShot";
import { beats } from "./timing";

/** A paper bill of lading (the paperwork, not the eBL). */
export const PaperBL: React.FC<{ width?: number }> = ({ width = 220 }) => (
  <svg width={width} viewBox="0 0 220 290" style={{ display: "block", overflow: "visible" }}>
    <rect x={4} y={6} width={212} height={282} rx={8} fill={P.ink} opacity={0.08} />
    <rect width={212} height={282} rx={8} fill={P.white} />
    <rect x={198} y={8} width={8} height={266} rx={4} fill={P.whiteShade} />
    <text x={18} y={36} fontFamily={F.mono} fontSize={15} fontWeight={700} fill={P.ink} letterSpacing={1.5}>
      BILL OF LADING
    </text>
    <rect x={18} y={48} width={176} height={2} fill={P.ink} />
    {[0, 1, 2, 3, 4, 5, 6].map((i) => (
      <rect key={i} x={18} y={66 + i * 22} width={i % 3 === 2 ? 110 : 160} height={8} rx={4} fill={P.line} />
    ))}
    <g transform="translate(140 236) rotate(-12)">
      <circle r={30} fill="none" stroke={P.teal} strokeWidth={3} />
      <text y={5} textAnchor="middle" fontFamily={F.mono} fontSize={11} fontWeight={700} fill={P.teal}>
        CARRIER
      </text>
    </g>
  </svg>
);

/** The financing application on Daniel's desk. */
const Application: React.FC = () => (
  <div style={{ width: 300, height: 190, borderRadius: 10, background: P.white, boxShadow: "0 18px 30px -22px rgba(11,27,43,0.4)", padding: 18, boxSizing: "border-box", transform: "rotate(-3deg)" }}>
    <div style={{ fontFamily: F.mono, fontSize: 12, color: P.slate, letterSpacing: 1 }}>FINANCING APPLICATION</div>
    <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 18, color: P.ink, marginTop: 6 }}>CF-2026-SG01</div>
    {[80, 60, 72].map((w, i) => (
      <div key={i} style={{ height: 8, width: `${w}%`, borderRadius: 4, background: P.line, marginTop: 12 }} />
    ))}
  </div>
);

export const S02Daniel: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = beats("S02");

  const daniel = at("c011", "Daniel");
  const cantSee = at("c012", "see");
  const gets = at("c013", "He");
  const bill = at("c013", "bill");
  const paperwork = at("c014", "paperwork");
  const blind = at("c015", "blind");
  const notAtAll = at("c015", "not");
  const adb = at("c016", "The");
  const trillion = at("c017", "two");
  const small = at("c018", "Small");
  const fortyOne = at("c018", "forty-one");

  const office = frame < adb;
  const frost = interpolate(frame, [cantSee, cantSee + 24], [0, 1], clamp);
  const docs = interpolate(frame, [gets + 4, gets + 22], [0, 1], { ...clamp, easing: OUT });
  const lean = leanIn(frame, paperwork - 6, 60, 1.06);
  const holdsBill = frame >= bill + 8;
  const crossed = frame >= notAtAll + 6;
  const shake = crossed ? Math.sin((frame - notAtAll - 6) / 3) * interpolate(frame, [notAtAll + 6, notAtAll + 26], [5, 0], clamp) : 0;
  const expr = crossed ? "skeptical" : frame >= gets ? "focused" : frame >= cantSee ? "skeptical" : "neutral";

  // ADB page: both quotes on one capture (adb-news-top), boxes shifted from the quote captures
  const gapH = highlightFor("adb-news-gap.png");
  const smeH = highlightFor("adb-news-sme.png");
  const gapLines = shiftBoxes(gapH.lines, 79);
  const smeLines = shiftBoxes(smeH.lines, 529);
  const fig1 = spring({ frame: frame - (trillion - 2), fps, config: { damping: 18, stiffness: 150 } }) - spring({ frame: frame - (small - 10), fps, config: { damping: 20, stiffness: 200 } });
  const fig2 = spring({ frame: frame - (fortyOne + 10), fps, config: { damping: 18, stiffness: 150 } });
  const rack = keys(frame, [
    [trillion - 6, 0],
    [trillion + 6, 1],
    [small - 12, 1],
    [small, 0],
    [fortyOne + 6, 0],
    [fortyOne + 18, 1],
  ]);

  return (
    <Stage tone="paper">
      {office ? (
        <AbsoluteFill>
          <Cam scale={lean} ox={760} oy={520}>
            <At x={1040} y={150}>
              <OfficeWindow width={780} height={560} frost={frost} from="left" stamp="BLIND" stampAt={blind} />
            </At>
            <Actor who="daniel" x={600} y={830} h={560} crop="waist" pose={crossed ? "crossed" : holdsBill ? "hold" : "hold"} prop={holdsBill && !crossed ? "bol" : crossed ? "none" : "phone"} expression={expr} look={frame >= cantSee && frame < gets ? 1 : frame >= gets && !crossed ? -0.5 : 0.2} dx={shake} />
            {/* desk */}
            <div style={{ position: "absolute", left: 140, top: 820, width: 900, height: 30, borderRadius: 8, background: P.ink3 }} />
            <div style={{ position: "absolute", left: 180, top: 850, width: 24, height: 230, background: P.ink2 }} />
            <div style={{ position: "absolute", left: 976, top: 850, width: 24, height: 230, background: P.ink2 }} />
            <At x={120 + docs * 140} y={826} anchor="bl" style={{ opacity: docs }}>
              <div style={{ transform: "rotate(-4deg)" }}>
                <Invoice width={150} />
              </div>
            </At>
            {!holdsBill ? (
              <At x={170 + docs * 230} y={826} anchor="bl" style={{ opacity: docs }}>
                <div style={{ transform: "rotate(5deg)" }}>
                  <PaperBL width={120} />
                </div>
              </At>
            ) : null}
            <At x={740} y={826} anchor="bl">
              <Application />
            </At>
            <At x={890} y={760} anchor="center">
              <Stamp text="DECLINED" at={notAtAll} size={34} rotate={-8} />
            </At>
          </Cam>
          <At x={120} y={110}>
            <OnLine text="Paperwork, not the container." keyword="container" size={64} k={env(frame, paperwork, blind - 8, 12)} />
          </At>
          <At x={120} y={150}>
            <NameCard name="Daniel" role="Financier · credit fund" at={daniel + 6} outAt={daniel + 6 + 75} />
          </At>
        </AbsoluteFill>
      ) : (
        <AbsoluteFill>
          <SourceShot
            file="adb-news-top.png"
            url="www.adb.org/news/demand-trade-finance-rise-amid-supply-chain-realignment-adb-report"
            inAt={adb}
            stops={[
              { at: adb + 20, box: unionBox(gapLines), lines: gapLines },
              { at: small, box: unionBox(smeLines), lines: smeLines, dur: 20, sweepAt: small + 22 },
            ]}
            rack={rack}
          />
          {fig1 > 0.01 ? (
            <At x={960} y={420} anchor="center">
              <FigureCard value="$2.5 trillion" label="global trade finance gap, 2025" sub="about 10% of global trade" k={fig1} size={140} />
            </At>
          ) : null}
          {fig2 > 0.01 ? (
            <At x={960} y={420} anchor="center">
              <FigureCard value="41%" label="of SME trade finance requests rejected" k={fig2} size={160} />
            </At>
          ) : null}
        </AbsoluteFill>
      )}
      <SourceTag
        text="Source · Asian Development Bank · news release · 15 Jan 2026"
        line2={frame >= small ? "ADB Global Trade Finance Gap Survey · Dec 2025" : undefined}
        at={adb}
      />
    </Stage>
  );
};
