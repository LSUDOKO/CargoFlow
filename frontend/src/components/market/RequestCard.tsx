"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { cardClass } from "@/components/ui/Card";
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
    <article className={cardClass({ padded: false, interactive: true, className: "group relative flex h-full flex-col" })}>
      <div className="flex flex-col gap-2.5 p-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 truncate font-display text-h3">
            <Link href={`/market/${r.id}`} className="outline-none after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ink">
              {r.externalRef}
            </Link>
          </h3>
          <RequestStatusPill status={r.status} className="shrink-0" />
        </div>
        <RouteLabel route={r.route} className="text-sm font-medium text-ink/80" />
        <div><BandChip policy={r.policy} /></div>
      </div>

      <dl className="grid grid-cols-3 gap-3 border-y border-border px-5 py-4">
        <Term label="Seeking" sub="USDG">{formatUSDG(r.amount, { compact: true })}</Term>
        <Term label="Advance" sub={`of ${formatUSDG(r.invoiceValue, { compact: true })} invoice`}>{rate}%</Term>
        <Term label="Max fee" sub={`${r.milestoneCount} tranches`}>{pct(r.maxFeeBps)}</Term>
      </dl>

      <div className="flex flex-col gap-3 px-5 py-4">
        {r.pricing && r.status === "open" ? (
          <FeeBand pricing={r.pricing} maxFeeBps={r.maxFeeBps} compact />
        ) : (
          <p className="text-small text-text-muted">{best ? <>Best offer <span className="num font-semibold text-ink">{pct(best.feeBps)}</span></> : "No fee guidance for this request."}</p>
        )}
        {r.note && <p className="line-clamp-2 text-small text-ink/80">“{r.note}”</p>}
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 rounded-b-card border-t border-border bg-neutral-25 px-5 py-3">
        <div className="relative z-[1] flex min-w-0 flex-col gap-1">
          <PartyLink address={r.exporter} />
          <p className="text-caption text-text-muted">
            <span className="num">{r.offers.length}</span> offer{r.offers.length === 1 ? "" : "s"}
            {best && <>, best <span className="num font-semibold text-ink">{pct(best.feeBps)}</span></>}
            {" · "}
            <time dateTime={r.createdAt}>{age(r.createdAt)}</time>
          </p>
        </div>
        <div className="relative z-[1] shrink-0">
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
    <div className={cardClass({ padded: false, className: "flex flex-col" })}>
      <div className="flex flex-col gap-3 p-5">
        <div className="flex justify-between"><Skeleton className="h-6 w-40" /><Skeleton className="h-6 w-16 rounded-full" /></div>
        <Skeleton className="h-4 w-52" />
        <Skeleton className="h-6 w-36" />
      </div>
      <div className="grid grid-cols-3 gap-3 border-y border-border px-5 py-4">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}
      </div>
      <div className="px-5 py-4"><Skeleton className="h-3 w-full rounded-full" /></div>
      <div className="border-t border-border px-5 py-3"><Skeleton className="h-6 w-44" /></div>
    </div>
  );
}
