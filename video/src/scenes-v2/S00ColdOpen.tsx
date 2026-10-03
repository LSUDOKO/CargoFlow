import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { P } from "../assets/palette";
import { F } from "../theme";
import { ReeferContainer } from "../assets/Reefer";
import { DocumentPortal, LaptopFrame } from "../assets/Story";
import { Cam, IN_OUT_CUBIC, OUT, Stage, clamp, leanIn } from "./kit";
import { beats } from "./timing";

/**
 * S00 · Cold open. The object first: a reefer in 3/4 front view, its LCD counting to 5.2 °C.
 * On "Its lenders" the right third slides in (its left edge is the reefer's door line) with the
 * lender's portal: two PDFs and a grey tick. "They see paperwork": the tiles fan, once.
 */
export const S00ColdOpen: React.FC = () => {
  const frame = useCurrentFrame();
  const at = beats("S00");
  const lcdStart = at("c001", "This");
  const settle = at("c002", "two");
  const lenders = at("c003", "Its");
  const paperwork = at("c004", "paperwork");

  const steps = interpolate(frame, [lcdStart, settle], [0, 4], { ...clamp, easing: IN_OUT_CUBIC });
  const temp = 4.8 + Math.floor(steps + 0.001) * 0.1;
  const zoom = leanIn(frame, lcdStart, 90, 1.06);
  const rack = interpolate(frame, [lenders, lenders + 12], [0, 6], clamp);
  const panel = interpolate(frame, [lenders, lenders + 18], [0, 1], { ...clamp, easing: OUT });
  const fan = interpolate(frame, [paperwork, paperwork + 10], [0, 1], { ...clamp, easing: OUT });
  const fadeIn = interpolate(frame, [0, 8], [1, 0], clamp);

  return (
    <Stage tone="paper">
      <Cam scale={zoom} ox={1010} oy={640} blur={rack}>
        {/* sea sliver + deck rail */}
        <div style={{ position: "absolute", left: 0, top: 892, width: 1920, height: 188, background: P.white }} />
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <rect x={0} y={884} width={1920} height={4} fill={P.ink} />
          {[
            [180, 960, 120],
            [620, 1010, 90],
            [980, 950, 140],
          ].map(([x, y, w], i) => (
            <path key={i} d={`M${x} ${y} q ${w / 4} -8 ${w / 2} 0 t ${w / 2} 0`} stroke={P.teal} strokeOpacity={0.35} strokeWidth={3} fill="none" strokeLinecap="round" />
          ))}
        </svg>
        <div style={{ position: "absolute", left: 40, top: 226 }}>
          <ReeferContainer view="front34" width={1080} temp={Number(temp.toFixed(1))} status="ok" />
        </div>
      </Cam>

      {/* the lender's view: right third, its edge is the door line */}
      <AbsoluteFill style={{ opacity: panel, transform: `translateX(${(1 - panel) * 30}px)` }}>
        <div style={{ position: "absolute", left: 1290, top: 0, width: 630, height: 1080, background: P.white, borderLeft: `4px solid ${P.ink}` }}>
          <div style={{ position: "absolute", left: 40, top: 250, fontFamily: F.mono, fontSize: 15, letterSpacing: 2, color: P.slate }}>LENDER · CREDIT PORTAL</div>
          <div style={{ position: "absolute", left: 40, top: 290, transformOrigin: "0 0", transform: "scale(1.06)" }}>
            <LaptopFrame width={520}>
              <DocumentPortal reference="CF-2026-SG01" fan={fan} />
            </LaptopFrame>
          </div>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ background: P.white, opacity: fadeIn }} />
    </Stage>
  );
};
