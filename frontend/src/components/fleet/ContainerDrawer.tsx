"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { Button, LinkButton } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { useShipment, useTelemetry } from "@/lib/api/hooks";
import { formatTempX100, formatUSDG } from "@/lib/format";

const probe: Record<string, string> = { "sensor-1": "Container air probe", "sensor-2": "Core probe" };

/** The container behind a fleet row: its probes, their latest readings range and the facility at a glance. */
export function ContainerDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: v } = useShipment(id ?? undefined);
  const { data: t } = useTelemetry(id ?? undefined);
  const [copied, setCopied] = useState(false);
  const sensors = new Map<string, { readings: number; min: number; max: number }>();
  for (const e of t?.epochs ?? []) {
    for (const s of e.sensors) {
      const cur = sensors.get(s.sensorId) ?? { readings: 0, min: s.minTempX100, max: s.maxTempX100 };
      sensors.set(s.sensorId, { readings: cur.readings + s.readings, min: Math.min(cur.min, s.minTempX100), max: Math.max(cur.max, s.maxTempX100) });
    }
  }
  const band = v?.shipment.policy;
  return (
    <Drawer open={!!id} onClose={onClose} title={v?.shipment.externalRef ?? "Container"}>
      {!v ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={v.facility?.status ?? v.shipment.status} />
            {v.facility && <span className="text-sm text-slate">{formatUSDG(v.facility.drawn)} of {formatUSDG(v.facility.committed)} USDG drawn</span>}
          </div>
          <section>
            <h3 className="font-display text-lg font-semibold">Probes</h3>
            {sensors.size === 0 ? (
              <p className="mt-2 text-slate">No readings yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {[...sensors.entries()].sort().map(([sid, s]) => {
                  const outside = band ? s.max > band.maxTempX100 || s.min < band.minTempX100 : false;
                  return (
                    <li key={sid} className={`rounded-2xl border p-4 ${outside ? "border-alert bg-alert/10" : "border-line bg-white"}`}>
                      <p className="font-semibold">{probe[sid] ?? sid}</p>
                      <p className="mt-1 text-sm text-slate">{s.readings} readings accepted</p>
                      <p className="mt-2 font-mono text-sm">
                        {formatTempX100(s.min)} to {formatTempX100(s.max)}
                        {outside && <span className="ml-2 font-sans font-semibold text-[#8a5300]">left the agreed band</span>}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-slate">Evidence epochs</p><p className="font-display text-2xl font-bold">{t?.epochs.length ?? 0}</p></div>
            <div><p className="text-slate">Latest score</p><p className="font-display text-2xl font-bold">{v.latestEvidence?.score ?? "–"}</p></div>
            <div><p className="text-slate">Quarantined readings</p><p className="font-display text-2xl font-bold">{v.quarantinedReadings}</p></div>
            <div><p className="text-slate">Agreed band</p><p className="font-display text-xl font-bold">{band ? `${formatTempX100(band.minTempX100)} – ${formatTempX100(band.maxTempX100)}` : "–"}</p></div>
          </section>
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/track/${v.shipment.id}`}>Open dashboard</LinkButton>
            <Button variant="secondary" onClick={async () => { await navigator.clipboard?.writeText(v.shipment.id); setCopied(true); }}>
              {copied ? "Copied" : "Copy id"}
            </Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}
