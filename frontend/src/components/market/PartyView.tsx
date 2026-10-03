"use client";

import Link from "next/link";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatusPill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { useShipmentsFor, useShipmentViews } from "@/lib/api/hooks";
import { isUnavailable, useParty, type Party } from "@/lib/api/market";
import { useContracts } from "@/lib/chain/contracts";
import { explorerAddress } from "@/lib/explorer";
import { formatUSDG, shortHash } from "@/lib/format";
import { GradeBadge, gradeDescription } from "./PartyLink";

function sinceLabel(since: Party["since"]): string | null {
  if (since === null) return null;
  const d = typeof since === "number" ? new Date(since * (since < 1e12 ? 1000 : 1)) : new Date(since);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function PartyView({ address }: { address: string }) {
  const { data: party, isPending, error, refetch, isFetching } = useParty(address);
  const { chainId } = useContracts();
  const explorer = explorerAddress(chainId, address);
  const since = party ? sinceLabel(party.since) : null;

  return (
    <div className="container-page flex flex-col gap-6 py-10">
      <header className="surface-ink relative overflow-hidden rounded-[var(--radius-card)] bg-ink p-6 text-paper shadow-[var(--shadow-card)] md:p-10">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,#f7f9f4_1px,transparent_1px),linear-gradient(to_bottom,#f7f9f4_1px,transparent_1px)] [background-size:40px_40px]" aria-hidden="true" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-wide text-signal uppercase">Track record</p>
            <h1 className="mt-2 font-mono text-[clamp(1.6rem,4vw,2.8rem)] leading-none font-semibold tracking-tight">{shortHash(address, 6, 6)}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <span className="font-mono text-xs break-all text-paper/70">{address}</span>
              {since && <span className="text-paper/70">On CargoFlow since {since}</span>}
              {explorer && (
                <a href={explorer} target="_blank" rel="noreferrer" className="font-semibold text-signal underline-offset-2 hover:underline">
                  View on the explorer
                </a>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-2xl bg-paper/8 p-4 ring-1 ring-paper/12">
            {isPending ? <Skeleton className="h-16 w-16 rounded-2xl bg-paper/15" /> : <GradeBadge grade={party?.grade} size="lg" />}
            <div className="max-w-56">
              <p className="font-display text-lg font-semibold">{party ? (party.grade === "new" ? "New party" : `Grade ${party.grade}`) : "Grade"}</p>
              <p className="text-sm text-paper/70">{party ? gradeDescription(party.grade) : isPending ? "Reading the record…" : "No grade available"}</p>
            </div>
          </div>
        </div>
      </header>

      {isPending ? (
        <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 rounded-[var(--radius-card)]" />)}</div>
      ) : error ? (
        <Card className="text-center">
          <p className="font-display text-xl font-semibold">{isUnavailable(error) ? "Track records are not live on this backend yet" : "The track record could not be loaded"}</p>
          <p className="mx-auto mt-2 max-w-md text-slate">{isUnavailable(error) ? "The shipments this wallet is part of are still listed below." : error.message}</p>
          {!isUnavailable(error) && <Button className="mt-5" variant="secondary" onClick={() => refetch()} loading={isFetching}>Try again</Button>}
        </Card>
      ) : party ? (
        <div className="grid gap-4 md:grid-cols-3">
          <StatBlock
            title="As exporter"
            empty={party.exporter.shipments === 0}
            headline={[formatUSDG(party.exporter.volume, { compact: true }), "USDG invoiced"]}
            rows={[
              ["Shipments", party.exporter.shipments],
              ["Settled", party.exporter.settled],
              ["Active", party.exporter.active],
              ["Paused", party.exporter.paused],
              ["Disputed", party.exporter.disputed],
              ["Defaulted", party.exporter.defaulted],
              ["ZK recoveries", party.exporter.recoveries],
              ["Average evidence score", party.exporter.avgEvidenceScore === null ? "–" : party.exporter.avgEvidenceScore.toFixed(1)],
            ]}
          />
          <StatBlock
            title="As financier"
            empty={party.financier.facilities === 0}
            headline={[formatUSDG(party.financier.committed, { compact: true }), "USDG committed"]}
            rows={[
              ["Facilities", party.financier.facilities],
              ["Drawn by exporters", `${formatUSDG(party.financier.drawn, { compact: true })} USDG`],
              ["In escrow", `${formatUSDG(party.financier.inEscrow, { compact: true })} USDG`],
              ["Fees earned", `${formatUSDG(party.financier.feesEarned, { compact: true })} USDG`],
              ["Settled", party.financier.settled],
              ["Defaulted", party.financier.defaulted],
            ]}
          />
          <StatBlock
            title="As buyer"
            empty={party.buyer.shipments === 0}
            headline={[formatUSDG(party.buyer.paidVolume, { compact: true }), "USDG paid"]}
            rows={[
              ["Shipments", party.buyer.shipments],
              ["Settled", party.buyer.settled],
            ]}
          />
        </div>
      ) : null}

      <RecentShipments address={address} />
    </div>
  );
}

function StatBlock({ title, headline, rows, empty }: { title: string; headline: [string, string]; rows: [string, string | number][]; empty: boolean }) {
  return (
    <Card className="flex flex-col">
      <h2 className="text-sm font-semibold tracking-wide text-slate uppercase">{title}</h2>
      {empty ? (
        <p className="mt-3 flex-1 text-slate">No activity in this role yet.</p>
      ) : (
        <>
          <p className="mt-2 font-display text-4xl font-bold tabular">{headline[0]}</p>
          <p className="text-sm text-slate">{headline[1]}</p>
          <dl className="mt-5 flex flex-col divide-y divide-line text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-slate">{k}</dt>
                <dd className="font-mono font-semibold tabular">{v}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Card>
  );
}

function RecentShipments({ address }: { address: string }) {
  const { data, isPending } = useShipmentsFor(address);
  const list = (data?.shipments ?? []).slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 12);
  const views = useShipmentViews(list.map((s) => s.id));
  const a = address.toLowerCase();
  return (
    <Card>
      <CardHeader title="Recent shipments">
        <span className="text-sm text-slate">{data ? `${data.shipments.length} in total` : ""}</span>
      </CardHeader>
      {isPending ? (
        <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}</div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl bg-mist px-5 py-8 text-center">
          <p className="text-slate">This wallet is not a party to any shipment yet.</p>
          <div className="mt-4 flex justify-center"><LinkButton href="/market" variant="secondary" size="sm">Browse the market</LinkButton></div>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {list.map((s, i) => {
            const v = views[i]?.data;
            const role = s.exporter.toLowerCase() === a ? "Exporter" : s.buyer.toLowerCase() === a ? "Buyer" : "Financier";
            return (
              <li key={s.id}>
                <Link href={`/track/${s.id}`} className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3 sm:grid-cols-[minmax(0,1.5fr)_7rem_minmax(0,1fr)_7rem]">
                  <span className="truncate font-semibold group-hover:underline">{s.externalRef}</span>
                  <span className="justify-self-end sm:justify-self-start"><StatusPill status={v?.facility?.status ?? s.status} /></span>
                  <span className="text-sm text-slate">{role}</span>
                  <span className="justify-self-end font-mono text-sm font-semibold sm:col-auto">{formatUSDG(s.invoiceValue, { compact: true })} USDG</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
