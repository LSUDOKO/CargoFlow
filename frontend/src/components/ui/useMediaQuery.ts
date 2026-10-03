"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a media query matches, kept in sync with the window. Returns `null` while it is unknown: on the server, during
 * hydration and where `matchMedia` does not exist (jsdom). Render something that works for both answers in that case
 * (e.g. both layouts switched by CSS), then the matching one once the answer is known.
 */
export function useMediaQuery(query: string): boolean | null {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : null),
    () => null,
  );
}
