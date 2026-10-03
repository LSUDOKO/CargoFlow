"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CopyField } from "@/components/ui/CopyField";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge, type BadgeVariant } from "@/components/ui/Pill";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import type { AuditEntry } from "@/lib/api/schemas";
import { auditTitle, dayKey } from "./auditWords";

const filters = [
  { id: "all", label: "Everything" },
  { id: "chain_event", label: "On-chain" },
  { id: "epoch", label: "Evidence" },
  { id: "monitoring", label: "Monitor" },
  { id: "action", label: "Transactions" },
];
const kindWord: Record<string, string> = { chain_event: "On-chain", epoch: "Evidence", monitoring: "Monitor", action: "Transaction" };
const kindVariant: Record<string, BadgeVariant> = { chain_event: "neutral", epoch: "info", monitoring: "signal", action: "neutral" };
const PAGE = 60;

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** Short, readable facts from an entry's detail (amounts, ids, addresses), for the expanded row. */
function facts(e: AuditEntry): [string, string][] {
  const d = (e.detail ?? {}) as { args?: Record<string, unknown>; block?: number; key?: string; error?: string };
  const out: [string, string][] = [];
  const a = d.args ?? {};
  for (const [k, v] of Object.entries(a)) {
    if (k === "shipmentId") continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out.push([k, String(v)]);
  }
  if (typeof d.block === "number") out.push(["block", String(d.block)]);
  if (d.key) out.push(["key", d.key]);
  if (d.error) out.push(["error", d.error]);
  return out.slice(0, 8);
}

function Row({ e, chainId }: { e: AuditEntry; chainId?: number }) {
  const [open, setOpen] = useState(false);
  const { title, note } = auditTitle(e);
  const extra = facts(e);
  const expandable = !!e.txHash || extra.length > 0;
  const body = (
    <>
      <time className="num w-[4.75rem] shrink-0 text-small text-text-muted" dateTime={e.time}>{time(e.time)}</time>
      <span className="hidden w-28 shrink-0 sm:block">
        <Badge variant={kindVariant[e.kind] ?? "neutral"} size="sm" shape="square">{kindWord[e.kind] ?? e.kind}</Badge>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-caption text-text-muted">
          <span className="sm:hidden">{kindWord[e.kind] ?? e.kind}{note ? " · " : ""}</span>
          {note}
        </span>
      </span>
      {expandable && (
        <svg viewBox="0 0 16 16" className={cx("h-4 w-4 shrink-0 text-text-muted transition-transform duration-(--duration-fast)", open && "rotate-90")} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 3.5 4.5 4.5L6 12.5" />
        </svg>
      )}
    </>
  );
  return (
    <li className="group">
      {expandable ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 rounded-control px-2 py-2.5 text-left transition-colors duration-(--duration-fast) hover:bg-neutral-25 sm:items-center">
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-3 px-2 py-2.5 sm:items-center">{body}</div>
      )}
      {open && (
        <div className="mb-2 ml-2 animate-enter rounded-tile bg-surface-sunken p-3 sm:ml-[calc(4.75rem+0.75rem+0.5rem)]">
          {e.txHash && <CopyField value={e.txHash} kind="tx" chainId={chainId} size="sm" label="Transaction" />}
          {extra.length > 0 && (
            <dl className={cx("grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-caption", e.txHash && "mt-2.5")}>
              {extra.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-text-muted">{k}</dt>
                  <dd className={cx("min-w-0 truncate", /^0x[0-9a-f]{8,}/i.test(v) || /:0x/.test(v) ? "font-mono" : "num")} title={v}>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </li>
  );
}

/** Every event, decision and transaction, newest first, grouped by day; details and hashes open on demand. */
export function AuditTable({ entries, chainId }: { entries: AuditEntry[]; chainId?: number }) {
  const [f, setF] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const counts = Object.fromEntries(filters.map((x) => [x.id, x.id === "all" ? entries.length : entries.filter((e) => e.kind === x.id).length]));
  const all = [...entries].filter((e) => f === "all" || e.kind === f).sort((a, b) => b.time.localeCompare(a.time));
  const rows = all.slice(0, limit);
  const perDay = new Map<string, number>();
  for (const e of all) perDay.set(dayKey(e.time), (perDay.get(dayKey(e.time)) ?? 0) + 1);
  const groups: { key: string; label: string; items: AuditEntry[] }[] = [];
  for (const e of rows) {
    const k = dayKey(e.time);
    const g = groups.at(-1);
    if (g && g.key === k) g.items.push(e);
    else groups.push({ key: k, label: day(e.time), items: [e] });
  }
  return (
    <div>
      <Tabs label="Filter the audit trail" idBase="audit-" size="sm" tabs={filters.map((x) => ({ ...x, count: counts[x.id] }))} value={f} onChange={(v) => { setF(v); setLimit(PAGE); }} />
      <TabPanel id={f} idBase="audit-" className="mt-4">
        {rows.length === 0 ? (
          <EmptyState size="sm" frame="plain" title="Nothing recorded here yet" description="Entries of this kind appear as the shipment moves." />
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <h3 className="flex items-baseline justify-between gap-3 border-b border-border px-2 pb-2 text-small font-semibold text-ink">
                  {g.label}
                  <span className="num font-normal text-text-muted">{perDay.get(g.key)} {perDay.get(g.key) === 1 ? "event" : "events"}</span>
                </h3>
                <ul className="mt-1 flex flex-col">
                  {g.items.map((e, i) => <Row key={`${e.time}-${e.title}-${i}`} e={e} chainId={chainId} />)}
                </ul>
              </section>
            ))}
            {all.length > rows.length && (
              <Button variant="secondary" size="sm" className="self-start" onClick={() => setLimit((l) => l + PAGE * 2)}>
                Show {Math.min(PAGE * 2, all.length - rows.length)} older events
              </Button>
            )}
          </div>
        )}
      </TabPanel>
    </div>
  );
}
