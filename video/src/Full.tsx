import React from "react";
import {
  AbsoluteFill,
  CalculateMetadataFunction,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { Audio } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { z } from "zod";
import { Captions } from "./components/Captions";
import { withAutoMedia } from "./lib/media";
import { S0ColdOpen } from "./scenes/S0ColdOpen";
import { S1Problem } from "./scenes/S1Problem";
import { S2Insight } from "./scenes/S2Insight";
import { S3HowItWorks } from "./scenes/S3HowItWorks";
import { S4DemoSlot, demoSchema } from "./scenes/S4DemoSlot";
import { S5WhyRobinhood } from "./scenes/S5WhyRobinhood";
import { S6Proof } from "./scenes/S6Proof";
import { S7Outro } from "./scenes/S7Outro";

export const fullSchema = demoSchema.extend({
  /** Optional music/voice bed: path inside public/ or a URL. No copyrighted music. */
  audioSrc: z.string().optional(),
  audioVolume: z.number().min(0).max(1),
  showCaptions: z.boolean(),
});
export type FullProps = z.infer<typeof fullSchema>;

/** Scene lengths in frames at 30 fps. Shared with SCRIPT.md timings. */
export const SCENE_FRAMES = {
  S0: 240, // 0:00–0:08
  S1: 960, // 0:08–0:40
  S2: 540, // 0:40–0:58
  S3: 960, // 0:58–1:30
  S4: 2250, // 1:30–2:45 (default demo length)
  S5: 600, // 2:45–3:05
  S6: 300, // 3:05–3:15
  S7: 300, // 3:15–3:25
} as const;

/** Crossfade length. Each outgoing scene is extended by this much, so every scene still starts on its scripted second. */
export const T = 15;

export const fullDuration = (demoFrames: number) =>
  Object.values(SCENE_FRAMES).reduce((a, b) => a + b, 0) -
  SCENE_FRAMES.S4 +
  demoFrames;

/** First frame of S4 (1:30.0). */
export const S4_FROM =
  SCENE_FRAMES.S0 + SCENE_FRAMES.S1 + SCENE_FRAMES.S2 + SCENE_FRAMES.S3;
/** During S4 the caption bar rises this far, so it sits inside the browser frame instead of straddling its edge. */
const S4_CAPTION_LIFT = 40;

export const calculateFullMetadata: CalculateMetadataFunction<FullProps> = ({
  props,
}) => {
  // picks up public/demo/demo-75s.mp4 and public/audio/mix.wav when the props leave them empty
  const resolved = withAutoMedia(props);
  return {
    durationInFrames: fullDuration(resolved.demoDurationInFrames),
    props: resolved,
  };
};

const resolve = (src: string) =>
  /^https?:\/\//.test(src) ? src : staticFile(src);

export const Full: React.FC<FullProps> = (props) => {
  const frame = useCurrentFrame();
  const timing = linearTiming({ durationInFrames: T });
  const s4To = S4_FROM + props.demoDurationInFrames;
  const captionLift =
    S4_CAPTION_LIFT *
    interpolate(
      frame,
      [S4_FROM - T, S4_FROM, s4To, s4To + T],
      [0, 1, 1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
  const seq = (frames: number) => frames + T;
  return (
    <AbsoluteFill style={{ background: "#0B1B2B" }}>
      <TransitionSeries>
        <TransitionSeries.Sequence
          durationInFrames={seq(SCENE_FRAMES.S0)}
          name="S0 ColdOpen"
        >
          <S0ColdOpen />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence
          durationInFrames={seq(SCENE_FRAMES.S1)}
          name="S1 Problem"
        >
          <S1Problem />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence
          durationInFrames={seq(SCENE_FRAMES.S2)}
          name="S2 Insight"
        >
          <S2Insight />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence
          durationInFrames={seq(SCENE_FRAMES.S3)}
          name="S3 HowItWorks"
        >
          <S3HowItWorks />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence
          durationInFrames={seq(props.demoDurationInFrames)}
          name="S4 DemoSlot"
        >
          <S4DemoSlot
            demoSrc={props.demoSrc}
            demoDurationInFrames={props.demoDurationInFrames}
            demoTrimBeforeFrames={props.demoTrimBeforeFrames}
            demoMuted={props.demoMuted}
            labels={props.labels}
            raiseLabels={props.showCaptions}
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence
          durationInFrames={seq(SCENE_FRAMES.S5)}
          name="S5 WhyRobinhood"
        >
          <S5WhyRobinhood />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence
          durationInFrames={seq(SCENE_FRAMES.S6)}
          name="S6 Proof"
        >
          <S6Proof />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={timing} />
        <TransitionSeries.Sequence
          durationInFrames={SCENE_FRAMES.S7}
          name="S7 Outro"
        >
          <S7Outro />
        </TransitionSeries.Sequence>
      </TransitionSeries>
      {props.showCaptions && <Captions lift={captionLift} />}
      {props.audioSrc ? (
        <Audio src={resolve(props.audioSrc)} volume={props.audioVolume} />
      ) : null}
    </AbsoluteFill>
  );
};
