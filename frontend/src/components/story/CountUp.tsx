"use client";

import { useRef } from "react";
import { Fx } from "./Fx";

/**
 * A whole number that counts up from zero the first time it scrolls into view, and eases to a new value when it
 * changes. The server and no-JS render show the final figure; reduced motion skips the count.
 */
export function CountUp({ value }: { value: number }) {
  const el = useRef<HTMLSpanElement>(null);
  return (
    <>
      <span ref={el}>{Math.round(value).toLocaleString()}</span>
      <Fx kind="count" target={el} options={{ value }} />
    </>
  );
}
