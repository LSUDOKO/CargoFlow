"use client";

import dynamic from "next/dynamic";

/**
 * The landing page's GSAP effects, split into their own chunk and fetched after hydration (no server render): the
 * page paints and becomes interactive without GSAP, then motion attaches. Every effect shares this one chunk.
 */
export const Fx = dynamic(() => import("./MotionFx"), { ssr: false, loading: () => null });
