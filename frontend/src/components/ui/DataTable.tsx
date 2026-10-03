"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cx } from "./cx";
import { Skeleton } from "./Skeleton";

export type Align = "left" | "right" | "center";

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  /** Cell content. Defaults to String(row[key]). */
  cell?: (row: T, index: number) => React.ReactNode;
  /** Numbers: right-aligned with tabular numerals, in the header too. */
  numeric?: boolean;
  align?: Align;
  /** CSS width for the column, e.g. "8rem" or "30%". */
  width?: string;
  /** The row's title: first in the phone card, and the link target when rowHref is set. Defaults to the first column. */
  primary?: boolean;
  /** Hide on the phone card layout (secondary detail). */
  hideOnCard?: boolean;
  /** Label in the phone card; defaults to the header when it is a string. */
  cardLabel?: string;
  /** Makes the header a sort button. Give sortValue for anything that is not a plain string or number field. */
  sortable?: boolean;
  sortValue?: (row: T) => string | number | bigint;
};

export type SortState = { key: string; dir: "asc" | "desc" } | null;

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** Accessible name of the table. Visible when captionVisible. */
  caption: string;
  captionVisible?: boolean;
  loading?: boolean;
  loadingRows?: number;
  /** What to show when there are no rows (an EmptyState). */
  empty?: React.ReactNode;
  /** Each row links here: the primary cell becomes a link that covers the whole row. */
  rowHref?: (row: T) => string;
  /** compact 40px rows (logs, audit trails), regular 52px (default). */
  density?: "compact" | "regular";
  /** Constrain height: the body scrolls and the header stays put. Without it the table grows with the page. */
  maxHeight?: string;
  /** Controlled sort; leave out for built-in sorting. */
  sort?: SortState;
  onSortChange?: (s: SortState) => void;
  /** Switch to stacked cards below 640px (default true). */
  cards?: boolean;
  className?: string;
};

const alignClass = (c: { numeric?: boolean; align?: Align }) =>
  c.align === "center" ? "text-center" : c.align === "right" || c.numeric ? "text-right" : "text-left";

function defaultCell<T>(row: T, key: string): React.ReactNode {
  const v = (row as Record<string, unknown>)[key];
  return v === null || v === undefined ? "–" : String(v);
}

/**
 * The data table. Sticky header, right-aligned tabular numbers, row hover, loading and empty states, and a card
 * layout on phones. Use it for any list a user scans or compares; use KeyValue for one record's fields.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  captionVisible,
  loading,
  loadingRows = 5,
  empty,
  rowHref,
  density = "regular",
  maxHeight,
  sort: controlled,
  onSortChange,
  cards = true,
  className,
}: Props<T>) {
  const [internal, setInternal] = useState<SortState>(null);
  const sort = controlled !== undefined ? controlled : internal;
  const setSort = (s: SortState) => (onSortChange ? onSortChange(s) : setInternal(s));
  const primaryKey = (columns.find((c) => c.primary) ?? columns[0])?.key;

  const sorted = useMemo(() => {
    if (!sort || controlled !== undefined) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const val = col.sortValue ?? ((r: T) => (r as Record<string, unknown>)[col.key] as string | number);
    const out = [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const cmp = typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : x < y ? -1 : x > y ? 1 : 0;
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [rows, sort, columns, controlled]);

  const cellPad = density === "compact" ? "h-10 px-3" : "h-13 px-4";
  const isEmpty = !loading && rows.length === 0;

  const renderPrimary = (row: T, i: number, col: Column<T>) => {
    const content = col.cell ? col.cell(row, i) : defaultCell(row, col.key);
    if (!rowHref) return content;
    return (
      <Link href={rowHref(row)} className="font-semibold text-ink underline-offset-2 after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-offset-[-2px]">
        {content}
      </Link>
    );
  };

  const table = (
    <div
      className={cx(cards && "hidden sm:block", "relative overflow-auto")}
      style={maxHeight ? { maxHeight } : undefined}
      // a height-capped table scrolls on its own, so keyboard users must be able to focus and scroll it
      {...(maxHeight ? { role: "region", "aria-label": caption, tabIndex: 0 } : {})}
    >
      <table className="w-full border-separate border-spacing-0 text-sm" aria-busy={loading || undefined}>
        <caption className={captionVisible ? "mb-3 text-left font-display text-h3" : "sr-only"}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const ariaSort = active ? (sort!.dir === "asc" ? "ascending" : "descending") : c.sortable ? "none" : undefined;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort}
                  style={c.width ? { width: c.width } : undefined}
                  className={cx(
                    "sticky top-0 z-(--z-sticky) border-b border-border bg-neutral-25 text-xs font-semibold whitespace-nowrap text-text-muted",
                    density === "compact" ? "h-9 px-3" : "h-10 px-4",
                    alignClass(c),
                  )}
                >
                  {c.sortable ? (
                    <button
                      type="button"
                      onClick={() => setSort(active && sort!.dir === "desc" ? { key: c.key, dir: "asc" } : active && sort!.dir === "asc" ? null : { key: c.key, dir: "desc" })}
                      className={cx("inline-flex items-center gap-1 rounded-md hover:text-ink", (c.numeric || c.align === "right") && "flex-row-reverse", active && "text-ink")}
                    >
                      {c.header}
                      <svg viewBox="0 0 12 12" className={cx("h-3 w-3 transition-transform duration-(--duration-fast)", !active && "opacity-40", active && sort!.dir === "asc" && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 4.5 6 7.5 9 4.5" />
                      </svg>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: loadingRows }, (_, i) => (
              <tr key={`sk-${i}`}>
                {columns.map((c) => (
                  <td key={c.key} className={cx(cellPad, "border-b border-border")}>
                    <Skeleton className={cx("h-3.5", c.numeric ? "ml-auto w-16" : "w-3/4")} />
                  </td>
                ))}
              </tr>
            ))}
          {isEmpty && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10">
                {empty ?? <p className="text-center text-sm text-text-muted">Nothing to show yet.</p>}
              </td>
            </tr>
          )}
          {!loading &&
            sorted.map((row, i) => (
              <tr key={rowKey(row, i)} className={cx("group transition-colors duration-(--duration-fast) hover:bg-neutral-25", rowHref && "relative")}>
                {columns.map((c) => (
                  <td key={c.key} className={cx(cellPad, "border-b border-border align-middle group-last:border-b-0", alignClass(c), c.numeric && "num whitespace-nowrap")}>
                    {c.key === primaryKey ? renderPrimary(row, i, c) : c.cell ? c.cell(row, i) : defaultCell(row, c.key)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );

  if (!cards) return <div className={className}>{table}</div>;

  const cardCols = columns.filter((c) => c.key !== primaryKey && !c.hideOnCard);
  const primaryCol = columns.find((c) => c.key === primaryKey);
  return (
    <div className={className}>
      {table}
      <div className="sm:hidden">
        {captionVisible && <p className="mb-3 font-display text-h3">{caption}</p>}
        {isEmpty ? (
          empty ?? <p className="py-8 text-center text-sm text-text-muted">Nothing to show yet.</p>
        ) : (
          <ul aria-label={caption} aria-busy={loading || undefined} className="flex flex-col gap-2">
            {loading
              ? Array.from({ length: Math.min(loadingRows, 3) }, (_, i) => (
                  <li key={`sk-${i}`} className="rounded-tile border border-border bg-surface p-4">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="mt-3 h-3 w-full" />
                    <Skeleton className="mt-2 h-3 w-2/3" />
                  </li>
                ))
              : sorted.map((row, i) => (
                  <li key={rowKey(row, i)} className={cx("rounded-tile border border-border bg-surface p-4", rowHref && "relative active:bg-neutral-25")}>
                    {primaryCol && <div className="text-[0.9375rem] font-semibold">{renderPrimary(row, i, primaryCol)}</div>}
                    {cardCols.length > 0 && (
                      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                        {cardCols.map((c) => (
                          <div key={c.key} className="contents">
                            <dt className="text-text-muted">{c.cardLabel ?? (typeof c.header === "string" ? c.header : c.key)}</dt>
                            <dd className={cx("min-w-0 text-right", c.numeric && "num")}>{c.cell ? c.cell(row, i) : defaultCell(row, c.key)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </li>
                ))}
          </ul>
        )}
      </div>
    </div>
  );
}
