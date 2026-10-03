import { cx } from "./cx";

/**
 * A placeholder block shaped like the content it stands in for. Its own `rounded-*` or `bg-*` class replaces the
 * default corner or tint (e.g. rounded-full for a pill, bg-paper/15 on navy). Pair a loading region with
 * aria-busy="true" on its container; skeletons themselves are hidden from assistive tech.
 */
export function Skeleton({ className }: { className?: string }) {
  const own = (prefix: string) => className?.split(" ").some((c) => c.startsWith(prefix));
  return <span aria-hidden="true" className={cx("block animate-pulse", !own("rounded") && "rounded-lg", !own("bg-") && "bg-ink/8", className)} />;
}

/** Lines of text: the last one is shorter, like a real paragraph. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cx("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx("h-3.5", i === lines - 1 && lines > 1 ? "w-3/5" : "w-full")} />
      ))}
    </span>
  );
}
