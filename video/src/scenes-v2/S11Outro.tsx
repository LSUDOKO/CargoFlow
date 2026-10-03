import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { P } from "../assets/palette";
import { ReeferContainer } from "../assets/Reefer";
import { Logo } from "../components/Logo";
import { F } from "../theme";
import { Actor, At, IN_OUT_CUBIC, NAVY_GRADIENT, OUT, Stage, clamp, env } from "./kit";
import { WORDS, beats, scene } from "./timing";

/**
 * S11 · Outro. The S00 framing in daylight: the reefer on the quay in Singapore at 4.6 °C, the
 * three of them in front of it. The navy wipes in from the right along the through-line, the logo
 * resolves, the tagline types on word by word with the voice and the line closes under it.
 */
export const S11Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const at = beats("S11");
  const from = scene("S11").from;
  const tagWords = WORDS.filter((w) => w.cue === "c098");
  const wipe = interpolate(frame, [10, 32], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const logoK = interpolate(frame, [at("c097") + 4, at("c097") + 20], [0, 1], { ...clamp, easing: OUT });
  const first = at("c098", "Working");
  const last = at.end("c098");
  const underline = interpolate(frame, [first, last + 4], [0, 1], { ...clamp, easing: IN_OUT_CUBIC });
  const urls = env(frame, 150, undefined, 14);
  const lean = 180;
  const edge = 1920 + lean + 40 - wipe * (1920 + 2 * lean + 80);

  return (
    <Stage tone="paper">
      {/* quay, daylight */}
      <AbsoluteFill>
        <div style={{ position: "absolute", left: 0, top: 900, width: 1920, height: 180, background: P.paperShade }} />
        <At x={960} y={902} anchor="bc">
          <ReeferContainer view="side" width={1180} temp={4.6} status="ok" />
        </At>
        <Actor who="daniel" x={620} y={1010} h={600} pose="crossed" expression="confident" look={0.5} />
        <Actor who="meera" x={960} y={1010} h={600} pose="stand" gesture="present" gestureAt={-20} prop="tablet" expression="happy" look={0} />
        <Actor who="weilin" x={1300} y={1010} h={600} pose="hold" prop="bol" expression="relieved" look={-0.5} />
      </AbsoluteFill>

      {/* the navy wipes in from the right along the through-line */}
      <AbsoluteFill style={{ clipPath: `polygon(${edge + lean}px 0, 1920px 0, 1920px 1080px, ${edge - lean}px 1080px)`, background: NAVY_GRADIENT }}>
        <At x={960} y={330} anchor="center" style={{ opacity: logoK, transform: `translate(-50%,-50%) scale(${0.96 + 0.04 * logoK})` }}>
          <Logo width={620} variant="dark" />
        </At>
        <At x={960} y={520} w={1640} anchor="tc">
          <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 56, lineHeight: 1.2, letterSpacing: -1, color: P.white, textAlign: "center" }}>
            {tagWords.map((w, i) => {
              const s = Math.round((w.startMs / 1000) * 30) - from;
              const k = interpolate(frame, [s - 2, s + 6], [0, 1], clamp);
              const key = w.word.startsWith("evidence");
              return (
                <span key={i} style={{ opacity: k, color: key ? P.signal : P.white, display: "inline-block", transform: `translateY(${(1 - k) * 8}px)`, marginRight: "0.26em" }}>
                  {w.word}
                </span>
              );
            })}
          </div>
          <svg width={1640} height={30} style={{ display: "block", marginTop: 14 }}>
            {underline > 0.005 ? <line x1={260} y1={14} x2={260 + 1120 * underline} y2={14} stroke={P.white} strokeWidth={5} strokeLinecap="round" /> : null}
          </svg>
        </At>
        <At x={960} y={760} anchor="tc" style={{ opacity: urls }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, fontFamily: F.mono, fontSize: 24, color: "rgba(255,255,255,0.82)" }}>
            <span>cargoflow.adoranto737.workers.dev</span>
            <span>github.com/LSUDOKO/CargoFlow</span>
            <span>MCP: cargoflow-mcp.adoranto737.workers.dev/mcp</span>
          </div>
        </At>
      </AbsoluteFill>
      {wipe > 0 && wipe < 1 ? (
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <line x1={edge + lean} y1={-10} x2={edge - lean} y2={1090} stroke={P.signal} strokeWidth={6} strokeLinecap="round" />
        </svg>
      ) : null}
    </Stage>
  );
};
