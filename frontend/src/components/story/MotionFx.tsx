"use client";

import type { RefObject } from "react";
import { type FxKind, SETUPS } from "./fx";
import { useGSAP } from "./gsap";

export type FxOptions = { media?: string; stagger?: number; distance?: number; value?: number };

/** Runs one landing effect on `target` inside useGSAP (reverted on unmount and when its options change). */
export default function MotionFx({ kind, target, options = {} }: { kind: FxKind; target: RefObject<HTMLElement | null>; options?: FxOptions }) {
  useGSAP(
    () => {
      const el = target.current;
      if (!el) return;
      return (SETUPS[kind] as (el: HTMLElement, o: FxOptions) => () => void)(el, options);
    },
    { dependencies: [kind, options.media, options.stagger, options.distance, options.value], revertOnUpdate: true },
  );
  return null;
}
