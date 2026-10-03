import { cx } from "./cx";

export type KeyValueItem = {
  label: React.ReactNode;
  value: React.ReactNode;
  /** A short qualifier under the value (a limit, a source). */
  hint?: React.ReactNode;
  /** Right-align with tabular numerals (inline layout). */
  numeric?: boolean;
  /** Stable key when labels are not strings. */
  id?: string;
};

type Props = {
  items: KeyValueItem[];
  /** inline: label left, value right, ruled rows (summaries, waterfalls). stacked: label above value (detail panels). grid: stacked items in columns (headers, overviews). */
  layout?: "inline" | "stacked" | "grid";
  /** Columns for the grid layout from md (1 on phones, 2 from sm). */
  columns?: 2 | 3 | 4;
  /** Label column width for inline layout. */
  labelWidth?: string;
  onDark?: boolean;
  dense?: boolean;
  className?: string;
};

const gridCols = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 md:grid-cols-3", 4: "sm:grid-cols-2 md:grid-cols-4" } as const;

/** One record's fields, as a description list. For many records with the same fields, use DataTable. */
export function KeyValue({ items, layout = "inline", columns = 3, labelWidth, onDark, dense, className }: Props) {
  const muted = onDark ? "text-paper/70" : "text-text-muted";
  if (layout === "inline") {
    return (
      <dl className={cx("divide-y", onDark ? "divide-border-ink" : "divide-border", className)}>
        {items.map((it, i) => (
          <div key={it.id ?? (typeof it.label === "string" ? it.label : i)} className={cx("flex items-baseline justify-between gap-4", dense ? "py-1.5" : "py-2.5")} >
            <dt className={cx("shrink-0 text-sm", muted)} style={labelWidth ? { width: labelWidth } : undefined}>{it.label}</dt>
            <dd className={cx("min-w-0 text-right text-sm font-medium", it.numeric && "num whitespace-nowrap")}>
              {it.value}
              {it.hint && <span className={cx("block text-caption font-normal", muted)}>{it.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className={cx(layout === "grid" ? cx("grid grid-cols-1 gap-x-6 gap-y-4", gridCols[columns]) : cx("flex flex-col", dense ? "gap-2" : "gap-4"), className)}>
      {items.map((it, i) => (
        <div key={it.id ?? (typeof it.label === "string" ? it.label : i)} className="min-w-0">
          <dt className={cx("text-small", muted)}>{it.label}</dt>
          <dd className={cx("mt-0.5 text-sm font-medium break-words", it.numeric && "num")}>
            {it.value}
            {it.hint && <span className={cx("block text-caption font-normal", muted)}>{it.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
