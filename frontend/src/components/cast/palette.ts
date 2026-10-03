/**
 * The illustration palette shared with the film (video/src/theme.ts + video/src/assets/palette.ts): brand tokens
 * plus a few derived tints. Light comes from the top-left, so every object has one flat "shade" tone on its right /
 * underside and nothing more. Keep these identical to the video so the website and the film read as one cast.
 */
export const P = {
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
  white: "#FFFFFF",
  limeSoft: "#EAF8B8",
  emeraldSoft: "#D4F3E2",
  inkSoft: "#3A5672",
  emeraldDeep: "#0E7C55",
  emeraldDeepShade: "#0A6043",
  paperShade: "#E6ECE2",
  whiteShade: "#EDF1EA",
  signalShade: "#A9D61E",
  verifiedShade: "#00A65A",
  alertShade: "#E59A0C",
  dangerShade: "#C93A3F",
  tealShade: "#084A5F",
  /** Map land and sea, as in the film's map kit. */
  land: "#ECEFE7",
  sea: "#FBFCFC",
} as const;

/** Fonts inside SVG text: the site's own next/font variables. */
export const FONT = {
  mono: "var(--font-jetbrains), ui-monospace, monospace",
  body: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  display: "var(--font-space-grotesk), ui-sans-serif, system-ui, sans-serif",
} as const;
