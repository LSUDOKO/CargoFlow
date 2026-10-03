import manifest from "../../public/footage/manifest.json";

/**
 * Every recording the v2 film expects, from SCRIPT-v2 shot lists R1-R4. A file dropped at
 * public/footage/<file> (then `node scripts/footage-manifest.mjs`) replaces the placeholder in
 * its slot. `seconds` is the on-screen slot length; record a little longer (handles) and set
 * `trimBefore` in the scene if the action starts late. Keep this table and
 * video/footage-shots.md in step.
 */

export type ShotId =
  | "R1-01"
  | "R1-02"
  | "R1-03"
  | "R1-04"
  | "R1-05"
  | "R1-06"
  | "R1-07"
  | "R1-08"
  | "R1-09"
  | "R1-10"
  | "R2-01"
  | "R2-02"
  | "R2-03"
  | "R2-04"
  | "R2-05"
  | "R3-02"
  | "R4-01"
  | "R4-02"
  | "R4-03";

export type Shot = { id: ShotId; list: string; scene: string; seconds: number; url: string; show: string[] };

export const SHOTS: Record<ShotId, Shot> = {
  "R1-01": { id: "R1-01", list: "R1 step 1", scene: "S06", seconds: 4.0, url: "cargoflow.adoranto737.workers.dev/", show: ["Landing hero, header with network + health pill", "One scroll notch to the track bar"] },
  "R1-02": { id: "R1-02", list: "R1 step 2", scene: "S06", seconds: 9.0, url: "cargoflow.adoranto737.workers.dev/exporter", show: ["Wizard: Shipment -> Cold-chain policy (Pharma template, 2-8 °C)", "Financing 20 / 5 / 3% -> Sign; three wallet pop-ups at 6x; toasts"] },
  "R1-03": { id: "R1-03", list: "R1 step 3", scene: "S06", seconds: 5.0, url: "cargoflow.adoranto737.workers.dev/financier", show: ["Facility card with settlement preview (20.6 / 9.4)", "Approve 20 USDG -> Deposit 20 USDG -> toast 'Facility funded'"] },
  "R1-04": { id: "R1-04", list: "R1 step 4", scene: "S06", seconds: 7.0, url: "cargoflow.adoranto737.workers.dev/ebl", show: ["Issue bill of lading (document fingerprint, consignee)", "Shipment title card: Bind bill of lading -> 'In escrow'"] },
  "R1-05": { id: "R1-05", list: "R1 step 5", scene: "S06", seconds: 7.0, url: "cargoflow.adoranto737.workers.dev/track/…", show: ["Start transit; Submit readings result table", "'Passed: milestone released' x2; map live dot; M1, M2 released"] },
  "R1-06": { id: "R1-06", list: "R1 step 6", scene: "S06", seconds: 7.0, url: "cargoflow.adoranto737.workers.dev/track/…", show: ["Out-of-band warning -> 'Failed: facility paused', amber Paused pill", "Temperature chart (probe-1 above band); ExplainPanel"] },
  "R1-07": { id: "R1-07", list: "R1 step 7", scene: "S06", seconds: 7.0, url: "cargoflow.adoranto737.workers.dev/track/…", show: ["Bell 'Proof ready' -> Review and sign -> Resume with a proof", "'Groth16 proof verified on-chain'; pill Active"] },
  "R1-08": { id: "R1-08", list: "R1 step 8", scene: "S06", seconds: 7.3, url: "cargoflow.adoranto737.workers.dev/track/…", show: ["Continue with passkey -> 'Passkey account' badge", "From the passkey smart account: Confirm delivery; Approve 30 / Pay; 'Invoice paid and settled'"] },
  "R1-09": { id: "R1-09", list: "R1 step 9", scene: "S06", seconds: 3.5, url: "cargoflow.adoranto737.workers.dev/track/…", show: ["Download certificate -> settlement certificate PDF in a new tab"] },
  "R1-10": { id: "R1-10", list: "R1 step 10", scene: "S06", seconds: 5.2, url: "cargoflow.adoranto737.workers.dev/market", show: ["Open requests; Review offers", "Offer modal: Suggested fee band 7.25-10.25% (request max 4%), 3.8% typed, not sent"] },
  "R2-01": { id: "R2-01", list: "R2 step 1 (R3)", scene: "S07", seconds: 2.8, url: "cargoflow.adoranto737.workers.dev/developers", show: ["'Use CargoFlow in Claude' panel -> Copy URL", "cargoflow-mcp.adoranto737.workers.dev/mcp + copy confirmation"] },
  "R2-02": { id: "R2-02", list: "R2 step 2", scene: "S07", seconds: 5.2, url: "claude.ai/settings/connectors", show: ["Settings -> Connectors -> Add custom connector (CargoFlow, URL) -> Add", "New chat -> tools menu -> CargoFlow on"] },
  "R2-03": { id: "R2-03", list: "R2 step 3", scene: "S07", seconds: 3.0, url: "claude.ai/new", show: ["Prompt: 'Using CargoFlow, summarise the fleet risk and explain any paused shipment.'", "fleet_risk_summary + explain_shipment chips -> answer"] },
  "R2-04": { id: "R2-04", list: "R2 step 4", scene: "S07", seconds: 5.0, url: "claude.ai/chat/…", show: ["Prompt: 'Prepare the deposit for CF-SG-VAX-0202.' -> prepare_deposit", "Answer with two unsigned transactions + CargoFlow link -> app opens ready to sign"] },
  "R2-05": { id: "R2-05", list: "R2 step 5", scene: "S07", seconds: 4.0, url: "claude.ai/chat/…", show: ["Expand prepare_deposit tool result: {to, data, value, chainId}", "'Nothing has been sent.'"] },
  "R3-02": { id: "R3-02", list: "R3 step 2", scene: "S08", seconds: 10.0, url: "cargoflow.adoranto737.workers.dev/docs", show: ["Scalar API reference (OpenAPI 3.1) loads", "Scroll to a wallet-signed write; x-cargoflow-signed-message"] },
  "R4-01": { id: "R4-01", list: "R4 step 1", scene: "S10", seconds: 4.7, url: "cargoflow.adoranto737.workers.dev/track/0xc574…f9e5", show: ["CF-LIVE-1791029236301, Settled pill", "Five milestones released"] },
  "R4-02": { id: "R4-02", list: "R4 step 2", scene: "S10", seconds: 1.2, url: "explorer.testnet.chain.robinhood.com/tx/0x37571b49…", show: ["Settle transaction, Status Success"] },
  "R4-03": { id: "R4-03", list: "R4 step 3", scene: "S10", seconds: 4.1, url: "cargoflow.adoranto737.workers.dev/deployments", show: ["v3 contract list, verified marks"] },
};

type ManifestEntry = { bytes: number; durationSec?: number; width?: number; height?: number };
const FILES = manifest.files as Record<string, ManifestEntry>;

/**
 * Recorder clip for each slot (video/recorder/edit.mjs names clips by take, not by slot). R2-02..R2-05 are built from
 * the real claude.ai stills in public/footage/claude/ (see ClaudeStills.tsx), so they map to no clip.
 */
export const SLOT_FILE: Record<ShotId, string | null> = {
  "R1-01": "D1-landing.mp4",
  "R1-02": "D2-exporter-wizard.mp4",
  "R1-03": "D3-financier-funds.mp4",
  "R1-04": "D4-carrier-ebl.mp4",
  "R1-05": "D5-transit-releases.mp4",
  "R1-06": "D6-excursion-pause.mp4",
  "R1-07": "D7-recovery.mp4",
  "R1-08": "D8-buyer-passkey-settled.mp4",
  "R1-09": "D9-certificate.mp4",
  "R1-10": "D10-market.mp4",
  "R2-01": "M1-developers-copy-url.mp4",
  "R2-02": null,
  "R2-03": null,
  "R2-04": null,
  "R2-05": null,
  "R3-02": "R3-docs-reference.mp4",
  "R4-01": "R4a-track-settled.mp4",
  "R4-02": "R4a-explorer-tx.mp4",
  "R4-03": "R4b-deployments.mp4",
};

export const footageFile = (id: ShotId) => SLOT_FILE[id] ?? `${id}.mp4`;
export const hasFootage = (id: ShotId) => Boolean(FILES[footageFile(id)]);
export const footageInfo = (id: ShotId) => FILES[footageFile(id)];

/**
 * Seconds to skip at the head of a clip. Clips from recorder/edit.mjs start the action at 0 s (slot + 1 s tail);
 * an older-style clip with a 1 s handle at both ends (slot + 2 s, e.g. a re-recorded take cut to the old budget) is
 * detected by its length and trimmed by 1 s, so swapping a file needs only a manifest regen.
 */
export const headTrim = (id: ShotId) => {
  const d = footageInfo(id)?.durationSec;
  if (d === undefined) return 0;
  return d - SHOTS[id].seconds >= 1.75 ? 1 : 0;
};

/**
 * Slots assembled from several clips, played back to back (each part: file, seconds skipped at its head, frames on
 * screen, playback rate). Used only when every part is in the manifest; otherwise the slot falls back to SLOT_FILE.
 * R1-08: the live passkey sign-in (Connect -> Continue with passkey -> Create a passkey account -> "Passkey account"
 * badge; its background page was already settled, so only the modal part is used), then the settlement take, which
 * was paid from the CargoFlow demo wallet (passkey transactions were blocked by the ZeroDev bundler allowlist).
 * When a single clip with a passkey payment exists, delete this entry and point SLOT_FILE["R1-08"] at it.
 */
export type SlotPart = { file: string; trimBefore: number; frames: number; playbackRate?: number };
export const SLOT_PARTS: Partial<Record<ShotId, SlotPart[]>> = {
  // one live take: passkey sign-in, then confirm, approve and pay from the passkey smart account (8.3 s of content
  // before the 1 s tail handle, played at 1.13x to fill the 220-frame slot)
  "R1-08": [{ file: "D8-buyer-passkey-settled.mp4", trimBefore: 0, frames: 220, playbackRate: 1.13 }],
};
export const slotParts = (id: ShotId) => {
  const parts = SLOT_PARTS[id];
  return parts && parts.every((p) => FILES[p.file]) ? parts : null;
};
