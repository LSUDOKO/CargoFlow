import React from "react";
import { AbsoluteFill } from "remotion";
import { P } from "../assets/palette";
import {
  CHARACTER_INFO,
  CHARACTERS,
  CharacterName,
  EXPRESSION_RANGE,
} from "./Cast";
import { F } from "../theme";

const ORDER: CharacterName[] = ["meera", "daniel", "weilin", "arbiter", "insurer", "carrier"];
const ROW_H = 340;
const LABEL_W = 250;

export const SHEET_W = 2240;
export const SHEET_H = 180 + ORDER.length * ROW_H + 40;

const Caption: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontFamily: F.mono, fontSize: 15, color: P.slate, marginTop: 6, textAlign: "center", letterSpacing: 0.5 }}>
    {children}
  </div>
);

/** Every character × expression (bust) × gesture (full body). */
export const CharacterSheet: React.FC = () => (
  <AbsoluteFill style={{ background: P.paper, padding: "56px 64px", fontFamily: F.body }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 24, marginBottom: 28 }}>
      <div style={{ fontFamily: F.display, fontSize: 48, fontWeight: 700, color: P.ink }}>CargoFlow cast</div>
      <div style={{ fontSize: 20, color: P.slate }}>One rig · strokeless flat · light from top-left · expressions blend · blink 3–5 s</div>
    </div>
    {ORDER.map((who) => {
      const Comp = CHARACTERS[who];
      const info = CHARACTER_INFO[who];
      return (
        <div key={who} style={{ display: "flex", alignItems: "flex-end", height: ROW_H, borderTop: `1px solid ${P.line}` }}>
          <div style={{ width: LABEL_W, alignSelf: "center" }}>
            <div style={{ fontFamily: F.display, fontSize: 32, fontWeight: 700, color: P.ink }}>{info.name}</div>
            <div style={{ fontSize: 17, color: P.slate, marginTop: 4, lineHeight: 1.35 }}>{info.role}</div>
          </div>
          {EXPRESSION_RANGE[who].map((ex) => (
            <div key={ex} style={{ width: 186, paddingBottom: 18 }}>
              <div style={{ background: P.white, borderRadius: 18, overflow: "hidden", width: 172, display: "flex", justifyContent: "center" }}>
                <Comp crop="bust" scale={0.66} expression={ex} blink={false} />
              </div>
              <Caption>{ex}</Caption>
            </div>
          ))}
          <div style={{ width: 24 }} />
          {(
            [
              { label: "wave", p: { wave: true, expression: "happy" as const } },
              { label: "point", p: { point: true, expression: "focused" as const } },
              { label: "prop", p: { prop: info.defaultProp } },
              { label: "present", p: { gesture: "present" as const, expression: "confident" as const, look: "right" as const } },
            ] as const
          ).map((g) => (
            <div key={g.label} style={{ width: 200, paddingBottom: 8 }}>
              <Comp scale={0.43} blink={false} {...g.p} />
              <Caption>{g.label}</Caption>
            </div>
          ))}
        </div>
      );
    })}
  </AbsoluteFill>
);

/** Large lineup for detail review (1920×1080). */
export const CharacterLineup: React.FC = () => (
  <AbsoluteFill style={{ background: P.paper, alignItems: "flex-end", justifyContent: "center", flexDirection: "row", gap: 0, paddingBottom: 40 }}>
    {ORDER.map((who, i) => {
      const Comp = CHARACTERS[who];
      const info = CHARACTER_INFO[who];
      return (
        <div key={who} style={{ margin: "0 -36px" }}>
          <Comp scale={1.0} prop={info.defaultProp} expression={i % 2 ? "confident" : "happy"} look={i < 3 ? "right" : "left"} />
        </div>
      );
    })}
  </AbsoluteFill>
);
