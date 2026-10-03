"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount } from "wagmi";
import { Callout } from "@/components/ui/Banner";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Field";
import { PageHeader, Section } from "@/components/ui/Section";
import { Tabs } from "@/components/ui/Tabs";
import { acceptedOffer, pct, rankOffers, REQUEST_STATUSES, sortRequests, useMarket, type MarketRequest, type MarketSort, type RequestStatus } from "@/lib/api/market";
import { formatUSDG } from "@/lib/format";
import { useHydrated } from "@/lib/useHydrated";
import { RequestCard, RequestCardSkeleton } from "./RequestCard";
import { RequestStatusPill } from "./RequestBits";

const tabLabel: Record<RequestStatus, string> = { open: "Open", accepted: "Accepted", funded: "Funded", closed: "Closed" };

const marketIcon = (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
  </svg>
);

/** How a request becomes a facility, for the empty market. */
const steps = [
  { id: "post", title: "An exporter posts a shipment", description: "A registered shipment with a frozen cold-chain policy, the amount and the most they will pay." },
  { id: "offer", title: "Financiers offer a fee", description: "Each offer is a signed message, ranked by fee. Nothing moves yet." },
  { id: "open", title: "The exporter opens the facility", description: "Accepting one offer opens an escrowed facility naming that financier." },
];

export function MarketView() {
  const m = useMarket();
  const { address } = useAccount();
  const hydrated = useHydrated();
  const [tab, setTab] = useState<RequestStatus>("open");
  const [sort, setSort] = useState<MarketSort>("newest");
  const open = m.byStatus.open;
  const sought = open.reduce((s, r) => s + BigInt(r.amount), 0n);
  const offers = open.reduce((s, r) => s + r.offers.length, 0);
  const bestFees = open.map((r) => rankOffers(r.offers)[0]?.feeBps).filter((x): x is number => x !== undefined);
  const mine = hydrated && address ? m.all.filter((r) => r.exporter.toLowerCase() === address.toLowerCase() && r.status !== "closed") : [];
  const shown = sortRequests(m.byStatus[tab], sort);
  const summary = open.length
    ? `${open.length} open, seeking ${formatUSDG(sought, { compact: true })} USDG. ${offers} offer${offers === 1 ? "" : "s"} on the table${bestFees.length ? `, best fee ${pct(Math.min(...bestFees))}` : ""}.`
    : undefined;

  return (
    <div className="container-page py-(--space-page-y)">
      <PageHeader
        eyebrow="Financing market"
        title="Fund cargo that proves itself"
        description="Exporters post registered shipments with a locked cold-chain policy. Financiers compete on the fee."
        actions={<LinkButton href="/market/new">Request financing</LinkButton>}
      />

      <div className="flex flex-col gap-10">
        {mine.length > 0 && <MyRequests list={mine} />}

        <Section title="Requests" description={m.isPending ? "Loading the market…" : summary ?? "Every request financiers can price, by status."}>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Tabs
              label="Filter requests by status"
              idBase="market-"
              controls={false}
              tabs={REQUEST_STATUSES.map((s) => ({ id: s, label: tabLabel[s], count: m.isPending ? undefined : m.byStatus[s].length }))}
              value={tab}
              onChange={(t) => setTab(t as RequestStatus)}
            />
            <Select label="Sort requests" hideLabel value={sort} onChange={(e) => setSort(e.target.value as MarketSort)} className="sm:w-52">
              <option value="newest">Newest first</option>
              <option value="amount">Largest amount</option>
              <option value="fee">Highest max fee</option>
            </Select>
          </div>

          {m.isPending ? (
            <div role="status" aria-label="Loading requests" className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => <RequestCardSkeleton key={i} />)}
            </div>
          ) : m.unavailable ? (
            <EmptyState
              icon={marketIcon}
              title="The market is not live on this backend yet"
              description="This deployment's API does not serve financing requests yet. Shipments and facilities still work from the exporter and financier portals."
              action={<LinkButton href="/financier" variant="secondary">Open the financier portal</LinkButton>}
            />
          ) : m.error && m.all.length === 0 ? (
            <Callout variant="danger" title="The market could not be loaded" action={<Button variant="secondary" size="sm" onClick={() => void m.refetch()}>Try again</Button>}>
              {m.error.message}
            </Callout>
          ) : shown.length === 0 ? (
            tab === "open" ? (
              <Card padded="lg" className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center">
                <EmptyState
                  frame="plain"
                  className="items-start px-0 py-0 text-left md:py-0"
                  icon={marketIcon}
                  title="No open requests right now"
                  description="When an exporter posts a registered shipment for financing, it appears here for every financier to price."
                  action={<LinkButton href="/market/new" variant="secondary">Post a shipment</LinkButton>}
                />
                <div className="min-w-0 rounded-tile bg-surface-sunken p-5">
                  <p className="eyebrow mb-4">How a request becomes a facility</p>
                  <ol className="flex flex-col gap-4">
                    {steps.map((s, i) => (
                      <li key={s.id} className="flex gap-3">
                        <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface text-sm font-semibold text-ink ring-1 ring-border-strong ring-inset" aria-hidden="true">{i + 1}</span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{s.title}</span>
                          <span className="mt-0.5 block text-small text-text-muted">{s.description}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </Card>
            ) : (
              <EmptyState
                size="sm"
                title={`No ${tabLabel[tab].toLowerCase()} requests`}
                description="Requests move here as offers are accepted, facilities are funded or exporters close them."
              />
            )
          ) : (
            <ul className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((r) => (
                <li key={r.id} className="min-w-0">
                  <RequestCard request={r} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

/** The connected exporter's own live requests: where each stands and its cheapest offer. */
function MyRequests({ list }: { list: MarketRequest[] }) {
  const columns: Column<MarketRequest>[] = [
    { key: "ref", header: "Request", primary: true, cell: (r) => r.externalRef },
    { key: "status", header: "Status", cell: (r) => <RequestStatusPill status={r.status} /> },
    { key: "amount", header: "Sought", numeric: true, cell: (r) => <>{formatUSDG(r.amount)} <span className="text-text-muted">USDG</span></> },
    {
      key: "offer",
      header: "Fee",
      numeric: true,
      cell: (r) => {
        const acc = acceptedOffer(r);
        const best = rankOffers(r.offers)[0];
        return acc ? <>{pct(acc.feeBps)} <span className="text-text-muted">accepted</span></> : best ? <>{pct(best.feeBps)} <span className="text-text-muted">best of {r.offers.length}</span></> : <span className="text-text-muted">No offers yet</span>;
      },
    },
    {
      key: "next",
      header: <span className="sr-only">Next step</span>,
      align: "right",
      hideOnCard: true,
      cell: (r) => (
        <Link href={`/market/${r.id}`} className="relative z-[1] text-sm font-semibold text-ink underline underline-offset-2">
          {r.status === "open" ? (r.offers.length ? "Review offers" : "View") : r.status === "accepted" ? "Open the facility" : "View"}
        </Link>
      ),
    },
  ];
  return (
    <Section title="Your requests" description="Offers are ranked by fee. Accept one, then open the facility on chain.">
      <Card padded={false} className="overflow-hidden max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none">
        <DataTable caption="Your financing requests" columns={columns} rows={list} rowKey={(r) => r.id} rowHref={(r) => `/market/${r.id}`} />
      </Card>
    </Section>
  );
}
