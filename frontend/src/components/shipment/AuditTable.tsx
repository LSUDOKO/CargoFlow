"use client";

import { useState } from "react";
import { HashBadge } from "@/components/ui/HashBadge";
import { Tabs } from "@/components/ui/Tabs";
import type { AuditEntry } from "@/lib/api/schemas";

const filters = [
  { id: "all", label: "Everything" },
  { id: "chain_event", label: "On-chain" },
  { id: "epoch", label: "Evidence" },
  { id: "monitoring", label: "Monitor" },
  { id: "action", label: "Transactions" },
];
const kindWord: Record<string, string> = { chain_event: "On-chain", epoch: "Evidence", monitoring: "Monitor", action: "Transaction" };

function title(e: AuditEntry) {
  // the backend numbers milestones from zero ("Epoch M2#1"); people count from one
  return e.title
    .replace(/^Epoch M(\d+)#(\d+)/, (_, m: string, seq: string) => (m === "255" ? `Observation #${seq}` : `Epoch for milestone ${Number(m) + 1} (#${seq})`)).replace(/^(\w+)\.(\w+)$/, "$2 · $1").replace(/_/g, " ").replace(/\b([A-Z]+)\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase());
}

export function AuditTable({ entries, chainId }: { entries: AuditEntry[]; chainId?: number }) {
  const [f, setF] = useState("all");
  const counts = Object.fromEntries(filters.map((x) => [x.id, x.id === "all" ? entries.length : entries.filter((e) => e.kind === x.id).length]));
  const rows = [...entries].filter((e) => f === "all" || e.kind === f).sort((a, b) => b.time.localeCompare(a.time)).slice(0, 80);
  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <Tabs label="Filter the audit trail" tabs={filters.map((x) => ({ ...x, count: counts[x.id] }))} value={f} onChange={setF} />
      </div>
      <ul id={`panel-${f}`} role="tabpanel" aria-labelledby={`tab-${f}`} className="mt-4 divide-y divide-line">
        {rows.map((e, i) => (
          <li key={`${e.time}-${i}`} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-4">
            <time className="w-20 shrink-0 font-mono text-xs text-slate" dateTime={e.time}>{new Date(e.time).toLocaleTimeString()}</time>
            <span className="w-24 shrink-0 text-xs font-semibold text-slate">{kindWord[e.kind] ?? e.kind}</span>
            <span className="min-w-0 flex-1 text-sm font-medium">{title(e)}</span>
            {e.txHash && <HashBadge value={e.txHash} kind="tx" chainId={chainId} />}
          </li>
        ))}
        {rows.length === 0 && <li className="py-6 text-slate">Nothing recorded in this category yet.</li>}
      </ul>
    </div>
  );
}
