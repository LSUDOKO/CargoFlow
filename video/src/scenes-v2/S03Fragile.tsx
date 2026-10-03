import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { DataLogger, VialTray } from "../assets/Devices";
import { P } from "../assets/palette";
import { ReeferContainer } from "../assets/Reefer";
import { F } from "../theme";
import { Actor, At, FigureCard, IN_OUT_CUBIC, OUT, SHADOW, SourceTag, Stage, clamp } from "./kit";
import { SourceShot, highlightFor } from "./SourceShot";
import { beats } from "./timing";

/** Logger trace: an ink line over the 2-8 °C band, red where it is above 8. Scrolls left. */
const Trace: React.FC<{ frame: number; width?: number }> = ({ frame, width = 640 }) => {
  const W = 640;
  const H = 300;
  const yOf = (t: number) => H - 24 - (t / 12) * (H - 48);
  const temp = (x: number) => {
    const base = 4.8 + Math.sin(x * 0.9) * 0.35;
    const warm = Math.max(0, Math.min(1, (x - 3) / 2.4));
    return base + warm * 4.4 + Math.sin(x * 3.1) * 0.12;
  };
  const off = Math.min(frame, 200) / 40;
  const d = Array.from({ length: 81 }, (_, i) => {
    const x = (i / 80) * 6 + off * 0.35;
    return `${i ? "L" : "M"}${(i * 8).toFixed(1)} ${yOf(temp(x)).toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={width} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <defs>
        <clipPath id="trace-hot">
          <rect x={0} y={0} width={W} height={yOf(8)} />
        </clipPath>
        <clipPath id="trace-box">
          <rect width={W} height={H} rx={14} />
        </clipPath>
      </defs>
      <rect width={W} height={H} rx={14} fill={P.white} />
      <rect x={0} y={yOf(8)} width={W} height={yOf(2) - yOf(8)} fill={P.emeraldSoft} />
      <text x={14} y={yOf(8) - 8} fontFamily={F.mono} fontSize={15} fill={P.slate}>
        8 °C
      </text>
      <text x={14} y={yOf(2) + 20} fontFamily={F.mono} fontSize={15} fill={P.slate}>
        2 °C
      </text>
      <g clipPath="url(#trace-box)">
        <path d={d} stroke={P.ink} strokeWidth={4} fill="none" strokeLinejoin="round" />
        <path d={d} stroke={P.danger} strokeWidth={4} fill="none" strokeLinejoin="round" clipPath="url(#trace-hot)" />
      </g>
    </svg>
  );
};

export const S03Fragile: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = beats("S03");
  const cut = at("c020", "Biopharma");
  const billion = at("c020", "thirty-five");
  const back = at("c021", "logistics") - 46;
  const logger = at("c022", "The");

  const wipe = interpolate(frame, [0, 12], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const warmT = interpolate(frame, [back + 6, logger - 6], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const p1 = 6.1 + warmT * 2.3;
  const loss = highlightFor("aircargonews-iqvia-loss.png");
  const fig = spring({ frame: frame - (billion + 8), fps, config: { damping: 18, stiffness: 150 } });

  const lineDraw = interpolate(frame, [logger + 10, logger + 40], [0, 1], { ...clamp, easing: OUT });
  const brk = interpolate(frame, [logger + 48, logger + 60], [0, 1], { ...clamp, easing: OUT });
  const beat = frame - (frame % 24);

  const showCut = frame < cut || (frame >= back && frame < logger);
  const showSource = frame >= cut && frame < back;
  const showSplit = frame >= logger;

  return (
    <Stage tone="paper">
      {showCut ? (
        <AbsoluteFill>
          <At x={960} y={110} anchor="tc">
            <ReeferContainer
              view="cutaway"
              width={1460}
              probes={frame < back ? [4.6, 4.6] : [Number(p1.toFixed(1)), 4.6]}
              temp={frame < back ? 4.6 : Number(p1.toFixed(1))}
              status={p1 > 8 && frame >= back ? "excursion" : "ok"}
              frost={frame < back ? [1, 1] : [1 - warmT * 0.85, 1]}
              wipe={wipe}
              pulse={frame >= back ? "fast" : "slow"}
              warm={frame >= back ? warmT * 0.3 : 0}
            />
          </At>
          <At x={140} y={1000} anchor="bl">
            <div style={{ filter: frame >= back ? `grayscale(${warmT * 0.3})` : undefined }}>
              <VialTray width={560} cols={7} />
            </div>
          </At>
        </AbsoluteFill>
      ) : null}

      {showSource ? (
        <AbsoluteFill>
          <SourceShot
            file="aircargonews-iqvia-loss.png"
            url="www.aircargonews.net/pharma-logistics/2019/07/failures-in-temperature-controlled-logistics-cost-biopharma-industry-billions/"
            crop={loss.safeCrop}
            inAt={cut}
            stops={[{ at: cut + 10, box: loss, lines: loss.lines, dur: 36 }]}
            rack={interpolate(frame, [billion + 4, billion + 16], [0, 1], clamp)}
          />
          <At x={960} y={440} anchor="center">
            <FigureCard value="$35 billion" label="a year, lost by biopharma to temperature-controlled logistics failures" k={fig} size={140} style={{ maxWidth: 900 }} />
          </At>
        </AbsoluteFill>
      ) : null}
      <SourceTag text="Source · IQVIA Institute, via Air Cargo News · 26 Jul 2019" at={cut} out={back - 6} />

      {showSplit ? (
        <AbsoluteFill>
          <div style={{ position: "absolute", left: 960, top: 0, width: 960, height: 1080, background: P.white }} />
          <At x={90} y={250}>
            <DataLogger width={300} value={8.4} alarm beepAt={beat} id="probe-1" />
          </At>
          <At x={420} y={300} style={{ borderRadius: 14, boxShadow: SHADOW }}>
            <Trace frame={frame - logger} width={500} />
          </At>
          <div style={{ position: "absolute", left: 420, top: 556, fontFamily: F.mono, fontSize: 18, color: P.slate }}>logger · every degree recorded</div>

          <At x={1080} y={400}>
            <div style={{ width: 520, padding: "22px 26px", borderRadius: 18, background: P.paper, border: `1px solid ${P.line}`, fontFamily: F.mono }}>
              <div style={{ fontSize: 13, letterSpacing: 1, color: P.slate }}>LOAN BOOK</div>
              <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontSize: 22, fontWeight: 700, color: P.ink }}>
                <span>CF-2026-SG01</span>
                <span style={{ color: P.slate, fontWeight: 500 }}>In transit</span>
              </div>
              <div style={{ marginTop: 14, height: 8, width: "70%", borderRadius: 4, background: P.line }} />
              <div style={{ marginTop: 10, height: 8, width: "48%", borderRadius: 4, background: P.line }} />
            </div>
          </At>
          <Actor who="daniel" x={1780} y={1080} h={520} crop="waist" pose="hold" prop="phone" expression="focused" look={-0.9} />

          {/* the connection that never happens */}
          <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
            <clipPath id="s03-draw">
              <rect x={880} y={400} width={210 * lineDraw} height={140} />
            </clipPath>
            <path d="M890 470 C 960 470, 1010 476, 1078 476" stroke={P.ink} strokeWidth={3} strokeDasharray="10 9" fill="none" clipPath="url(#s03-draw)" opacity={brk > 0 ? 0 : 1} />
            {brk > 0 ? (
              <g>
                <path d={`M890 470 C 920 470, 950 ${472 + brk * 10}, ${965 - brk * 14} ${474 + brk * 26}`} stroke={P.ink} strokeWidth={3} strokeDasharray="10 9" fill="none" />
                <path d={`M1078 476 C 1050 476, 1025 ${478 + brk * 8}, ${1005 + brk * 14} ${480 + brk * 24}`} stroke={P.ink} strokeWidth={3} strokeDasharray="10 9" fill="none" />
              </g>
            ) : null}
          </svg>
        </AbsoluteFill>
      ) : null}
    </Stage>
  );
};
