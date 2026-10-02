import { cx } from "./cx";

/** A placeholder block. Its own `rounded-*` or `bg-*` class replaces the default corner or tint (e.g. rounded-full for a pill, bg-paper/15 on navy). */
export function Skeleton({ className }: { className?: string }) {
  const own = (prefix: string) => className?.split(" ").some((c) => c.startsWith(prefix));
  return <span aria-hidden="true" className={cx("block animate-pulse", !own("rounded") && "rounded-lg", !own("bg-") && "bg-ink/8", className)} />;
}
