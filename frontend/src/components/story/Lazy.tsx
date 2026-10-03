"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

/**
 * Below-the-fold illustration is mounted on the client as it approaches the viewport, so the landing HTML carries
 * captions and reserved boxes instead of thousands of SVG nodes (the first paint stays as fast as before the cast
 * arrived). The box around a LazyMount must already have its final size (aspect-ratio or a fixed height), so
 * mounting never shifts layout. While mounted, the wrapper is marked `data-cast-offscreen` whenever it leaves the
 * viewport, which pauses the characters' CSS idle loops.
 */
const GroupNear = createContext<boolean | null>(null);

/** Lets a parent (the scroll story) mount all of its LazyMounts at once. */
export const LazyGroup = GroupNear.Provider;

/** True once `ref` comes within `rootMargin` of the viewport (stays true). */
export function useNear<T extends Element>(rootMargin = "600px 0px") {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // very old browsers: just show it
      const t = setTimeout(() => setNear(true));
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);
  return [ref, near] as const;
}

export function LazyMount({ children, className, rootMargin }: { children: React.ReactNode; className?: string; rootMargin?: string }) {
  const group = useContext(GroupNear);
  const [ref, nearSelf] = useNear<HTMLDivElement>(rootMargin);
  const show = group ?? nearSelf;
  useEffect(() => {
    const el = ref.current;
    if (!el || !show || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.target.toggleAttribute("data-cast-offscreen", !e.isIntersecting)), { rootMargin: "120px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, show]);
  return (
    <div ref={ref} className={className}>
      {show ? children : null}
    </div>
  );
}
