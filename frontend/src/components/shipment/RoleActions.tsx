"use client";

import { useAccount } from "wagmi";
import { PayAction } from "@/components/portal/PayAction";
import { Button } from "@/components/ui/Button";
import { WalletButton } from "@/components/wallet/WalletButton";
import { CancelAction } from "./CancelAction";
import { DisputeAction } from "./DisputeAction";
import type { EpochSummary, ShipmentView } from "@/lib/api/schemas";
import { controllerAbi } from "@/lib/chain/abis";
import { useContracts } from "@/lib/chain/contracts";
import { useTx } from "@/lib/chain/useTx";
import { formatUSDG } from "@/lib/format";
import { isHeld } from "@/lib/places";
import { useHydrated } from "@/lib/useHydrated";

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** What the connected wallet can do on this shipment right now, given its role and the facility's state. */
export function RoleActions({ view, epochs }: { view: ShipmentView; epochs: EpochSummary[] }) {
  const hydrated = useHydrated();
  const { address, isConnected } = useAccount();
  const { contracts } = useContracts();
  const { send, pending } = useTx();
  const f = view.facility;
  const id = view.shipment.id as `0x${string}`;
  if (!hydrated) return null;
  if (!isConnected) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-text-muted">Connect as the exporter, financier or buyer to act on this shipment.</p>
        <WalletButton compact />
      </div>
    );
  }
  const roles = [
    same(address, f?.exporter ?? view.shipment.exporter) && "exporter",
    same(address, f?.financier) && "financier",
    same(address, f?.buyer ?? view.shipment.buyer) && "buyer",
  ].filter(Boolean) as string[];
  if (!f || !contracts) return <p className="text-sm text-text-muted">No facility yet. The exporter opens one from the exporter portal.</p>;
  if (roles.length === 0) return <p className="text-sm text-text-muted">This wallet is not a party to the shipment; you can follow it read-only.</p>;

  const actions: React.ReactNode[] = [];
  const next = f.nextMilestone;
  const evidence = epochs.filter((e) => e.milestoneIndex === next && e.commitTx).at(-1);
  if (roles.includes("financier") && f.status === "CREATED") {
    actions.push(<PayAction key="fund" shipmentId={id} amount={BigInt(f.committed)} action="depositCapital" label={`Deposit ${formatUSDG(f.committed)} USDG`} successTitle="Facility funded" />);
  }
  if (roles.includes("exporter") && f.status === "FINANCED") {
    actions.push(
      <Button key="transit" loading={pending} onClick={() => send({ address: contracts.controller, abi: controllerAbi, functionName: "startTransit", args: [id], label: "Start transit", successTitle: "Transit started" })}>
        Start transit
      </Button>,
    );
  }
  // releasing is only possible while ACTIVE (a paused facility reverts with FacilityPaused before evaluating)
  // a held epoch (passed, but outside the milestone's place) would revert OutsideMilestonePlace: no button for it
  if ((roles.includes("exporter") || roles.includes("financier")) && f.status === "ACTIVE" && next < f.milestoneCount && evidence && evidence.decisionPass && !isHeld(evidence)) {
    actions.push(
      <Button
        key="release"
        loading={pending}
        onClick={() =>
          send({ address: contracts.controller, abi: controllerAbi, functionName: "evaluateAndReleaseMilestone", args: [id, next, evidence.sequence], label: `Release milestone ${next + 1}`, successTitle: `Milestone ${next + 1} released` })
        }
      >
        {`Release milestone ${next + 1}`}
      </Button>,
    );
  }
  if (roles.includes("buyer") && f.status === "ACTIVE" && next >= f.milestoneCount) {
    actions.push(
      <Button key="deliver" loading={pending} onClick={() => send({ address: contracts.controller, abi: controllerAbi, functionName: "markDelivered", args: [id], label: "Confirm delivery", successTitle: "Delivery confirmed" })}>
        Confirm delivery
      </Button>,
    );
  }
  if (roles.includes("buyer") && f.status === "DELIVERED") {
    actions.push(<PayAction key="settle" shipmentId={id} amount={BigInt(view.shipment.invoiceValue)} action="settle" label={`Pay the ${formatUSDG(view.shipment.invoiceValue)} USDG invoice`} successTitle="Invoice paid and settled" />);
  }
  if ((roles.includes("exporter") || roles.includes("financier")) && (f.status === "ACTIVE" || f.status === "PAUSED")) {
    actions.push(<DisputeAction key="dispute" shipmentId={id} controller={contracts.controller} />);
  }
  // contracts v3: close a facility that never started transit (CREATED any time, FINANCED after the timeout)
  if ((roles.includes("exporter") || roles.includes("financier")) && (f.status === "CREATED" || f.status === "FINANCED")) {
    actions.push(<CancelAction key="cancel" view={view} />);
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-muted">You are the {roles.join(" and ")} on this shipment.</p>
      {actions.length ? <div className="flex flex-wrap items-start gap-2">{actions}</div> : <p className="text-sm text-text-muted">Nothing for you to do right now. This page updates as the shipment moves.</p>}
    </div>
  );
}
