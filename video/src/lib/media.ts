import { getStaticFiles } from "remotion";

/** Written by scripts/fit-demo.mjs: the founder's take cut to exactly 75.0 s (2250 frames). */
export const FITTED_DEMO = "demo/demo-75s.mp4";
export const FITTED_DEMO_FRAMES = 2250;
/** Written by scripts/mix.mjs: voice-over + ducked music (+ the demo's UI sound), mastered to -14 LUFS. */
export const FINAL_MIX = "audio/mix.wav";

const hasStatic = (name: string): boolean => {
  try {
    return getStaticFiles().some((f) => f.name === name);
  } catch {
    return false;
  }
};

type MediaProps = {
  demoSrc?: string;
  demoDurationInFrames: number;
  demoTrimBeforeFrames?: number;
  demoMuted?: boolean;
  audioSrc?: string;
  audioVolume?: number;
  autoMedia?: boolean;
};

/**
 * Fill empty media props from files the pipeline has produced (getStaticFiles lists public/ at bundle time):
 * - demoSrc "" and public/demo/demo-75s.mp4 exists -> play it, 2250 frames, no trim;
 * - audioSrc "" and public/audio/mix.wav exists     -> play it at volume 1 (it is already mastered), and mute the
 *   demo clip's own track (mix.mjs already folded any UI audio into the mix).
 * Explicit props always win. autoMedia: false keeps the placeholder / silence even when the files exist.
 */
export function withAutoMedia<P extends MediaProps>(props: P): P {
  if (props.autoMedia === false) return props;
  const next = { ...props };
  const autoDemo = !props.demoSrc && hasStatic(FITTED_DEMO);
  if (autoDemo) {
    next.demoSrc = FITTED_DEMO;
    next.demoDurationInFrames = FITTED_DEMO_FRAMES;
    next.demoTrimBeforeFrames = 0;
  }
  if (props.audioSrc === undefined || props.audioSrc === "") {
    if (hasStatic(FINAL_MIX)) {
      next.audioSrc = FINAL_MIX;
      next.audioVolume = 1;
      if (next.demoSrc === FITTED_DEMO) next.demoMuted = true;
    }
  }
  return next;
}
