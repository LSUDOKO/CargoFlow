"use client";

import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import { cx } from "./cx";

type Props = {
  /** Short supplementary text. Never put the only copy of essential information or interactive content here. */
  content: React.ReactNode;
  /** One focusable element (a button or link). It gets aria-describedby pointing at the tooltip. */
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  side?: "top" | "bottom";
  align?: "center" | "start" | "end";
  /** Hover delay in ms; focus opens at once. */
  delay?: number;
  className?: string;
};

/**
 * A hint on hover and keyboard focus (WAI-ARIA tooltip pattern): opens on focus or after a short hover, closes on
 * blur, mouse-out or Escape. It sits in a relative wrapper, so inside an overflow-hidden parent prefer side="bottom"
 * or a Popover.
 */
export function Tooltip({ content, children, side = "top", align = "center", delay = 300, className }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  if (!isValidElement(children)) return children;
  const existing = children.props["aria-describedby"];
  // focus handlers live on the wrapper (React focus events bubble), so the trigger keeps its own handlers untouched
  const trigger = cloneElement(children, { "aria-describedby": cx(existing, open && id) || undefined });
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => {
        clear();
        timer.current = setTimeout(() => setOpen(true), delay);
      }}
      onMouseLeave={() => {
        clear();
        setOpen(false);
      }}
      onFocus={() => {
        clear();
        setOpen(true);
      }}
      onBlur={() => {
        clear();
        setOpen(false);
      }}
    >
      {trigger}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cx(
            "pointer-events-none absolute z-(--z-tooltip) w-max max-w-64 animate-fade rounded-lg bg-ink px-2.5 py-1.5 text-left text-xs leading-snug font-medium text-paper shadow-2",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2",
            align === "center" ? "left-1/2 -translate-x-1/2" : align === "start" ? "left-0" : "right-0",
            className,
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
