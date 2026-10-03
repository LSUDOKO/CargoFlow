import React from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { Audio } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { z } from "zod";
import { CaptionsV2 } from "./scenes-v2/CaptionsV2";
import { CaptionsOn } from "./scenes-v2/kit";
import { SCENE_COMPONENTS, TRANSITION_IN } from "./scenes-v2/registry";
import { SCENES, SceneId, TOTAL_FRAMES, scene } from "./scenes-v2/timing";
import { routeWipe } from "./scenes-v2/transitions";

/**
 * CargoFlow v2 film: 1920x1080, 30 fps, 9,840 frames (SCRIPT-v2.md), scenes in script order
 * with the script's transitions, audio = public/audio/mix-v2.wav.
 *
 * Every scene starts exactly on its scripted frame (the audio is placed against those frames).
 * A transition of d frames into scene B therefore extends scene A by d frames rather than
 * pulling B earlier: TransitionSeries starts B at (A.from + A.frames + d) - d = B.from.
 */

export const fullV2Schema = z.object({
  showCaptions: z.boolean(),
  audio: z.boolean(),
  audioVolume: z.number().min(0).max(1),
});

export type FullV2Props = z.infer<typeof fullV2Schema>;


export const FullV2: React.FC<FullV2Props> = ({ showCaptions, audio, audioVolume }) => (
  <CaptionsOn.Provider value={showCaptions}>
    <AbsoluteFill style={{ background: "#F7F9F4" }}>
      <TransitionSeries>
        {SCENES.map((s, i) => {
          const next = SCENES[i + 1];
          const tIn = next ? TRANSITION_IN[next.id] : undefined;
          const extra = tIn && tIn.kind !== "cut" ? tIn.frames : 0;
          const Comp = SCENE_COMPONENTS[s.id];
          return (
            <React.Fragment key={s.id}>
              <TransitionSeries.Sequence durationInFrames={s.frames + extra} name={`${s.id} · ${s.title}`}>
                <Comp />
              </TransitionSeries.Sequence>
              {tIn && tIn.kind === "wipe" ? <TransitionSeries.Transition presentation={routeWipe()} timing={linearTiming({ durationInFrames: tIn.frames })} /> : null}
              {tIn && tIn.kind === "fade" ? <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: tIn.frames })} /> : null}
            </React.Fragment>
          );
        })}
      </TransitionSeries>
      {showCaptions ? <CaptionsV2 /> : null}
      {audio ? <Audio src={staticFile("audio/mix-v2.wav")} volume={audioVolume} /> : null}
    </AbsoluteFill>
  </CaptionsOn.Provider>
);

export const FULL_V2_FRAMES = TOTAL_FRAMES;

/** One scene on its own, with captions and its slice of the mix (for review). */
export const SceneV2: React.FC<{ id: SceneId; showCaptions: boolean; audio: boolean }> = ({ id, showCaptions, audio }) => {
  const s = scene(id);
  const Comp = SCENE_COMPONENTS[id];
  return (
    <CaptionsOn.Provider value={showCaptions}>
      <AbsoluteFill style={{ background: "#F7F9F4" }}>
        <Comp />
        {showCaptions ? <CaptionsV2 offset={s.from} /> : null}
        {audio ? <Audio src={staticFile("audio/mix-v2.wav")} trimBefore={s.from} /> : null}
      </AbsoluteFill>
    </CaptionsOn.Provider>
  );
};
