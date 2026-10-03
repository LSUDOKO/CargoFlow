"use client";

import { Fx } from "./Fx";
import { LazyGroup, useNear } from "./Lazy";
import s from "./story.module.css";

/**
 * The scroll story's root. Captions are server-rendered; the six scenes mount together about a screen before the
 * section arrives (LazyGroup), and then the pin, scrub and per-scene animations attach (fx.ts → story).
 */
export function StoryMotion({ children }: { children: React.ReactNode }) {
  const [root, near] = useNear<HTMLDivElement>("100% 0px");
  return (
    <div ref={root} className={s.root}>
      <LazyGroup value={near}>{children}</LazyGroup>
      {near && <Fx kind="story" target={root} />}
    </div>
  );
}
