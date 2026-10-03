"use client";

import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { Callout } from "@/components/ui/Banner";
import { Button, LinkButton, buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Select } from "@/components/ui/Field";
import { StatusPill } from "@/components/ui/Pill";
import { PageHeader } from "@/components/ui/Section";
import { Stat } from "@/components/ui/Stat";
import { Tabs } from "@/components/ui/Tabs";
import { apiGet } from "@/lib/api/client";
import { useFleetPages } from "@/lib/api/hooks";
import { EpochList, ShipmentView } from "@/lib/api/schemas";
import { filterFleet, tabCounts, type FleetRow, type FleetSort, type FleetTab } from "@/lib/fleet";
import { formatUSDG, shortHash } from "@/lib/format";
import { useHydrated } from "@/lib/useHydrated";
import { ContainerDrawer } from "./ContainerDrawer";
import { Sparkline } from "./Sparkline";

const searchIcon = (
  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </svg>
);
const boxIcon = (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 8 12 3.5 20.5 8v8L12 20.5 3.5 16z" />
    <path d="M3.5 8 12 12.5 20.5 8M12 12.5v8" />
  </svg>
);

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
  const threshold = new Map(shipments.map((s) => [s.id, s.policy?.minEvidenceScore ?? 75]));
  const shown = filterFleet(rows, { tab, q, sort, dir, mine: mineOnly && address ? address : undefined });
  const counts = tabCounts(rows);
  const tabs = [
    { id: "active", label: "In transit", count: counts.active },
    { id: "paused", label: "Paused", count: counts.paused },
    { id: "settled", label: "Settled", count: counts.settled },
    { id: "all", label: "All", count: counts.all },
  ];

  // fleet-wide figures for the stat row
  const totals = rows.reduce((t, r) => ({ drawn: t.drawn + BigInt(r.drawn || "0"), committed: t.committed + BigInt(r.committed || "0") }), { drawn: 0n, committed: 0n });
  const scores = rows.map((r) => r.score).filter((s): s is number => s !== undefined);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const viewsLoading = views.some((v) => v.isPending);
  const clear = () => { setQ(""); setTab("all"); setMineOnly(false); };

  const columns: Column<FleetRow>[] = [
    {
      key: "ref",
      header: "Shipment",
      primary: true,
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{r.ref}</span>
          <span className="font-mono text-caption font-normal text-text-muted">{shortHash(r.id)}</span>
        </span>
      ),
    },
    { key: "status", header: "Status", cell: (r) => <StatusPill status={r.status} /> },
    {
      key: "drawn",
      header: "Capital drawn",
      numeric: true,
      cell: (r) =>
        r.committed !== "0" ? (
          <span>
            <span className="font-semibold text-ink">{formatUSDG(r.drawn)}</span>
            <span className="text-text-muted"> / {formatUSDG(r.committed)} USDG</span>
          </span>
        ) : (
          <span className="text-text-muted">No facility</span>
        ),
    },
    {
      key: "score",
      header: "Evidence score",
      cardLabel: "Evidence",
      cell: (r) => (
        <span className="inline-flex items-center gap-3">
          <Sparkline values={scoreSeries.get(r.id) ?? []} threshold={threshold.get(r.id)} />
          {r.score !== undefined && <span className="num w-7 text-right font-semibold">{r.score}</span>}
        </span>
      ),
    },
    {
      key: "go",
      header: <span className="sr-only">Dashboard</span>,
      align: "right",
      hideOnCard: true,
      width: "7.5rem",
      cell: (r) => (
        <Link href={`/track/${r.id}`} className={buttonClass("ghost", "xs")} aria-label={`Open the dashboard of ${r.ref}`}>
          Dashboard
        </Link>
      ),
    },
  ];

  return (
    <div className="container-page py-(--space-page-y)">
      <PageHeader
        title="Fleet"
        description="Every financed shipment, its evidence and the capital it has unlocked."
        actions={<LinkButton href="/exporter">Finance a new shipment</LinkButton>}
      />

      <div className="flex flex-col gap-6">
        {!isError && (isPending || rows.length > 0) && (
          <section aria-label="Fleet summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="In transit" value={counts.active} loading={isPending} hint="Facilities releasing on evidence" />
            <Stat label="Paused or disputed" value={counts.paused} loading={isPending} hint={counts.paused ? "Waiting on proof or the arbiter" : "Nothing held right now"} />
            <Stat label="Capital drawn" value={formatUSDG(totals.drawn, { compact: true })} unit="USDG" loading={isPending || viewsLoading} hint={`of ${formatUSDG(totals.committed, { compact: true })} USDG committed`} />
            <Stat label="Average evidence" value={avg === null ? "–" : avg.toFixed(0)} unit={avg === null ? undefined : "/ 100"} loading={isPending || viewsLoading} hint={scores.length ? `Latest batch, ${scores.length} shipment${scores.length === 1 ? "" : "s"}` : "No batches scored yet"} />
          </section>
        )}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs label="Filter by status" tabs={tabs} value={tab} onChange={(t) => setTab(t as FleetTab)} controls={false} className="lg:w-auto" />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Field label="Search shipments" hideLabel value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reference or id" prefix={searchIcon} type="search" className="sm:w-64" />
            <Select
              label="Sort by"
              hideLabel
              value={`${sort}:${dir}`}
              onChange={(e) => { const [s, d] = e.target.value.split(":"); setSort(s as FleetSort); setDir(d as "asc" | "desc"); }}
              className="min-w-0 sm:w-52"
            >
              <option value="created:desc">Newest first</option>
              <option value="created:asc">Oldest first</option>
              <option value="drawn:desc">Most capital drawn</option>
              <option value="score:asc">Weakest evidence</option>
              <option value="score:desc">Strongest evidence</option>
              <option value="status:asc">Status</option>
            </Select>
            {hydrated && address && (
              <button
                type="button"
                aria-pressed={mineOnly}
                onClick={() => setMineOnly((m) => !m)}
                className={cx(
                  "h-11 rounded-control border px-4 text-sm font-semibold whitespace-nowrap shadow-1 transition-colors duration-(--duration-fast)",
                  mineOnly ? "border-ink bg-ink text-paper" : "border-border-strong bg-surface hover:border-neutral-400",
                )}
              >
                My shipments
              </button>
            )}
          </div>
        </div>

        {isError ? (
          <Callout variant="danger" title="The fleet could not be loaded" action={<Button variant="secondary" size="sm" onClick={() => refetch()} loading={isFetching}>Try again</Button>}>
            {error.message}
          </Callout>
        ) : !isPending && shown.length === 0 ? (
          rows.length === 0 ? (
            <EmptyState
              icon={boxIcon}
              title="No shipments yet"
              description="Exporters register shipments and open facilities in the exporter portal; they appear here as soon as they are on chain."
              action={<LinkButton href="/exporter" variant="secondary">Open the exporter portal</LinkButton>}
            />
          ) : (
            <EmptyState
              icon={searchIcon}
              title="Nothing matches these filters"
              description="Try another tab, or clear the search to see the whole fleet."
              action={<Button variant="secondary" onClick={clear}>Clear filters</Button>}
            />
          )
        ) : (
          <>
            {/* a row opens the container drawer; the reference (a button) is the keyboard target */}
            <Card padded={false} className="overflow-hidden max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none">
              <DataTable
                caption="Shipments in the fleet"
                columns={columns}
                rows={shown}
                rowKey={(r) => r.id}
                onRowClick={(r) => setOpen(r.id)}
                rowClassName={(r) => (r.id === open ? "bg-neutral-25" : undefined)}
                loading={isPending}
                loadingRows={4}
              />
            </Card>
            {hasNextPage && (
              <div className="text-center">
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
