"use client";

import { useRef } from "react";
import { Fx } from "./Fx";

/**
 * Staggers the `[data-reveal]` children in as the block scrolls into view (desktop, motion allowed). Nothing is
 * hidden until GSAP runs, so without it, or under reduced motion, everything simply shows.
 */
export function Reveal({ children, className, media, stagger }: { children: React.ReactNode; className?: string; media?: string; stagger?: number }) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root} className={className}>
      {children}
      <Fx kind="reveal" target={root} options={{ media, stagger }} />
    </div>
  );
}
