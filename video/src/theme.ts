import { FONT } from "./fonts";

// Brand tokens, identical to frontend/src/app/globals.css
export const C = {
  ink: "#0B1B2B",
  ink2: "#13293D",
  ink3: "#1D3A55",
  paper: "#F7F9F4",
  signal: "#C6F432",
  signal2: "#B2E01C",
  verified: "#00C46A",
  alert: "#FFB020",
  danger: "#E5484D",
  slate: "#5B6B7B",
  line: "#DCE3DA",
  mist: "#EEF2EA",
  teal: "#0A5A73",
} as const;

export const F = {
  display: FONT.display,
  body: FONT.body,
  mono: FONT.mono,
} as const;

export const FPS = 30;
export const W = 1920;
export const H = 1080;

export const RADIUS = 24;
export const SHADOW_CARD =
  "0 1px 0 rgba(11,27,43,0.04), 0 18px 40px -16px rgba(11,27,43,0.22)";
export const SHADOW_LIFT =
  "0 2px 0 rgba(11,27,43,0.06), 0 32px 64px -20px rgba(11,27,43,0.35)";
