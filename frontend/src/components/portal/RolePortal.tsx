"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { PartyLink } from "@/components/market/PartyLink";
import { Portfolio } from "@/components/market/Portfolio";
import { PayAction } from "@/components/portal/PayAction";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusPill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
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
    title: "Fund trade that",
    mark: "proves itself",
    lede: "Your capital sits in a shipment-specific escrow and leaves it only when the cargo's evidence passes the policy you agreed to.",
    art: "vault" as const,
    guard: "Funding a facility is a transaction from your financier wallet.",
    empty: "No facility names this wallet as its financier yet. Offer on an open request in the market, or ask an exporter to open one with your address.",
  },
  buyer: {
    title: "Pay for cargo that",
    mark: "arrived right",
    lede: "Confirm delivery and pay the invoice once. The vault returns the financier's capital and pays the exporter the rest, in one transaction.",
    art: "settle" as const,
    guard: "Confirming delivery and paying the invoice are transactions from your buyer wallet.",
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
  return (
    <div className="container-page flex flex-col gap-6 py-10">
      <PortalHeader title={c.title} mark={c.mark} lede={c.lede} art={c.art} />
      <NetworkGuard purpose={c.guard}>
        {role === "financier" && mine.length > 0 && <Portfolio views={mine} address={address} />}
        {isPending && !!address ? (
          <Skeleton className="h-40" />
        ) : mine.length === 0 ? (
          <Card className="text-center">
            <p className="font-display text-2xl font-semibold">Nothing here yet</p>
            <p className="mx-auto mt-2 max-w-md text-slate">{c.empty}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <LinkButton href="/shipments" variant="secondary">Browse the fleet</LinkButton>
              {role === "financier" ? <LinkButton href="/market">Find shipments to fund</LinkButton> : <LinkButton href="/exporter">Open the exporter portal</LinkButton>}
            </div>
          </Card>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {mine.map((v) => (
              <li key={v.shipment.id}>
                <FacilityCard view={v} role={role} />
              </li>
            ))}
          </ul>
        )}
      </NetworkGuard>
    </div>
  );
}

function FacilityCard({ view, role }: { view: ShipmentView; role: Role }) {
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
  return (
    <Card className="flex h-full flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/track/${id}`} className="font-display text-xl font-semibold hover:underline">{view.shipment.externalRef}</Link>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate">
            <span>Milestone {Math.min(f.nextMilestone + 1, f.milestoneCount)} of {f.milestoneCount}</span>
            <span aria-hidden="true" className="hidden sm:inline">·</span>
            <span className="inline-flex items-center gap-1.5">Exporter <PartyLink address={f.exporter} /></span>
          </p>
        </div>
        <StatusPill status={f.status} />
      </div>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div><dt className="text-slate">Committed</dt><dd className="font-mono font-semibold">{formatUSDG(f.committed)}</dd></div>
        <div><dt className="text-slate">Drawn</dt><dd className="font-mono font-semibold">{formatUSDG(f.drawn)}</dd></div>
        <div><dt className="text-slate">Latest score</dt><dd className="font-mono font-semibold">{view.latestEvidence ? `${view.latestEvidence.score} · ${formatBps(view.latestEvidence.riskBps)} risk` : "–"}</dd></div>
      </dl>
      <div className="rounded-2xl bg-ink/4 p-4 text-sm">
        <p className="font-semibold">{heading}</p>
        <p className="mt-1 text-slate">
          Financier {verb} <b className="font-mono text-ink">{formatUSDG(preview.financier)}</b> USDG
          {preview.undrawn > 0n && <> (including {formatUSDG(preview.undrawn)} never drawn)</>}; exporter {verb} <b className="font-mono text-ink">{formatUSDG(preview.residual)}</b> USDG at settlement.
        </p>
      </div>
      <div className="mt-auto">
        {role === "financier" && f.status === "CREATED" && (
          <PayAction shipmentId={id} amount={BigInt(f.committed)} action="depositCapital" label={`Deposit ${formatUSDG(f.committed)} USDG`} successTitle="Facility funded" />
        )}
        {role === "financier" && f.status !== "CREATED" && <p className="text-sm text-slate">{f.status === "SETTLED" ? "Repaid with the fee." : "Funded. Releases follow the evidence automatically."}</p>}
        {role === "buyer" && f.status === "ACTIVE" && allReleased && contracts && (
          <Button loading={pending} onClick={() => send({ address: contracts.controller, abi: controllerAbi, functionName: "markDelivered", args: [id], label: "Confirm delivery", successTitle: "Delivery confirmed" })}>
            Confirm delivery
          </Button>
        )}
        {role === "buyer" && f.status === "DELIVERED" && (
          <PayAction shipmentId={id} amount={BigInt(view.shipment.invoiceValue)} action="settle" label={`Pay the ${formatUSDG(view.shipment.invoiceValue)} USDG invoice`} successTitle="Invoice paid and settled" />
        )}
        {role === "buyer" && !(f.status === "DELIVERED" || (f.status === "ACTIVE" && allReleased)) && (
          <p className="text-sm text-slate">{f.status === "SETTLED" ? "Paid and settled." : "Delivery can be confirmed once every milestone is released."}</p>
        )}
      </div>
    </Card>
  );
}
