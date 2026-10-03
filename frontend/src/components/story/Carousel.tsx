"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";

const Chevron = ({ dir }: { dir: "left" | "right" }) => (
  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={dir === "left" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"} />
  </svg>
);

/**
 * A horizontal, snapping carousel: swipe or trackpad on touch, Previous / Next buttons, and arrow keys (plus Home /
 * End) when the track has focus. Slides are the server-rendered `<li>` children (give each `aria-roledescription=
 * "slide"` and an "n of m" label). `gridFrom="lg"` turns it into a plain grid from that breakpoint (the buttons
 * hide). The track scrolls inside itself, so the page never scrolls sideways.
 */
export function Carousel({
  label,
  itemLabel = "slide",
  children,
  gridFrom,
  className,
  trackClassName,
  heading,
}: {
  label: string;
  /** Used in the button names: "Previous person", "Next person". */
  itemLabel?: string;
  children: React.ReactNode;
  gridFrom?: "lg";
  className?: string;
  trackClassName?: string;
  /** Content shown at the start of the control row (a title, a count). */
  heading?: React.ReactNode;
}) {
  const track = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft >= max - 4 });
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    measure();
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [measure]);

  const go = (dir: number | "start" | "end") => {
    const el = track.current;
    if (!el) return;
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    if (dir === "start") return el.scrollTo({ left: 0, behavior });
    if (dir === "end") return el.scrollTo({ left: el.scrollWidth, behavior });
    const first = el.children[0] as HTMLElement | undefined;
    const gap = parseFloat(getComputedStyle(el).columnGap || "0") || 0;
    const step = first ? first.offsetWidth + gap : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * step, behavior });
  };

  const onKey = (e: React.KeyboardEvent) => {
    const k = { ArrowRight: 1, ArrowLeft: -1, Home: "start", End: "end" } as const;
    const v = k[e.key as keyof typeof k];
    if (v === undefined) return;
    e.preventDefault();
    go(v);
  };

  const hideOnGrid = gridFrom === "lg" ? "lg:hidden" : undefined;
  return (
    <div role="region" aria-roledescription="carousel" aria-label={label} className={cx("min-w-0", className)}>
      <div className={cx("mb-4 flex items-center justify-between gap-4", !heading && hideOnGrid)}>
        <div className="min-w-0">{heading}</div>
        <div className={cx("flex shrink-0 gap-2", hideOnGrid)}>
          <IconButton label={`Previous ${itemLabel}`} variant="secondary" size="md" onClick={() => go(-1)} disabled={edge.start}>
            <Chevron dir="left" />
          </IconButton>
          <IconButton label={`Next ${itemLabel}`} variant="secondary" size="md" onClick={() => go(1)} disabled={edge.end}>
            <Chevron dir="right" />
          </IconButton>
        </div>
      </div>
      <ul
        ref={track}
        tabIndex={0}
        aria-label={`${label}: use the arrow keys to move`}
        onKeyDown={onKey}
        className={cx(
          "scroll-x -mx-(--gutter) flex snap-x snap-mandatory scroll-px-(--gutter) gap-4 px-(--gutter) pb-2 focus-visible:-outline-offset-2",
          // fade the clipped edge while there is more to see
          !edge.end && "fade-x-end",
          gridFrom === "lg" && "lg:mx-0 lg:grid lg:snap-none lg:overflow-visible lg:px-0 lg:pb-0 lg:[mask-image:none]",
          trackClassName,
        )}
      >
        {children}
      </ul>
    </div>
  );
}
