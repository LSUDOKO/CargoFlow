import React from "react";
import { AbsoluteFill, Easing } from "remotion";
import type { TransitionPresentation, TransitionPresentationComponentProps } from "@remotion/transitions";
import { P } from "../assets/palette";

/**
 * The film's route wipe: the navy through-line sweeps across the frame on a slight diagonal and
 * the next scene is revealed behind it. The outgoing scene holds still underneath.
 */

type WipeProps = { color?: string; thickness?: number };

const ease = Easing.bezier(0.65, 0, 0.35, 1);

const RouteWipeComp: React.FC<TransitionPresentationComponentProps<WipeProps>> = ({ children, presentationDirection, presentationProgress, passedProps }) => {
  if (presentationDirection === "exiting") return <AbsoluteFill>{children}</AbsoluteFill>;
  const p = ease(presentationProgress);
  const lean = 180;
  const x = -lean - 40 + p * (1920 + 2 * lean + 80);
  const top = x + lean;
  const bottom = x - lean;
  const color = passedProps.color ?? P.ink;
  const th = passedProps.thickness ?? 8;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ clipPath: `polygon(0 0, ${top}px 0, ${bottom}px 1080px, 0 1080px)` }}>{children}</AbsoluteFill>
      {p < 1 ? (
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <line x1={top} y1={-10} x2={bottom} y2={1090} stroke={color} strokeWidth={th} strokeLinecap="round" />
        </svg>
      ) : null}
    </AbsoluteFill>
  );
};

export const routeWipe = (props: WipeProps = {}): TransitionPresentation<WipeProps> => ({ component: RouteWipeComp, props });
