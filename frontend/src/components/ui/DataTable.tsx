"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cx } from "./cx";
import { Skeleton } from "./Skeleton";
import { useMediaQuery } from "./useMediaQuery";

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
  /** Hide the table column below this breakpoint (sm 640, md 768, lg 1024). Only matters for widths that show the table:
   * with `cards` on, "md" and "lg" drop the column on tablets; the phone cards follow `hideOnCard`. */
  hideBelow?: "sm" | "md" | "lg";
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
  /** Each row does something in place (opens a drawer): a click anywhere on the row or card calls it, except on links,
   * buttons and inputs inside it. The primary cell becomes a button, the keyboard and screen-reader target.
   * Use rowHref instead when the row goes to a page. */
  onRowClick?: (row: T) => void;
  /** Extra classes per row and per phone card, e.g. to mark the selected row. */
  rowClassName?: (row: T) => string | undefined;
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

const hideClass = { sm: "max-sm:hidden", md: "max-md:hidden", lg: "max-lg:hidden" } as const;
const INTERACTIVE = "a, button, input, select, textarea, label, summary, [role='button'], [role='link'], [contenteditable='true']";

/** A row click that did not land on a control inside the row, and is not the end of a text selection. */
function isRowClick(e: React.MouseEvent<HTMLElement>) {
  const hit = (e.target as HTMLElement).closest(INTERACTIVE);
  if (hit && e.currentTarget.contains(hit)) return false;
  return !(typeof window !== "undefined" && window.getSelection?.()?.toString());
}

const alignClass = (c: { numeric?: boolean; align?: Align }) =>
  c.align === "center" ? "text-center" : c.align === "right" || c.numeric ? "text-right" : "text-left";

function defaultCell<T>(row: T, key: string): React.ReactNode {
  const v = (row as Record<string, unknown>)[key];
  return v === null || v === undefined ? "–" : String(v);
}

/**
 * The data table. Sticky header, right-aligned tabular numbers, row hover, loading and empty states, and a card
 * layout on phones. Use it for any list a user scans or compares; use KeyValue for one record's fields.
 *
 * Phones get cards, wider screens the table. Server HTML (and the hydration pass) carries both, switched by CSS, so
 * there is no flash; once the viewport is known only the matching one stays in the DOM, so screen readers and text
 * queries never meet a row twice.
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
  onRowClick,
  rowClassName,
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
  // null until the viewport is known (server, hydration): render both variants and let CSS pick
  const wide = useMediaQuery("(min-width: 640px)");
  const showTable = !cards || wide !== false;
  const showCards = cards && wide !== true;

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
    if (!rowHref && onRowClick) {
      return (
        <button type="button" onClick={() => onRowClick(row)} className="max-w-full text-left font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline-offset-2">
          {content}
        </button>
      );
    }
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
                    c.hideBelow && hideClass[c.hideBelow],
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
                  <td key={c.key} className={cx(cellPad, "border-b border-border", c.hideBelow && hideClass[c.hideBelow])}>
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
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick && !rowHref ? (e) => isRowClick(e) && onRowClick(row) : undefined}
                className={cx("group transition-colors duration-(--duration-fast) hover:bg-neutral-25", rowHref && "relative", onRowClick && !rowHref && "cursor-pointer", rowClassName?.(row))}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cx(cellPad, "border-b border-border align-middle group-last:border-b-0", alignClass(c), c.numeric && "num whitespace-nowrap", c.hideBelow && hideClass[c.hideBelow])}>
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
  if (!showCards) return <div className={className}>{showTable && table}</div>;

  const cardCols = columns.filter((c) => c.key !== primaryKey && !c.hideOnCard);
  const primaryCol = columns.find((c) => c.key === primaryKey);
  return (
    <div className={className}>
      {showTable && table}
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
                  <li
                    key={rowKey(row, i)}
                    onClick={onRowClick && !rowHref ? (e) => isRowClick(e) && onRowClick(row) : undefined}
                    className={cx("rounded-tile border border-border bg-surface p-4", (rowHref || onRowClick) && "relative cursor-pointer active:bg-neutral-25", rowClassName?.(row))}
                  >
                    {primaryCol && <div className="text-body font-semibold">{renderPrimary(row, i, primaryCol)}</div>}
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
