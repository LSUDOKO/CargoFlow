"use client";

import { useRef } from "react";
import { Fx } from "./Fx";

/**
 * A slow vertical drift for a framed image as the page scrolls past it. Give the wrapper a slight scale (only when
 * motion is allowed) so the drift never shows an edge; transforms only, so it cannot shift layout or delay paint.
 */
export function Parallax({ children, className, distance }: { children: React.ReactNode; className?: string; distance?: number }) {
  const el = useRef<HTMLDivElement>(null);
  return (
    <div ref={el} className={className}>
      {children}
      <Fx kind="parallax" target={el} options={{ distance }} />
    </div>
  );
}
