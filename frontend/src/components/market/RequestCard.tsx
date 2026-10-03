"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { advanceRate, age, pct, rankOffers, roleOn, type MarketRequest } from "@/lib/api/market";
import { formatUSDG } from "@/lib/format";
import { useHydrated } from "@/lib/useHydrated";
import { useAccount } from "wagmi";
import { OfferModal } from "./OfferModal";
import { PartyLink } from "./PartyLink";
import { FeeBand } from "./FeeBand";
import { BandChip, RequestStatusPill, RouteLabel, Term } from "./RequestBits";

/** One financing request in the market grid. The reference link stretches over the card; inner controls sit above it. */
export function RequestCard({ request: r }: { request: MarketRequest }) {
  const { address } = useAccount();
  const hydrated = useHydrated();
  const [offering, setOffering] = useState(false);
  const role = roleOn(r, hydrated ? address : undefined);
  const best = rankOffers(r.offers)[0];
  const rate = advanceRate(r.amount, r.invoiceValue);
  const mineOffer = address && r.offers.some((o) => o.financier.toLowerCase() === address.toLowerCase());

  return (
    <article className="group relative flex h-full flex-col rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-card)] transition-[border-color,box-shadow] duration-200 hover:border-ink/35 hover:shadow-[var(--shadow-lift)]">
      <div className="flex flex-col gap-3 p-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-display text-xl font-semibold">
              <Link href={`/market/${r.id}`} className="outline-none after:absolute after:inset-0 after:rounded-[var(--radius-card)] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ink">
                {r.externalRef}
              </Link>
            </h3>
            <RouteLabel route={r.route} className="mt-1 text-sm font-medium text-ink/80" />
          </div>
          <RequestStatusPill status={r.status} className="shrink-0" />
        </div>
        <div><BandChip policy={r.policy} /></div>
      </div>

      <dl className="grid grid-cols-3 gap-3 border-y border-line px-5 py-4">
        <Term label="Seeking" sub="USDG">{formatUSDG(r.amount, { compact: true })}</Term>
        <Term label="Max fee" sub={best ? `best ${pct(best.feeBps)}` : "no offers yet"}>{pct(r.maxFeeBps)}</Term>
        <Term label="Tranches" sub="evidence-gated">{r.milestoneCount}</Term>
      </dl>

      <div className="flex flex-col gap-3 px-5 py-4">
        <div>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-semibold text-slate">Advance on a {formatUSDG(r.invoiceValue)} USDG invoice</span>
            <span className="font-mono font-semibold tabular">{rate}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-mist" aria-hidden="true">
            <div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(rate, 100)}%` }} />
          </div>
        </div>
        {r.pricing && r.status === "open" && <FeeBand pricing={r.pricing} maxFeeBps={r.maxFeeBps} compact />}
        {r.note && <p className="line-clamp-2 text-sm text-ink/75">“{r.note}”</p>}
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 rounded-b-[var(--radius-card)] border-t border-line bg-paper/60 px-5 py-3">
        <div className="relative z-10 flex min-w-0 flex-col gap-1">
          <PartyLink address={r.exporter} />
          <p className="text-xs text-slate">
            {r.offers.length} offer{r.offers.length === 1 ? "" : "s"} <span aria-hidden="true">·</span> <time dateTime={r.createdAt}>{age(r.createdAt)}</time>
          </p>
        </div>
        <div className="relative z-10 shrink-0">
          {r.status === "open" && role !== "exporter" && role !== "buyer" ? (
            <Button size="sm" variant="secondary" onClick={() => setOffering(true)}>{mineOffer ? "Change offer" : "Make an offer"}</Button>
          ) : role === "exporter" && r.status !== "closed" ? (
            <LinkButton size="sm" variant="secondary" href={`/market/${r.id}`}>{r.status === "open" ? `Review ${r.offers.length} offer${r.offers.length === 1 ? "" : "s"}` : "Next step"}</LinkButton>
          ) : null}
        </div>
      </div>
      {offering && <OfferModal request={r} open={offering} onClose={() => setOffering(false)} />}
    </article>
  );
}

export function RequestCardSkeleton() {
  return (
    <div className="flex flex-col rounded-[var(--radius-card)] border border-line bg-white">
      <div className="flex flex-col gap-3 p-5">
        <div className="flex justify-between"><Skeleton className="h-6 w-40 rounded-lg" /><Skeleton className="h-6 w-16 rounded-full" /></div>
        <Skeleton className="h-4 w-52 rounded-lg" />
        <Skeleton className="h-6 w-36 rounded-full" />
      </div>
      <div className="grid grid-cols-3 gap-3 border-y border-line px-5 py-4">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
      </div>
      <div className="px-5 py-4"><Skeleton className="h-3 w-full rounded-full" /></div>
      <div className="border-t border-line px-5 py-3"><Skeleton className="h-6 w-44 rounded-lg" /></div>
    </div>
  );
}
