"use client";

import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { Button, LinkButton } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { HashBadge } from "@/components/ui/HashBadge";
import { StatusPill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { apiGet } from "@/lib/api/client";
import { useFleetPages } from "@/lib/api/hooks";
import { EpochList, ShipmentView } from "@/lib/api/schemas";
import { filterFleet, tabCounts, type FleetRow, type FleetSort, type FleetTab } from "@/lib/fleet";
import { formatUSDG } from "@/lib/format";
import { useHydrated } from "@/lib/useHydrated";
import { ContainerDrawer } from "./ContainerDrawer";
import { Sparkline } from "./Sparkline";

export function FleetView() {
  const { data, isPending, isError, error, refetch, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage } = useFleetPages();
  const shipments = useMemo(() => data?.pages.flatMap((p) => p.shipments) ?? [], [data]);
  const views = useQueries({ queries: shipments.map((s) => ({ queryKey: ["shipment", s.id], queryFn: () => apiGet(`/v1/shipments/${s.id}`, ShipmentView), staleTime: 10_000 })) });
  const epochs = useQueries({ queries: shipments.map((s) => ({ queryKey: ["epochs", s.id], queryFn: () => apiGet(`/v1/shipments/${s.id}/epochs`, EpochList), staleTime: 15_000 })) });
  const [tab, setTab] = useState<FleetTab>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<FleetSort>("created");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [mineOnly, setMineOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { address } = useAccount();
  const hydrated = useHydrated();

  const rows: FleetRow[] = shipments.map((s, i) => {
    const v = views[i]?.data;
    return {
      id: s.id, ref: s.externalRef, status: v?.facility?.status ?? s.status, drawn: v?.facility?.drawn ?? "0", committed: v?.facility?.committed ?? "0",
      score: v?.latestEvidence?.score, created: s.createdAt, exporter: s.exporter, financier: v?.facility?.financier ?? s.financier ?? "", buyer: s.buyer,
    };
  });
  const scoreSeries = new Map(shipments.map((s, i) => [s.id, (epochs[i]?.data?.epochs ?? []).filter((e) => e.milestoneIndex !== 255).map((e) => e.score)]));
  const shown = filterFleet(rows, { tab, q, sort, dir, mine: mineOnly && address ? address : undefined });
  const counts = tabCounts(rows);
  const tabs = [
    { id: "active", label: "In transit", count: counts.active },
    { id: "paused", label: "Paused", count: counts.paused },
    { id: "settled", label: "Settled", count: counts.settled },
    { id: "all", label: "All", count: counts.all },
  ];

  return (
    <div className="container-page py-10">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-[clamp(2.2rem,5vw,3.6rem)] leading-none font-bold tracking-[-0.04em]">Fleet</h1>
          <p className="mt-3 max-w-xl text-lg text-slate">Every financed shipment, its evidence and the capital it has unlocked.</p>
        </div>
        <LinkButton href="/exporter">Finance a new shipment</LinkButton>
      </div>

      <div className="sticky top-[4.5rem] z-30 -mx-4 mt-8 flex flex-col gap-3 bg-paper/90 px-4 py-3 backdrop-blur-md md:mx-0 md:flex-row md:items-center md:justify-between md:rounded-2xl md:px-0">
        <div className="overflow-x-auto pb-1 [scrollbar-width:none]">
          <Tabs label="Filter by status" tabs={tabs} value={tab} onChange={(t) => setTab(t as FleetTab)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="fleet-q" className="sr-only">Search shipments</label>
          <input
            id="fleet-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search reference or id"
            className="h-11 w-full rounded-full border-2 border-line bg-white px-4 text-sm outline-none focus:border-ink sm:w-60"
          />
          <label htmlFor="fleet-sort" className="sr-only">Sort by</label>
          <select
            id="fleet-sort"
            value={`${sort}:${dir}`}
            onChange={(e) => { const [s, d] = e.target.value.split(":"); setSort(s as FleetSort); setDir(d as "asc" | "desc"); }}
            className="h-11 rounded-full border-2 border-line bg-white px-4 text-sm font-semibold outline-none focus:border-ink"
          >
            <option value="created:desc">Newest first</option>
            <option value="created:asc">Oldest first</option>
            <option value="drawn:desc">Most capital drawn</option>
            <option value="score:asc">Weakest evidence</option>
            <option value="score:desc">Strongest evidence</option>
            <option value="status:asc">Status</option>
          </select>
          {hydrated && address && (
            <button
              type="button"
              aria-pressed={mineOnly}
              onClick={() => setMineOnly((m) => !m)}
              className={cx("h-11 rounded-full border-2 px-4 text-sm font-semibold", mineOnly ? "border-ink bg-ink text-paper" : "border-line bg-white")}
            >
              My shipments
            </button>
          )}
        </div>
      </div>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-4">
        {isError ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-white p-10 text-center">
            <p className="font-display text-xl font-semibold">The fleet could not be loaded</p>
            <p className="mt-2 text-slate">{error.message}</p>
            <Button className="mt-5" onClick={() => refetch()} loading={isFetching}>Try again</Button>
          </div>
        ) : isPending ? (
          <div className="flex flex-col gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
        ) : shown.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-dashed border-ink/25 p-12 text-center">
            <p className="font-display text-2xl font-semibold">{rows.length === 0 ? "No shipments yet" : "Nothing matches these filters"}</p>
            <p className="mx-auto mt-2 max-w-md text-slate">
              {rows.length === 0 ? "Start one in the exporter portal, or run the live demo to watch a shipment go end to end." : "Try another tab or clear the search."}
            </p>
            <div className="mt-6 flex justify-center gap-2">
              {rows.length === 0 ? (
                <>
                  <LinkButton href="/demo">Run the live demo</LinkButton>
                  <LinkButton href="/exporter" variant="secondary">Open the exporter portal</LinkButton>
                </>
              ) : (
                <Button variant="secondary" onClick={() => { setQ(""); setTab("all"); setMineOnly(false); }}>Clear filters</Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <table className="hidden w-full border-separate border-spacing-y-2 text-left md:table">
              <thead>
                <tr className="text-sm text-slate">
                  <th className="px-5 font-semibold">Shipment</th>
                  <th className="font-semibold">Status</th>
                  <th className="font-semibold">Capital drawn</th>
                  <th className="font-semibold">Evidence</th>
                  <th className="pr-5 text-right font-semibold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="cursor-pointer bg-white shadow-[0_0_0_1px_var(--color-line)] transition-shadow hover:shadow-[0_0_0_2px_var(--color-ink)]" onClick={() => setOpen(r.id)}>
                    <td className="rounded-l-2xl px-5 py-4">
                      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(r.id); }} className="text-left font-semibold hover:underline">{r.ref}</button>
                      <div className="mt-1"><HashBadge value={r.id} compact /></div>
                    </td>
                    <td><StatusPill status={r.status} /></td>
                    <td className="font-mono text-sm">
                      {r.committed !== "0" ? <>{formatUSDG(r.drawn)} <span className="text-slate">/ {formatUSDG(r.committed)}</span></> : <span className="font-sans text-slate">No facility</span>}
                    </td>
                    <td><div className="flex items-center gap-3"><Sparkline values={scoreSeries.get(r.id) ?? []} /><span className="font-mono text-sm font-semibold">{r.score ?? "–"}</span></div></td>
                    <td className="rounded-r-2xl pr-5 text-right">
                      <Link href={`/track/${r.id}`} onClick={(e) => e.stopPropagation()} className="rounded-full px-3 py-2 text-sm font-semibold underline-offset-2 hover:underline">Dashboard</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="flex flex-col gap-3 md:hidden">
              {shown.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setOpen(r.id)} className="w-full rounded-2xl border border-line bg-white p-4 text-left">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-semibold">{r.ref}</span>
                      <StatusPill status={r.status} />
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="font-mono text-sm">{formatUSDG(r.drawn)} / {formatUSDG(r.committed)}</span>
                      <Sparkline values={scoreSeries.get(r.id) ?? []} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {hasNextPage && (
              <div className="mt-6 text-center">
                <Button variant="secondary" loading={isFetchingNextPage} onClick={() => fetchNextPage()}>Load more</Button>
              </div>
            )}
          </>
        )}
      </div>
      <ContainerDrawer id={open} onClose={() => setOpen(null)} />
    </div>
  );
}
