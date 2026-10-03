"use client";

import Link from "next/link";
import { CastEmptyState } from "@/components/cast/CastEmptyState";
import { useAccount } from "wagmi";
import { PartyLink } from "@/components/market/PartyLink";
import { Portfolio } from "@/components/market/Portfolio";
import { PayAction } from "@/components/portal/PayAction";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusPill } from "@/components/ui/Pill";
import { Section } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { Stat } from "@/components/ui/Stat";
import { NetworkGuard } from "@/components/wallet/NetworkGuard";
import { useShipmentsFor, useShipmentViews } from "@/lib/api/hooks";
import type { ShipmentView } from "@/lib/api/schemas";
import { controllerAbi } from "@/lib/chain/abis";
import { useContracts } from "@/lib/chain/contracts";
import { useTx } from "@/lib/chain/useTx";
import { formatBps, formatUSDG } from "@/lib/format";
import { settlementPreview } from "@/lib/portal";

type Role = "financier" | "buyer";

const copy = {
  financier: {
    eyebrow: "For financiers",
    title: "Fund trade that proves itself",
    lede: "Your capital sits in a shipment-specific escrow and leaves it only when the cargo's evidence passes the agreed policy.",
    guard: "Funding a facility is a transaction from your financier wallet.",
    points: [
      "Deposit into escrow for facilities that name your wallet",
      "Watch each tranche release only on passing evidence",
      "Track committed capital, escrow and fees earned in one place",
    ],
    list: "Facilities you fund",
    empty: "No facility names this wallet as its financier yet. Offer on an open request in the market, or ask an exporter to open one with your address.",
  },
  buyer: {
    eyebrow: "For buyers",
    title: "Pay for cargo that arrived right",
    lede: "Confirm delivery and pay the invoice once. The vault repays the financier and pays the exporter the rest in one transaction.",
    guard: "Confirming delivery and paying the invoice are transactions from your buyer wallet.",
    points: [
      "Confirm delivery once every tranche has been released",
      "Pay the invoice into the vault in one transaction",
      "See exactly who receives what before you pay",
    ],
    list: "Shipments you buy",
    empty: "No shipment names this wallet as its buyer yet.",
  },
};

export function RolePortal({ role }: { role: Role }) {
  const c = copy[role];
  const { address } = useAccount();
  const { data, isPending } = useShipmentsFor(address);
  const ids = (data?.shipments ?? []).map((s) => s.id);
  const views = useShipmentViews(ids);
  const mine = views
    .map((q) => q.data)
    .filter((v): v is ShipmentView => !!v && !!address && !!v.facility && v.facility[role].toLowerCase() === address.toLowerCase());
  const loading = (isPending && !!address) || views.some((v) => v.isPending);
  return (
    <div className="container-page py-(--space-page-y)">
      <PortalHeader eyebrow={c.eyebrow} title={c.title} lede={c.lede} who={role === "financier" ? "daniel" : "weilin"} />
      <NetworkGuard purpose={c.guard} points={c.points}>
        <div className="flex flex-col gap-10">
          {role === "financier" && mine.length > 0 && <Portfolio views={mine} address={address} />}
          {role === "buyer" && mine.length > 0 && <BuyerStats views={mine} />}
          <Section title={c.list} description={mine.length ? "Newest first. Act on a shipment from its row; open the dashboard for the full record." : undefined}>
            {loading && mine.length === 0 ? (
              <Skeleton className="h-40 rounded-card" />
            ) : mine.length === 0 ? (
              <CastEmptyState
                who={role === "financier" ? "daniel" : "weilin"}
                prop={role === "financier" ? "phone" : "invoice"}
                title="Nothing here yet"
                description={c.empty}
                action={
                  <>
                    <LinkButton href="/shipments" variant="secondary">Browse the fleet</LinkButton>
                    {role === "financier" ? <LinkButton href="/market" variant="secondary">Find shipments to fund</LinkButton> : <LinkButton href="/exporter" variant="secondary">Open the exporter portal</LinkButton>}
                  </>
                }
              />
            ) : (
              <Card padded={false} as="div" className="overflow-hidden">
                <ul className="divide-y divide-border" aria-label={c.list}>
                  {mine.map((v) => (
                    <FacilityRow key={v.shipment.id} view={v} role={role} />
                  ))}
                </ul>
              </Card>
            )}
          </Section>
        </div>
      </NetworkGuard>
    </div>
  );
}

function BuyerStats({ views }: { views: ShipmentView[] }) {
  const fs = views.map((v) => ({ f: v.facility!, invoice: BigInt(v.shipment.invoiceValue) }));
  const due = fs.filter(({ f }) => f.status === "DELIVERED");
  const toConfirm = fs.filter(({ f }) => f.status === "ACTIVE" && f.nextMilestone >= f.milestoneCount).length;
  const paid = fs.filter(({ f }) => f.status === "SETTLED");
  const sum = (xs: { invoice: bigint }[]) => xs.reduce((s, x) => s + x.invoice, 0n);
  return (
    <section aria-label="Your purchases at a glance" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat label="Shipments" value={fs.length} hint="Naming this wallet as buyer" />
      <Stat label="Ready to confirm" value={toConfirm} hint="Every tranche released" />
      <Stat label="Invoices due" value={formatUSDG(sum(due), { compact: true })} unit="USDG" hint={`${due.length} delivered, unpaid`} />
      <Stat label="Paid" value={formatUSDG(sum(paid), { compact: true })} unit="USDG" hint={`${paid.length} settled`} />
    </section>
  );
}

function FacilityRow({ view, role }: { view: ShipmentView; role: Role }) {
  const f = view.facility!;
  const id = view.shipment.id as `0x${string}`;
  const unfunded = f.status === "CREATED" || f.status === "FINANCED";
  // before any capital moves, show the plan at full draw; afterwards, what paying now (or paying) actually does
  const preview = settlementPreview(unfunded ? { ...f, drawn: f.committed } : f, view.shipment.invoiceValue);
  const heading = f.status === "SETTLED" ? "Settled" : unfunded ? "When fully drawn and paid" : "If the invoice is paid today";
  const verb = f.status === "SETTLED" ? "received" : "receives";
  const { contracts } = useContracts();
  const { send, pending } = useTx();
  const allReleased = f.nextMilestone >= f.milestoneCount;
  const note =
    role === "financier"
      ? f.status === "CREATED" ? null : f.status === "SETTLED" ? "Repaid with the fee." : f.status === "CANCELLED" ? "Cancelled before transit: any deposit came back in full." : "Funded. Releases follow the evidence automatically."
      : f.status === "DELIVERED" || (f.status === "ACTIVE" && allReleased) ? null : f.status === "SETTLED" ? "Paid and settled." : f.status === "CANCELLED" ? "Cancelled before transit: nothing to pay." : "Delivery can be confirmed once every milestone is released.";
  return (
    <li className="grid gap-4 p-4 md:p-5 lg:grid-cols-12 lg:items-center">
      <div className="min-w-0 lg:col-span-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/track/${id}`} className="font-display text-h4 underline-offset-2 hover:underline">{view.shipment.externalRef}</Link>
          <StatusPill status={f.status} />
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-text-muted">
          <span className="num">Milestone {Math.min(f.nextMilestone + 1, f.milestoneCount)} of {f.milestoneCount}</span>
          <span className="inline-flex items-center gap-1.5">Exporter <PartyLink address={f.exporter} /></span>
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-3 text-sm lg:col-span-4">
        <div className="min-w-0"><dt className="text-small text-text-muted">Committed</dt><dd className="num font-semibold">{formatUSDG(f.committed)}<span className="text-text-muted"> USDG</span></dd></div>
        <div className="min-w-0"><dt className="text-small text-text-muted">Drawn</dt><dd className="num font-semibold">{formatUSDG(f.drawn)}<span className="text-text-muted"> USDG</span></dd></div>
        <div className="min-w-0"><dt className="text-small text-text-muted">Latest score</dt><dd className="num font-semibold">{view.latestEvidence ? <>{view.latestEvidence.score}<span className="font-normal text-text-muted"> · {formatBps(view.latestEvidence.riskBps)} risk</span></> : "–"}</dd></div>
      </dl>
      <div className="flex flex-col gap-3 lg:col-span-4 lg:items-end">
        <p className="text-small text-text-muted lg:text-right">
          <span className="font-semibold text-ink">{heading}:</span> financier {verb} <span className="num font-semibold text-ink">{formatUSDG(preview.financier)}</span> USDG
          {preview.undrawn > 0n && <> (incl. {formatUSDG(preview.undrawn)} never drawn)</>}, exporter {verb} <span className="num font-semibold text-ink">{formatUSDG(preview.residual)}</span> USDG.
        </p>
        {role === "financier" && f.status === "CREATED" && (
          <PayAction shipmentId={id} amount={BigInt(f.committed)} action="depositCapital" label={`Deposit ${formatUSDG(f.committed)} USDG`} successTitle="Facility funded" />
        )}
        {role === "buyer" && f.status === "ACTIVE" && allReleased && contracts && (
          <Button loading={pending} onClick={() => send({ address: contracts.controller, abi: controllerAbi, functionName: "markDelivered", args: [id], label: "Confirm delivery", successTitle: "Delivery confirmed" })}>
            Confirm delivery
          </Button>
        )}
        {role === "buyer" && f.status === "DELIVERED" && (
          <PayAction shipmentId={id} amount={BigInt(view.shipment.invoiceValue)} action="settle" label={`Pay the ${formatUSDG(view.shipment.invoiceValue)} USDG invoice`} successTitle="Invoice paid and settled" />
        )}
        {note && <p className="text-small font-medium text-ink/80 lg:text-right">{note}</p>}
      </div>
    </li>
  );
}
