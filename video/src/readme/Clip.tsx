import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { P } from "../assets/palette";
import { CaptionsOn } from "../scenes-v2/kit";
import { SCENE_COMPONENTS } from "../scenes-v2/registry";
import { SceneId } from "../scenes-v2/timing";
import { F } from "../theme";

/**
 * README concept clips: a window of one film scene (no voice-over captions, no audio) above a
 * clean caption band. Laid out at 1920 x 1248 and rendered at --scale=0.375 (720 x 468), then
 * turned into a palette-optimised GIF by scripts in docs (see docs/assets/v3/README.md).
 */

export const CLIP_W = 1920;
export const SCENE_H = 1080;
export const BAND_H = 168;
export const CLIP_H = SCENE_H + BAND_H;

export type ClipSpec = {
  id: string;
  scene: SceneId;
  /** Scene-relative first frame and length (30 fps). */
  start: number;
  frames: number;
  step: string;
  title: string;
  sub: string;
  /** Optional crop of the 1920 x 1080 scene: top-left and width (height keeps 16:9). */
  crop?: { x: number; y: number; w: number };
};

// Windows chosen from the film's scene table (SCRIPT-v2.md) and contact sheets of each scene.
export const CLIPS: ClipSpec[] = [
  { id: "problem", scene: "S02", start: 195, frames: 240, step: "01", title: "A lender sees paperwork, not the container", sub: "So Daniel lends blind, or not at all." },
  { id: "facility", scene: "S05a", start: 150, frames: 240, step: "02", title: "Meera opens a facility, Daniel escrows USDG", sub: "registerShipment · setPolicy · createFacility · depositCapital · place-based milestones" },
  { id: "evidence", scene: "S05b", start: 270, frames: 240, step: "03", title: "Signed readings become a score and a fingerprint", sub: "Two probes fused, conflict measured · only the Poseidon root + score go on chain (commitEpoch)" },
  { id: "release", scene: "S05c", start: 30, frames: 240, step: "04", title: "Right evidence, right place: a tranche is paid", sub: "evaluateAndReleaseMilestone · wrong place waits · humidity and shock limits" },
  { id: "excursion", scene: "S05d", start: 240, frames: 240, step: "05", title: "Probes disagree, the score falls to 48, it pauses", sub: "pauseFinancing · the AI monitor can only make things stricter" },
  { id: "recovery", scene: "S05e", start: 262, frames: 240, step: "06", title: "A zero-knowledge proof resumes the facility", sub: "Proof ready → Meera signs → resumeWithProof · Groth16 · readings never revealed" },
  { id: "settlement", scene: "S05f", start: 60, frames: 240, step: "07", title: "One payment settles everyone", sub: "settle · 40,000 principal + 1,200 fee → Daniel · 58,800 residual → Meera" },
  { id: "title", scene: "S05f", start: 270, frames: 240, step: "08", title: "The bill of lading moves with the money", sub: "ERC-721 title released to Wei Lin in the same transaction · documents against payment" },
  { id: "cover", scene: "S05g", start: 90, frames: 240, step: "09", title: "If it goes wrong: default and parametric cover", sub: "CoverPool · N failed epochs in a row, proven from the EvidenceRegistry" },
  { id: "arbiter", scene: "S05g", start: 360, frames: 150, step: "10", title: "The arbiter resolves disputes, never releases money", sub: "DISPUTE role · resolve, resume or default · no release" },
  { id: "passkey", scene: "S06", start: 1380, frames: 219, step: "11", title: "Wei Lin signs in with a passkey and pays", sub: "Live testnet · ZeroDev Kernel smart account · three ERC-4337 user operations" },
  { id: "claude", scene: "S07", start: 250, frames: 186, step: "12", title: "CargoFlow inside Claude", sub: "Remote MCP · reads the fleet, explains a pause, prepares unsigned transactions" },
];

export const clipById = (id: string) => {
  const c = CLIPS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown clip ${id}`);
  return c;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const ReadmeClip: React.FC<{ id: string }> = ({ id }) => {
  const spec = clipById(id);
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const Comp = SCENE_COMPONENTS[spec.scene];
  // soft loop: fade the picture in from paper and back out, the caption band stays put
  const fade = Math.min(
    interpolate(frame, [0, 6], [0, 1], clamp),
    interpolate(frame, [durationInFrames - 8, durationInFrames - 1], [1, 0], clamp),
  );
  const crop = spec.crop ?? { x: 0, y: 0, w: 1920 };
  const s = CLIP_W / crop.w;
  return (
    <AbsoluteFill style={{ background: P.white }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: CLIP_W, height: SCENE_H, overflow: "hidden", background: P.paper }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: `scale(${s}) translate(${-crop.x}px, ${-crop.y}px)`, opacity: fade }}>
          <CaptionsOn.Provider value={false}>
            <Sequence from={-spec.start} name={`${spec.scene} @${spec.start}`}>
              <Comp />
            </Sequence>
          </CaptionsOn.Provider>
        </div>
      </div>
      <CaptionBand step={spec.step} title={spec.title} sub={spec.sub} />
    </AbsoluteFill>
  );
};

export const CaptionBand: React.FC<{ step: string; title: string; sub: string; top?: number }> = ({ step, title, sub, top = SCENE_H }) => (
  <div
    style={{
      position: "absolute",
      left: 0,
      top,
      width: CLIP_W,
      height: BAND_H,
      background: P.white,
      borderTop: `3px solid ${P.ink}`,
      display: "flex",
      alignItems: "center",
      gap: 36,
      padding: "0 64px",
      boxSizing: "border-box",
    }}
  >
    <div
      style={{
        flex: "none",
        width: 104,
        height: 104,
        borderRadius: 24,
        background: P.signal,
        color: P.ink,
        fontFamily: F.mono,
        fontWeight: 700,
        fontSize: 48,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {step}
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 54, letterSpacing: -1, color: P.ink, whiteSpace: "nowrap" }}>{title}</div>
      <div style={{ fontFamily: F.body, fontWeight: 500, fontSize: 32, color: P.slate, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
    </div>
  </div>
);
