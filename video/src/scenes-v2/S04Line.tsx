import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { P } from "../assets/palette";
import { ReeferContainer } from "../assets/Reefer";
import { Logo } from "../components/Logo";
import { F } from "../theme";
import { At, IN_OUT_CUBIC, OUT, OnLine, Stage, clamp, env } from "./kit";
import { SourceShot, highlightFor } from "./SourceShot";
import { beats } from "./timing";

/**
 * S04 · The line. The founder's sentence highlighted on the README, then the change of key:
 * navy, the frosted window from S02, and the through-line wiping the frost clear so the reefer
 * and its in-band trace show through. Five milestone pips; "capital available" fills the first.
 */
export const S04Line: React.FC = () => {
  const frame = useCurrentFrame();
  const at = beats("S04");
  const navyAt = at("c025", "CargoFlow");
  const capital = at("c026", "capital");
  const onChain = at("c027", "On");

  const readme = highlightFor("cargoflow-readme-lender.png");
  const navy = frame >= navyAt;

  const wipeX = interpolate(frame, [navyAt + 14, navyAt + 44], [-40, 1960], { ...clamp, easing: IN_OUT_CUBIC });
  const winL = 760;
  const winW = 400;
  const frostFrom = Math.max(0, Math.min(winW, wipeX - winL));
  const pipsDraw = interpolate(frame, [capital - 30, capital], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const fillK = interpolate(frame, [capital + 4, capital + 22], [0, 1], { ...clamp, easing: OUT });
  const logoK = interpolate(frame, [onChain, onChain + 16], [0, 1], { ...clamp, easing: OUT });
  const pipX = [420, 690, 960, 1230, 1500];

  return (
    <Stage tone={navy ? "navy" : "paper"} grid={!navy}>
      {!navy ? (
        <SourceShot
          file="cargoflow-readme-lender.png"
          url="github.com/LSUDOKO/CargoFlow#the-problem-in-one-paragraph"
          crop={readme.safeCrop}
          inAt={0}
          stops={[{ at: 10, box: readme, lines: [readme.lines[0], { ...readme.lines[1], w: 816 }, { x: 385, y: 501, w: 600, h: 22 }], dur: 30 }]}
        />
      ) : (
        <AbsoluteFill style={{ opacity: interpolate(frame, [navyAt, navyAt + 8], [0, 1], clamp) }}>
          <At x={960} y={120} w={1500} anchor="tc">
            <OnLine text="The cargo's own evidence decides how much capital is available." keyword="evidence" dark size={66} align="center" maxWidth={1500} k={env(frame, navyAt + 6, undefined, 16)} />
          </At>

          {/* the window: reefer + in-band trace behind frost that the line wipes away */}
          <div style={{ position: "absolute", left: winL - 16, top: 330, width: winW + 32, height: 300, borderRadius: 16, background: P.ink3, padding: 16, boxSizing: "border-box" }}>
            <div style={{ position: "relative", width: winW, height: 268, borderRadius: 8, overflow: "hidden", background: P.mist }}>
              <div style={{ position: "absolute", left: 12, top: 70 }}>
                <ReeferContainer view="side" width={376} temp={4.6} status="ok" />
              </div>
              <svg width={winW} height={268} style={{ position: "absolute", inset: 0 }}>
                <path d="M16 230 C 70 226, 110 234, 160 229 S 260 226, 300 231 S 370 228, 386 230" stroke={P.verified} strokeWidth={3} fill="none" />
              </svg>
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: frostFrom,
                  right: 0,
                  backdropFilter: "blur(14px)",
                  WebkitBackdropFilter: "blur(14px)",
                  background: "rgba(255,255,255,0.55)",
                }}
              />
            </div>
          </div>

          <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
            {/* through-line wiping the frost */}
            <line x1={-40} y1={480} x2={wipeX} y2={480} stroke={P.white} strokeWidth={5} strokeLinecap="round" opacity={0.95} />
            {/* milestone line + pips */}
            <line x1={pipX[0]} y1={740} x2={pipX[0] + (pipX[4] - pipX[0]) * pipsDraw} y2={740} stroke={P.white} strokeWidth={5} strokeLinecap="round" />
            {pipX.map((x, i) => {
              const k = interpolate(pipsDraw, [i / 4 - 0.05, i / 4 + 0.05], [0, 1], clamp);
              return (
                <g key={i} transform={`translate(${x} 740) scale(${k})`}>
                  <rect x={-24} y={-17} width={48} height={34} rx={17} fill={i === 0 && fillK > 0.5 ? P.signal : P.ink} stroke={P.white} strokeWidth={3} />
                  <text y={6} textAnchor="middle" fontFamily={F.mono} fontSize={15} fontWeight={700} fill={i === 0 && fillK > 0.5 ? P.ink : P.white}>
                    M{i + 1}
                  </text>
                </g>
              );
            })}
            <rect x={pipX[0] - 24} y={776} width={(pipX[1] - pipX[0]) * fillK} height={14} rx={7} fill={P.signal} />
            <text x={pipX[0] - 24} y={822} fontFamily={F.mono} fontSize={18} fill={P.signal} opacity={fillK}>
              capital available
            </text>
          </svg>

          <At x={960} y={870} anchor="tc" style={{ opacity: logoK, transform: `translate(-50%, 0) scale(${0.96 + 0.04 * logoK})` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
              <Logo width={280} variant="dark" />
              <div style={{ width: 2, height: 46, background: "rgba(255,255,255,0.3)" }} />
              <div style={{ fontFamily: F.body, fontWeight: 500, fontSize: 26, color: "rgba(255,255,255,0.85)" }}>On chain · milestone by milestone</div>
            </div>
          </At>
        </AbsoluteFill>
      )}
    </Stage>
  );
};
