import React from "react";
import { Sequence } from "remotion";
import { ClaudeStills, R2_02, R2_03, R2_04, R2_05, StillState } from "./ClaudeStills";
import { CastCue, DemoShell, ShotSpec } from "./DemoShell";
import { beats } from "./timing";

/**
 * S07 · CargoFlow in claude.ai. First beat is the /developers recording (Copy URL); R2-02..R2-05 are animated from
 * the real claude.ai captures (ClaudeStills.tsx): push-ins, crossfades, the prompts typing on, highlights on the
 * connector, the permission prompt (cursor to Allow once), the tool calls, the unsigned transactions and signUrl.
 * Daniel at the right edge: thinking (M3), pointing at the link (M4), confident (M5).
 */
export const S07_SHOTS = (at: ReturnType<typeof beats>): ShotSpec[] => {
  void at;
  const m2 = 84;
  const m3 = 240;
  const m4 = 330;
  const m5 = 480;
  const app = m4 + 94; // R2-04's last still is the CargoFlow app opened from the link
  return [
    { shot: "R2-01", from: 0, frames: m2, url: "cargoflow.adoranto737.workers.dev/developers", punches: [{ from: 12, to: m2, scale: 1.7, cx: 0.4, cy: 0.68, label: "Use CargoFlow in Claude · Copy URL" }] },
    { shot: "R2-02", from: m2, frames: m3 - m2, url: "claude.ai/settings/connectors", title: "Claude", content: <ClaudeStills states={R2_02} /> },
    { shot: "R2-03", from: m3, frames: m4 - m3, url: "claude.ai/new", title: "Claude", content: <ClaudeStills states={R2_03} /> },
    { shot: "R2-04", from: m4, frames: app - m4, url: "claude.ai/chat/…", title: "Claude", content: <ClaudeStills states={R2_04} /> },
    // same still sequence, continued in a CargoFlow tab (the link opens the shipment page; nothing is signed)
    { shot: "R2-04", from: app, frames: m5 - app, url: "cargoflow.adoranto737.workers.dev/track/0x7760f893…643e", content: <OffsetStills states={R2_04} offset={app - m4} /> },
    { shot: "R2-05", from: m5, frames: 600 - m5, url: "claude.ai/chat/…", title: "Claude", content: <ClaudeStills states={R2_05} /> },
  ];
};

const OffsetStills: React.FC<{ states: StillState[]; offset: number }> = ({ states, offset }) => (
  <Sequence from={-offset} layout="none">
    <ClaudeStills states={states} />
  </Sequence>
);

export const S07Claude: React.FC = () => {
  const at = beats("S07");
  const cast: CastCue[] = [
    { who: "daniel", side: "right", from: 240, to: 329, pose: "thinking", expression: "focused" },
    { who: "daniel", side: "right", from: 330, to: 479, pose: "hold", prop: "phone", gesture: "point", point: "left", gestureAt: at("c085", "link") - 2, expression: "focused" },
    { who: "daniel", side: "right", from: 480, to: 600, pose: "crossed", expression: "confident" },
  ];
  const overlays = [
    { text: "cargoflow-mcp.adoranto737.workers.dev/mcp", from: 6, to: 84 },
    { text: "Remote MCP server · custom connector", from: 90, to: 238 },
    { text: "Unsigned · you sign in your wallet", from: at("c085", "prepares"), to: 478 },
    { text: "No private keys, ever.", from: at("c086", "It"), to: 600 },
  ];
  return <DemoShell shots={S07_SHOTS(at)} cast={cast} overlays={overlays} />;
};
