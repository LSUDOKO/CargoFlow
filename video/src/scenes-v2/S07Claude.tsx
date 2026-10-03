import React from "react";
import { CastCue, DemoShell, ShotSpec } from "./DemoShell";
import { beats } from "./timing";

/**
 * S07 · CargoFlow in claude.ai (recording R2, first beat from R3). claude.ai's own UI in a
 * neutral browser frame; one punch-in per beat on the tool-call chip / the answer's key line.
 * Daniel at the right edge: thinking (M3), pointing at the link (M4), confident (M5).
 */
export const S07_SHOTS = (at: ReturnType<typeof beats>): ShotSpec[] => {
  const m2 = 84;
  const m3 = 240;
  const m4 = 330;
  const m5 = 480;
  return [
    { shot: "R2-01", from: 0, frames: m2, url: "cargoflow.adoranto737.workers.dev/developers", punches: [{ from: 20, to: m2 - 14, scale: 1.6, cx: 0.5, cy: 0.35, label: "Use CargoFlow in Claude · Copy URL" }] },
    { shot: "R2-02", from: m2, frames: m3 - m2, url: "claude.ai/settings/connectors", title: "Claude", punches: [{ from: at("c083", "custom") - m2 - 6, to: m3 - m2 - 14, scale: 1.5, cx: 0.5, cy: 0.45, label: "Add custom connector · CargoFlow" }] },
    { shot: "R2-03", from: m3, frames: m4 - m3, url: "claude.ai/new", title: "Claude", punches: [{ from: at("c084", "explains") - m3 - 6, to: m4 - m3 - 4, scale: 1.5, cx: 0.45, cy: 0.5, label: "fleet_risk_summary · explain_shipment" }] },
    { shot: "R2-04", from: m4, frames: m5 - m4, url: "claude.ai/chat/…", title: "Claude", punches: [{ from: at("c085", "link") - m4 - 6, to: m5 - m4 - 14, scale: 1.6, cx: 0.45, cy: 0.62, label: "prepare_deposit · link to sign in the app" }] },
    { shot: "R2-05", from: m5, frames: 600 - m5, url: "claude.ai/chat/…", title: "Claude", punches: [{ from: at("c086", "never") - m5 - 6, to: 600 - m5, scale: 1.6, cx: 0.45, cy: 0.5, label: "{to, data, value, chainId} · Nothing has been sent" }] },
  ];
};

export const S07Claude: React.FC = () => {
  const at = beats("S07");
  const cast: CastCue[] = [
    { who: "daniel", side: "right", from: 240, to: 329, pose: "thinking", expression: "focused" },
    { who: "daniel", side: "right", from: 330, to: 479, pose: "hold", prop: "phone", gesture: "point", point: "left", gestureAt: at("c085", "link") - 2, expression: "focused" },
    { who: "daniel", side: "right", from: 480, to: 600, pose: "crossed", expression: "confident" },
  ];
  const overlays = [
    { text: "cargoflow-mcp.adoranto737.workers.dev/mcp", from: 6, to: 84 },
    { text: "Remote MCP · Streamable HTTP · 25 tools", from: 90, to: 238 },
    { text: "Unsigned · you sign in your wallet", from: at("c085", "prepares"), to: 478 },
    { text: "No private keys, ever.", from: at("c086", "It"), to: 600 },
  ];
  return <DemoShell shots={S07_SHOTS(at)} cast={cast} overlays={overlays} />;
};
