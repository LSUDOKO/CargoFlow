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
  "R1-08": { id: "R1-08", list: "R1 step 8", scene: "S06", seconds: 7.3, url: "cargoflow.adoranto737.workers.dev/track/…", show: ["Continue with passkey -> OS passkey sheet; passkey account chip", "Confirm delivery; Approve 30 / Pay; 'Invoice paid and settled'; title 'With the buyer'"] },
  "R1-09": { id: "R1-09", list: "R1 step 9", scene: "S06", seconds: 3.5, url: "cargoflow.adoranto737.workers.dev/track/…", show: ["Download certificate -> settlement certificate PDF in a new tab"] },
  "R1-10": { id: "R1-10", list: "R1 step 10", scene: "S06", seconds: 5.2, url: "cargoflow.adoranto737.workers.dev/market", show: ["Open requests; Review offers", "Offer modal: Suggested fee band low / mid / high with reasons"] },
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

export const footageFile = (id: ShotId) => `${id}.mp4`;
export const hasFootage = (id: ShotId) => Boolean(FILES[footageFile(id)]);
export const footageInfo = (id: ShotId) => FILES[footageFile(id)];
