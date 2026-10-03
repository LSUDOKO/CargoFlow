import React from "react";
import { Img, staticFile } from "remotion";

// logo-dark.svg has a 1440x360 viewBox (4:1); the hexagon mark fills the first ~24%.
export const LOGO_RATIO = 4;
export const MARK_FRACTION = 0.245;

export const Logo: React.FC<{
  width: number;
  variant?: "dark" | "light";
  /** 0..1: how much of the logo (left to right) is revealed. */
  reveal?: number;
  style?: React.CSSProperties;
}> = ({ width, variant = "dark", reveal = 1, style }) => (
  <div
    style={{
      width,
      height: width / LOGO_RATIO,
      clipPath: `inset(-10% ${(1 - reveal) * 100}% -10% 0)`,
      ...style,
    }}
  >
    <Img
      src={staticFile(`brand/logo-${variant}.svg`)}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  </div>
);

export const LogoMark: React.FC<{
  size: number;
  style?: React.CSSProperties;
}> = ({ size, style }) => (
  <Img
    src={staticFile("brand/mark.svg")}
    style={{ width: size, height: size, ...style }}
  />
);
