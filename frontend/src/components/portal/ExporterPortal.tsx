"use client";

import { useAccount } from "wagmi";
import { Card, CardHeader } from "@/components/ui/Card";
import { ExporterWizard, MyShipments } from "@/components/portal/ExporterWizard";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { NetworkGuard } from "@/components/wallet/NetworkGuard";
import { useShipmentsFor } from "@/lib/api/hooks";

export function ExporterPortal() {
  const { address } = useAccount();
  const { data } = useShipmentsFor(address);
  const mine = (data?.shipments ?? []).filter((s) => address && s.exporter.toLowerCase() === address.toLowerCase());
  return (
    <div className="container-page flex flex-col gap-6 py-10">
      <PortalHeader title="Turn a shipment into" mark="working capital" lede="Register the cargo, fix its cold-chain policy and name a financier. Tranches reach your wallet as the cargo's evidence clears." art="sensor" />
      <NetworkGuard purpose="Registering a shipment and opening a facility are transactions signed by you, the exporter.">
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <ExporterWizard />
          <Card>
            <CardHeader title="Your shipments" />
            <MyShipments list={mine} />
          </Card>
        </div>
      </NetworkGuard>
    </div>
  );
}
