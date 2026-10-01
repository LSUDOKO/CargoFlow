import { cx } from "./cx";

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("block animate-pulse rounded-xl bg-ink/8", className)} />;
}
