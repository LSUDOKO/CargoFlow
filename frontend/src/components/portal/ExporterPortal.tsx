"use client";

import { useAccount } from "wagmi";
import { ExporterWizard, MyShipments } from "@/components/portal/ExporterWizard";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { LinkButton } from "@/components/ui/Button";
import { Section } from "@/components/ui/Section";
import { NetworkGuard } from "@/components/wallet/NetworkGuard";
import { useShipmentsFor } from "@/lib/api/hooks";

export function ExporterPortal() {
  const { address } = useAccount();
  const { data, isPending } = useShipmentsFor(address);
  const mine = (data?.shipments ?? [])
    .filter((s) => address && s.exporter.toLowerCase() === address.toLowerCase())
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return (
    <div className="container-page py-(--space-page-y)">
      <PortalHeader
        eyebrow="For exporters"
        title="Turn a shipment into working capital"
        lede="Register the cargo, fix its cold-chain policy and name a financier. Tranches reach your wallet as the cargo's evidence clears."
        actions={<LinkButton href="/market/new" variant="secondary">Request financing on the market</LinkButton>}
      />
      <NetworkGuard
        purpose="Registering a shipment and opening a facility are transactions signed by you, the exporter."
        points={["Register a shipment with its route and invoice", "Freeze a cold-chain policy the contract enforces", "Open a facility, or post the shipment to the market"]}
      >
        <div className="flex flex-col gap-10">
          <Section title="Register a shipment" description="Four steps. Nothing is signed until the last one.">
            <ExporterWizard />
          </Section>
          <Section title="Your shipments">
            <MyShipments list={mine} loading={isPending && !!address} />
          </Section>
        </div>
      </NetworkGuard>
    </div>
  );
}
