"use client";

import { Callout } from "@/components/ui/Banner";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { CopyField } from "@/components/ui/CopyField";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { KeyValue } from "@/components/ui/KeyValue";
import { Badge, StatusPill } from "@/components/ui/Pill";
import { PageHeader, Section } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { useShipmentsFor, useShipmentViews } from "@/lib/api/hooks";
import type { Shipment } from "@/lib/api/schemas";
import { isUnavailable, useParty, type Party } from "@/lib/api/market";
import { useContracts } from "@/lib/chain/contracts";
import { formatUSDG } from "@/lib/format";
import { GradeBadge, gradeDescription } from "./PartyLink";

function sinceLabel(since: Party["since"]): string | null {
  if (since === null) return null;
  const d = typeof since === "number" ? new Date(since * (since < 1e12 ? 1000 : 1)) : new Date(since);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

type Role = { id: string; title: string; active: boolean; headline: string; headlineUnit: string; rows: [string, string | number][] };
const usdg = (v: string) => `${formatUSDG(v, { compact: true })} USDG`;

function roles(party: Party, insurer: boolean): Role[] {
  const out: Role[] = [
    {
      id: "exporter",
      title: "As exporter",
      active: party.exporter.shipments > 0,
      headline: formatUSDG(party.exporter.volume, { compact: true }),
      headlineUnit: "USDG invoiced",
      rows: [
        ["Shipments", party.exporter.shipments],
        ["Settled", party.exporter.settled],
        ["Active", party.exporter.active],
        ["Paused", party.exporter.paused],
        ["Disputed", party.exporter.disputed],
        ["Defaulted", party.exporter.defaulted],
        ...(party.exporter.cancelled ? ([["Cancelled before transit", party.exporter.cancelled]] as [string, number][]) : []),
        ["ZK recoveries", party.exporter.recoveries],
        ["Average evidence score", party.exporter.avgEvidenceScore === null ? "–" : `${party.exporter.avgEvidenceScore.toFixed(1)} / 100`],
      ],
    },
    {
      id: "financier",
      title: "As financier",
      active: party.financier.facilities > 0,
      headline: formatUSDG(party.financier.committed, { compact: true }),
      headlineUnit: "USDG committed",
      rows: [
        ["Facilities", party.financier.facilities],
        ["Drawn by exporters", usdg(party.financier.drawn)],
        ["In escrow", usdg(party.financier.inEscrow)],
        ["Fees earned", usdg(party.financier.feesEarned)],
        ["Settled", party.financier.settled],
        ["Defaulted", party.financier.defaulted],
        ...(party.financier.cancelled ? ([["Cancelled before transit", party.financier.cancelled]] as [string, number][]) : []),
      ],
    },
    {
      id: "buyer",
      title: "As buyer",
      active: party.buyer.shipments > 0,
      headline: formatUSDG(party.buyer.paidVolume, { compact: true }),
      headlineUnit: "USDG paid",
      rows: [
        ["Shipments", party.buyer.shipments],
        ["Settled", party.buyer.settled],
      ],
    },
  ];
  if (insurer) {
    out.push({
      id: "insurer",
      title: "As insurer",
      active: party.insurer.offered > 0,
      headline: formatUSDG(party.insurer.coverWritten, { compact: true }),
      headlineUnit: "USDG of default cover written",
      rows: [
        ["Facilities offered cover", party.insurer.offered],
        ["Active covers", party.insurer.active],
        ["Returned after settlement", party.insurer.released],
        ["Paid out after default", party.insurer.claimed],
        ...(party.insurer.triggered ? ([["Parametric payouts", party.insurer.triggered]] as [string, number][]) : []),
        ["Premiums earned", usdg(party.insurer.premiumsEarned)],
        ["Paid to financiers", usdg(party.insurer.paidOut)],
      ],
    });
  }
  return out;
}

const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);

export function PartyView({ address }: { address: string }) {
  const { data: party, isPending, error, refetch, isFetching } = useParty(address);
  const { chainId, contracts } = useContracts();
  // the insurer role appears on a deployment with default cover, or for anyone who has written cover
  const insurer = !!party && (!!contracts?.coverPool || party.insurer.offered > 0);
  const since = party ? sinceLabel(party.since) : null;
  const all = party ? roles(party, insurer) : [];
  const active = all.filter((r) => r.active);
  const idle = all.filter((r) => !r.active).map((r) => r.id);

  return (
    <div className="container-page py-(--space-page-y)">
      <PageHeader
        eyebrow="Track record"
        title="Party record"
        description="Every shipment and facility this wallet is part of on CargoFlow, read from the chain."
        meta={
          <>
            <CopyField value={address} label="Address" kind="address" chainId={chainId} display="full" className="max-w-full" />
            {since && <Badge variant="neutral" shape="square">On CargoFlow since {since}</Badge>}
          </>
        }
        actions={
          <div className="flex items-center gap-4 rounded-tile border border-border bg-surface p-4 shadow-1">
            {isPending ? <Skeleton className="h-14 w-14 rounded-tile" /> : <GradeBadge grade={party?.grade} size="lg" />}
            <div className="max-w-56">
              <p className="font-display text-h4">{party ? (party.grade === "new" ? "New party" : `Grade ${party.grade}`) : "Grade"}</p>
              <p className="text-small text-text-muted">{party ? gradeDescription(party.grade) : isPending ? "Reading the record…" : "No grade available"}</p>
            </div>
          </div>
        }
      />

      <div className="flex flex-col gap-10">
        {isPending ? (
          <div aria-busy="true" className="grid items-start gap-4 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-56 rounded-card" />)}</div>
        ) : error ? (
          <Callout
            variant={isUnavailable(error) ? "info" : "danger"}
            title={isUnavailable(error) ? "Track records are not live on this backend yet" : "The track record could not be loaded"}
            action={!isUnavailable(error) && <Button variant="secondary" size="sm" onClick={() => refetch()} loading={isFetching}>Try again</Button>}
          >
            {isUnavailable(error) ? "The shipments this wallet is part of are still listed below." : error.message}
          </Callout>
        ) : party ? (
          <Section title="Roles" description={active.length === 0 ? undefined : idle.length ? `No activity as ${listWords(idle)} yet.` : undefined}>
            {active.length === 0 ? (
              <EmptyState size="sm" title="No activity yet" description="This wallet has not exported, financed, bought or insured a shipment on CargoFlow." />
            ) : (
              <div className={active.length === 1 ? "" : "grid items-start gap-4 md:grid-cols-2"}>
                {active.map((r) => (
                  <Card key={r.id} as="section" aria-label={r.title}>
                    <CardHeader title={r.title} as="h3" />
                    <p className="num text-metric text-ink">
                      {r.headline}
                      <span className="ml-1.5 text-sm font-semibold tracking-normal text-text-muted">{r.headlineUnit}</span>
                    </p>
                    <KeyValue className="mt-4" dense layout={active.length === 1 ? "grid" : "inline"} columns={4} items={r.rows.map(([label, value]) => ({ label, value, numeric: true }))} />
                  </Card>
                ))}
              </div>
            )}
          </Section>
        ) : null}

        <RecentShipments address={address} />
      </div>
    </div>
  );
}

type Row = Shipment & { role: string; status: string };

function RecentShipments({ address }: { address: string }) {
  const { data, isPending } = useShipmentsFor(address);
  const list = (data?.shipments ?? []).slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 12);
  const views = useShipmentViews(list.map((s) => s.id));
  const a = address.toLowerCase();
  const rows: Row[] = list.map((s, i) => ({
    ...s,
    role: s.exporter.toLowerCase() === a ? "Exporter" : s.buyer.toLowerCase() === a ? "Buyer" : "Financier",
    status: views[i]?.data?.facility?.status ?? s.status,
  }));
  const columns: Column<Row>[] = [
    { key: "ref", header: "Shipment", primary: true, cell: (s) => s.externalRef },
    { key: "role", header: "Role" },
    { key: "status", header: "Status", cell: (s) => <StatusPill status={s.status} /> },
    { key: "invoice", header: "Invoice", numeric: true, cell: (s) => <>{formatUSDG(s.invoiceValue)} <span className="text-text-muted">USDG</span></> },
    { key: "created", header: "Registered", hideOnCard: true, cell: (s) => <span className="num text-text-muted">{new Date(s.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span> },
  ];
  return (
    <Section title="Recent shipments" description={data ? `${data.shipments.length} in total; the 12 newest are listed.` : undefined}>
      {!isPending && rows.length === 0 ? (
        <EmptyState size="sm" title="Not a party to any shipment yet" description="Shipments this wallet exports, finances or buys appear here." action={<LinkButton href="/market" variant="secondary" size="sm">Browse the market</LinkButton>} />
      ) : (
        <Card padded={false} className="overflow-hidden max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none">
          <DataTable caption="Recent shipments of this party" columns={columns} rows={rows} rowKey={(s) => s.id} rowHref={(s) => `/track/${s.id}`} loading={isPending} loadingRows={3} />
        </Card>
      )}
    </Section>
  );
}
