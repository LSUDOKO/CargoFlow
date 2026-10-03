import { cx } from "./cx";

/** A keyboard key. Pass several keys to show a chord: <Kbd keys={["Ctrl", "K"]} />. */
export function Kbd({ keys, children, onDark, className }: { keys?: string[]; children?: React.ReactNode; onDark?: boolean; className?: string }) {
  const one = (k: React.ReactNode, i?: number) => (
    <kbd
      key={i}
      className={cx(
        "inline-grid h-5 min-w-5 place-items-center rounded-md px-1.5 font-mono text-micro leading-none font-semibold",
        onDark ? "bg-paper/12 text-paper ring-1 ring-paper/20 ring-inset" : "border-b border-border-strong bg-surface text-ink ring-1 ring-border-strong ring-inset",
        className,
      )}
    >
      {k}
    </kbd>
  );
  if (!keys) return one(children);
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k, i) => one(k, i))}
    </span>
  );
}
