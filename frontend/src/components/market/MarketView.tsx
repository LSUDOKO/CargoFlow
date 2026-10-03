"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount } from "wagmi";
import { Button, LinkButton } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { acceptedOffer, pct, rankOffers, REQUEST_STATUSES, sortRequests, useMarket, type MarketRequest, type MarketSort, type RequestStatus } from "@/lib/api/market";
import { formatUSDG } from "@/lib/format";
import { useHydrated } from "@/lib/useHydrated";
import { RequestCard, RequestCardSkeleton } from "./RequestCard";
import { RequestStatusPill } from "./RequestBits";

const tabLabel: Record<RequestStatus, string> = { open: "Open", accepted: "Accepted", funded: "Funded", closed: "Closed" };

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

  return (
    <div className="container-page py-10">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-wide text-slate uppercase">Financing market</p>
          <h1 className="mt-2 font-display text-[clamp(2.2rem,5vw,3.6rem)] leading-none font-bold tracking-[-0.04em]">Fund cargo that proves itself</h1>
          <p className="lede mt-3 text-slate">
            Exporters post registered shipments with a locked cold-chain policy. Financiers offer a fee; the exporter accepts one and opens an escrowed facility naming that financier.
          </p>
        </div>
        <LinkButton href="/market/new">Request financing</LinkButton>
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Open requests", m.isPending ? null : String(open.length)],
          ["Capital sought", m.isPending ? null : `${formatUSDG(sought, { compact: true })} USDG`],
          ["Offers on the table", m.isPending ? null : String(offers)],
          ["Best fee offered", m.isPending ? null : bestFees.length ? pct(Math.min(...bestFees)) : "–"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-[var(--radius-tile)] border border-line bg-white p-4 md:p-5">
            <dt className="text-sm font-semibold text-slate">{k}</dt>
            <dd className="mt-1 font-display text-2xl font-bold tabular md:text-3xl">{v ?? <span className="block h-8 w-20 animate-pulse rounded-lg bg-ink/8" />}</dd>
          </div>
        ))}
      </dl>

      {mine.length > 0 && <MyRequests list={mine} />}

      <div className="sticky top-[4.5rem] z-30 -mx-4 mt-8 flex flex-col gap-3 bg-paper/90 px-4 py-3 backdrop-blur-md md:mx-0 md:flex-row md:items-center md:justify-between md:rounded-2xl md:px-0">
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
          <Tabs label="Filter requests by status" tabs={REQUEST_STATUSES.map((s) => ({ id: s, label: tabLabel[s], count: m.isPending ? undefined : m.byStatus[s].length }))} value={tab} onChange={(t) => setTab(t as RequestStatus)} />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="market-sort" className="text-sm font-semibold text-slate">Sort</label>
          <select
            id="market-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as MarketSort)}
            className="h-11 rounded-full border-2 border-line bg-white px-4 text-sm font-semibold transition-colors outline-none focus:border-ink"
          >
            <option value="newest">Newest first</option>
            <option value="amount">Largest amount</option>
            <option value="fee">Highest max fee</option>
          </select>
        </div>
      </div>

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-4">
        {m.isPending ? (
          <div role="status" aria-label="Loading requests" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => <RequestCardSkeleton key={i} />)}
          </div>
        ) : m.unavailable ? (
          <Empty title="The market is not live on this backend yet" body="This deployment's API does not serve financing requests yet. Shipments and facilities still work from the exporter and financier portals.">
            <LinkButton href="/financier" variant="secondary">Open the financier portal</LinkButton>
          </Empty>
        ) : m.error && m.all.length === 0 ? (
          <Empty title="The market could not be loaded" body={m.error.message}>
            <Button variant="secondary" onClick={() => void m.refetch()}>Try again</Button>
          </Empty>
        ) : shown.length === 0 ? (
          <Empty
            title={tab === "open" ? "No open requests right now" : `No ${tabLabel[tab].toLowerCase()} requests`}
            body={tab === "open" ? "When an exporter posts a registered shipment for financing, it appears here for every financier to price." : "Requests move here as offers are accepted, facilities are funded or exporters close them."}
          >
            {tab === "open" && <LinkButton href="/market/new" variant="secondary">Post a shipment</LinkButton>}
          </Empty>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((r) => (
              <li key={r.id} className="animate-rise">
                <RequestCard request={r} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Empty({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-ink/20 bg-white/60 px-6 py-14 text-center">
      <svg viewBox="0 0 48 48" className="mx-auto h-12 w-12 text-ink/30" aria-hidden="true">
        <rect x="6" y="14" width="36" height="24" rx="4" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <path d="M6 22h36M14 30h8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <p className="mt-4 font-display text-xl font-semibold">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-slate">{body}</p>
      {children && <div className="mt-6 flex justify-center gap-2">{children}</div>}
    </div>
  );
}

/** The connected exporter's own live requests: where each stands and its cheapest offer. */
function MyRequests({ list }: { list: MarketRequest[] }) {
  return (
    <section aria-labelledby="my-requests" className="mt-8 rounded-[var(--radius-card)] bg-ink p-5 text-paper shadow-[var(--shadow-card)] surface-ink md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="my-requests" className="font-display text-xl font-semibold">Your requests</h2>
        <p className="text-sm text-paper/70">Offers are ranked by fee. Accept one, then open the facility on chain.</p>
      </div>
      <ul className="mt-4 divide-y divide-paper/10">
        {list.map((r) => {
          const best = rankOffers(r.offers)[0];
          const acc = acceptedOffer(r);
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 md:grid md:grid-cols-[minmax(0,12rem)_9rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <Link href={`/market/${r.id}`} className="min-w-40 truncate font-display text-lg font-semibold hover:underline">{r.externalRef}</Link>
              <span><RequestStatusPill status={r.status} onDark /></span>
              <span className="text-sm text-paper/75"><b className="font-mono text-paper">{formatUSDG(r.amount)}</b> USDG sought</span>
              <span className="text-sm text-paper/75">
                {acc ? <>accepted <b className="font-mono text-signal">{pct(acc.feeBps)}</b></> : best ? <>best of {r.offers.length}: <b className="font-mono text-signal">{pct(best.feeBps)}</b></> : "no offers yet"}
              </span>
              <Link href={`/market/${r.id}`} className="ml-auto text-sm font-semibold text-signal underline-offset-2 hover:underline">
                {r.status === "open" ? (r.offers.length ? "Review offers" : "View") : r.status === "accepted" ? "Open the facility" : "View"}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
