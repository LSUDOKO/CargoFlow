"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/Button";
import { HashBadge } from "@/components/ui/HashBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { useGateways } from "@/lib/api/hooks";
import { useDevicesOnChain } from "@/lib/chain/v3";
import { keyHashOf } from "@/lib/devices";
import { DeviceBadge } from "./DeviceBadge";
import type { Shipment } from "@/lib/api/schemas";
import type { KeyFile } from "@/lib/gateway";
import { useHydrated } from "@/lib/useHydrated";
import { AddGatewayModal } from "./AddGatewayModal";
import { ApiInstructions } from "./ApiInstructions";
import { PhoneDeviceModal } from "./PhoneDeviceModal";
import { UploadReadings } from "./UploadReadings";
import { deviceFor } from "@/lib/devicePasskey";

/** The shipment's evidence gateways; the exporter adds gateways and submits readings from here. */
export function SourcesPanel({ shipment, chainId, closed }: { shipment: Shipment; chainId?: number; closed?: boolean }) {
  const hydrated = useHydrated();
  const { address } = useAccount();
  const gateways = useGateways(shipment.id);
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [phone, setPhone] = useState(false);
  // a phone registered here as an inspection device can sign readings even without the exporter's wallet
  const hasDevice = hydrated && !!deviceFor(shipment.id);
  const [freshKey, setFreshKey] = useState<KeyFile | null>(null);
  const isExporter = hydrated && !!address && address.toLowerCase() === shipment.exporter.toLowerCase();
  const list = gateways.data?.sources ?? [];
  // contracts v3 device trust: the key hash the backend reports, or keccak256 of the key when it predates v3
  const keyHashes = list.map((g) => (g.keyHash || keyHashOf(g.publicKey)).toLowerCase());
  const onChain = useDevicesOnChain(keyHashes);

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
          {list.map((g, i) => {
            const rec = onChain.devices.get(keyHashes[i]!);
            return (
              <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 text-sm">
                <span className="font-semibold">{g.label || "Gateway"}</span>
                <HashBadge value={g.id} compact />
                <span className="font-mono text-slate">{g.sensorIds.join(", ")}</span>
                <span className="ml-auto text-xs text-slate">added {new Date(g.createdAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}</span>
                <span className="basis-full">
                  <DeviceBadge deviceClass={g.deviceClass} onChain={rec?.registered} revoked={rec?.revoked} />
                  {g.attested && g.deviceClass !== "software" && <span className="ml-2 text-xs text-slate">attestation verified</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {!isExporter && hasDevice && !closed && (
        <>
          <Button size="sm" className="mt-4" onClick={() => setPhone(true)}>Take a signed inspection reading</Button>
          <PhoneDeviceModal open={phone} onClose={() => setPhone(false)} shipment={shipment} isExporter={false} />
        </>
      )}
      {isExporter && !closed && (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setUploading(true)} disabled={list.length === 0}>Submit readings</Button>
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>Add sensor gateway</Button>
          </div>
          <button type="button" onClick={() => setPhone(true)} className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-dashed border-line bg-white/60 px-3.5 py-3 text-left text-sm transition-colors hover:border-ink/40">
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></svg>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Use a phone as a signed inspection device</span>
              <span className="block text-slate">Its passkey signs each manual reading. No app or key file needed.</span>
            </span>
          </button>
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
          <PhoneDeviceModal open={phone} onClose={() => setPhone(false)} shipment={shipment} isExporter={isExporter} />
          <UploadReadings open={uploading} onClose={() => setUploading(false)} shipment={shipment} initialKey={freshKey} chainId={chainId} />
        </>
      )}
    </div>
  );
}
