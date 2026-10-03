"use client";

import { createPortal } from "react-dom";
import { useHydrated } from "@/lib/useHydrated";

/**
 * Renders overlays (dialogs, drawers, sheets) straight into document.body, so they never inherit the text colour,
 * stacking context or overflow clipping of wherever they were opened from (the navy header sets paper text).
 * The wrapper resets them to the light surface.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const mounted = useHydrated();
  if (!mounted) return null;
  return createPortal(<div className="surface-light text-ink">{children}</div>, document.body);
}
