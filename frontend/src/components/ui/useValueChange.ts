"use client";

import { useEffect, useRef, useState } from "react";

/**
 * True for one animation cycle after `value` changes (never on first render), so live figures animate only when
 * they actually change. Pair with the `animate-update` class.
 */
export function useValueChange(value: unknown, ms = 320) {
  const prev = useRef(value);
  const [changed, setChanged] = useState(0);
  useEffect(() => {
    if (Object.is(prev.current, value)) return;
    prev.current = value;
    setChanged((n) => n + 1);
    const t = setTimeout(() => setChanged(0), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return changed;
}
