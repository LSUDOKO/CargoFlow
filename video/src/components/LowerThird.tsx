import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { C, F } from "../theme";
import { EASE_IN_OUT, prog } from "../lib/anim";

export type LowerThirdLabel = {
  fromSec: number;
  toSec: number;
  title: string;
  subtitle?: string;
};

/** Ink label with a lime rule; wipes in from the left, wipes out at `toSec`. */
export const LowerThird: React.FC<{
  label: LowerThirdLabel;
  left?: number;
  bottom?: number;
}> = ({ label, left = 200, bottom = 110 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = label.fromSec * fps;
  const b = label.toSec * fps;
  if (frame < a || frame > b) return null;
  const inP = prog(frame, a, a + 18);
  const outP = prog(frame, b - 12, b, EASE_IN_OUT);
  const textIn = prog(frame, a + 6, a + 26);
  return (
    <div
      style={{
        position: "absolute",
        left,
        bottom,
        display: "flex",
        alignItems: "stretch",
        clipPath: `inset(-20px ${(1 - inP) * 100}% -20px ${outP * 100}%)`,
      }}
    >
      <div
        style={{
          width: 10,
          background: C.signal,
          borderRadius: "10px 0 0 10px",
        }}
      />
      <div
        style={{
          background: C.ink,
          padding: "16px 26px 18px 22px",
          borderRadius: "0 18px 18px 0",
          boxShadow: "inset 0 0 0 1.5px rgba(247,249,244,0.08)",
        }}
      >
        <div
          style={{
            fontFamily: F.display,
            fontWeight: 700,
            fontSize: 32,
            letterSpacing: "-0.025em",
            color: C.paper,
            opacity: textIn,
            translate: `${(1 - textIn) * -12}px 0`,
            whiteSpace: "nowrap",
          }}
        >
          {label.title}
        </div>
        {label.subtitle && (
          <div
            style={{
              fontFamily: F.body,
              fontSize: 22,
              color: "rgba(247,249,244,0.72)",
              marginTop: 6,
              opacity: textIn,
              whiteSpace: "nowrap",
            }}
          >
            {label.subtitle}
          </div>
        )}
      </div>
    </div>
  );
};
