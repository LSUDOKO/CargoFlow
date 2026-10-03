import { C } from "../theme";

/**
 * Illustration palette: brand tokens plus three derived tints. Nothing else is used for
 * objects. Light comes from the top-left, so every object has one flat "shade" tone on its
 * right / underside and nothing more (no glows, no fake 3D).
 */
export const P = {
  ...C,
  white: "#FFFFFF",
  // derived tints
  limeSoft: "#EAF8B8", // lime at ~25% on paper
  emeraldSoft: "#D4F3E2", // emerald at ~18% on paper
  inkSoft: "#3A5672", // ink-3 lifted, for shade on light-on-dark parts
  emeraldDeep: "#0E7C55", // emerald at depth, for garments
  emeraldDeepShade: "#0A6043",
  // object shades (one step darker than their base, top-left light)
  paperShade: "#E6ECE2",
  whiteShade: "#EDF1EA",
  signalShade: "#A9D61E",
  verifiedShade: "#00A65A",
  alertShade: "#E59A0C",
  dangerShade: "#C93A3F",
  tealShade: "#084A5F",
} as const;

/** Corner radii used everywhere: small details, panels, cards. */
export const R = { s: 4, m: 10, l: 18 } as const;

/** Deterministic hash in [0,1). */
export const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Strip characters React's useId produces that are not valid inside url(#…). */
export const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "");

export type Pt = { x: number; y: number };
