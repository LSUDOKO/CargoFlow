"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/Button";
import { HashBadge } from "@/components/ui/HashBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { useGateways } from "@/lib/api/hooks";
import type { Shipment } from "@/lib/api/schemas";
import type { KeyFile } from "@/lib/gateway";
import { useHydrated } from "@/lib/useHydrated";
import { AddGatewayModal } from "./AddGatewayModal";
import { ApiInstructions } from "./ApiInstructions";
import { UploadReadings } from "./UploadReadings";

/** The shipment's evidence gateways; the exporter adds gateways and submits readings from here. */
export function SourcesPanel({ shipment, chainId, closed }: { shipment: Shipment; chainId?: number; closed?: boolean }) {
  const hydrated = useHydrated();
  const { address } = useAccount();
  const gateways = useGateways(shipment.id);
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [freshKey, setFreshKey] = useState<KeyFile | null>(null);
  const isExporter = hydrated && !!address && address.toLowerCase() === shipment.exporter.toLowerCase();
  const list = gateways.data?.sources ?? [];

  return (
    <div>
      {gateways.isPending ? (
        <Skeleton className="h-16" />
      ) : list.length === 0 ? (
        <p className="text-sm text-slate">
          {isExporter
            ? "No gateways yet. Add the data logger travelling with the goods, then submit its readings as evidence."
            : "No evidence gateways yet. The exporter adds the data logger travelling with the goods."}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
              <span className="font-semibold">{g.label || "Gateway"}</span>
              <HashBadge value={g.id} compact />
              <span className="font-mono text-slate">{g.sensorIds.join(", ")}</span>
              <span className="ml-auto text-xs text-slate">added {new Date(g.createdAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}</span>
            </li>
          ))}
        </ul>
      )}
      {isExporter && !closed && (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setUploading(true)} disabled={list.length === 0}>Submit readings</Button>
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>Add sensor gateway</Button>
          </div>
          <ApiInstructions shipmentId={shipment.id} />
          <AddGatewayModal
            open={adding}
            onClose={() => setAdding(false)}
            shipment={shipment}
            onCreated={(k) => {
              setFreshKey(k);
              setUploading(true);
            }}
          />
          <UploadReadings open={uploading} onClose={() => setUploading(false)} shipment={shipment} initialKey={freshKey} chainId={chainId} />
        </>
      )}
    </div>
  );
}
