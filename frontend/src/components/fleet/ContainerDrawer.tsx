"use client";

import { Drawer } from "@/components/ui/Drawer";
import { LinkButton } from "@/components/ui/Button";
import { CopyField } from "@/components/ui/CopyField";
import { KeyValue } from "@/components/ui/KeyValue";
import { Badge, StatusPill } from "@/components/ui/Pill";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { useShipment, useTelemetry } from "@/lib/api/hooks";
import { formatTempX100, formatUSDG } from "@/lib/format";

const probe: Record<string, string> = { "sensor-1": "Container air sensor", "sensor-2": "Core sensor" };

/** The container behind a fleet row: its sensors, their reading range and the facility at a glance. */
export function ContainerDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: v } = useShipment(id ?? undefined);
  const { data: t } = useTelemetry(id ?? undefined);
  const sensors = new Map<string, { readings: number; min: number; max: number }>();
  for (const e of t?.epochs ?? []) {
    for (const s of e.sensors) {
      const cur = sensors.get(s.sensorId) ?? { readings: 0, min: s.minTempX100, max: s.maxTempX100 };
      sensors.set(s.sensorId, { readings: cur.readings + s.readings, min: Math.min(cur.min, s.minTempX100), max: Math.max(cur.max, s.maxTempX100) });
    }
  }
  const band = v?.shipment.policy;
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={v?.shipment.externalRef ?? "Container"}
      description="Sensor readings and the facility behind this shipment."
      footer={v && <LinkButton href={`/track/${v.shipment.id}`}>Open dashboard</LinkButton>}
    >
      {!v ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton className="h-6 w-40" />
          <SkeletonText lines={4} />
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill status={v.facility?.status ?? v.shipment.status} />
              {v.facility && (
                <span className="num text-sm text-text-muted">
                  <span className="font-semibold text-ink">{formatUSDG(v.facility.drawn)}</span> of {formatUSDG(v.facility.committed)} USDG drawn
                </span>
              )}
            </div>
            <CopyField value={v.shipment.id} label="Shipment id" kind="hash" className="w-full" />
          </div>

          <section aria-labelledby="drawer-probes">
            <h3 id="drawer-probes" className="font-display text-h4">Probes</h3>
            {sensors.size === 0 ? (
              <p className="mt-2 text-sm text-text-muted">No readings yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {[...sensors.entries()].sort().map(([sid, s]) => {
                  const outside = band ? s.max > band.maxTempX100 || s.min < band.minTempX100 : false;
                  return (
                    <li key={sid} className="flex items-start justify-between gap-3 rounded-tile border border-border bg-surface p-4">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{probe[sid] ?? sid}</p>
                        <p className="num mt-0.5 text-small text-text-muted">{s.readings.toLocaleString("en-US")} readings accepted</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="num text-sm font-semibold">{formatTempX100(s.min)} to {formatTempX100(s.max)}</span>
                        {outside ? <Badge variant="warning" size="sm">Left the band</Badge> : <Badge variant="success" size="sm">In band</Badge>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <KeyValue
            items={[
              { label: "Agreed band", value: band ? `${formatTempX100(band.minTempX100)} to ${formatTempX100(band.maxTempX100)}` : "–", numeric: true },
              { label: "Evidence batches", value: t?.epochs.length ?? 0, numeric: true },
              { label: "Latest evidence score", value: v.latestEvidence ? `${v.latestEvidence.score} / 100` : "–", numeric: true },
              { label: "Quarantined readings", value: v.quarantinedReadings, numeric: true },
            ]}
          />
        </div>
      )}
    </Drawer>
  );
}
