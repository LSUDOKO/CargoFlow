"use client";

import { CopyField } from "@/components/ui/CopyField";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge, type BadgeVariant } from "@/components/ui/Pill";
import { useDevicesOnChain } from "@/lib/chain/v3";
import type { EpochSummary } from "@/lib/api/schemas";
import { formatBps } from "@/lib/format";
import { distanceText, HELD } from "@/lib/places";
import { DeviceBadge } from "./DeviceBadge";

// a held epoch passed the policy but came from outside the milestone's place: it waits, it did not fail
const variant = (a: string): BadgeVariant => (a === "APPROVE_ADVANCE" ? "success" : a === HELD ? "info" : a.startsWith("SKIPPED") ? "neutral" : "warning");
const words: Record<string, string> = { APPROVE_ADVANCE: "Approve", PAUSE_FACILITY: "Pause", REQUEST_SECONDARY_PROOF: "More proof", [HELD]: "Held: not at the place yet" };
const decision = (a: string) => words[a] ?? a.replace("SKIPPED_", "Skipped: ").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** The committed evidence batches, newest first: score, conflict, maxima, the decision, the devices and the commit. */
export function EpochList({ epochs, chainId }: { epochs: EpochSummary[]; chainId?: number }) {
  const rows = [...epochs].reverse().slice(0, 10);
  // contracts v3: the device keys whose readings fed each batch, checked against the on-chain registry
  const withSources = rows.some((e) => e.sources.length > 0);
  const onChain = useDevicesOnChain([...new Set(rows.flatMap((e) => e.sources.map((s) => s.keyHash.toLowerCase())))]);
  if (epochs.length === 0) return <EmptyState size="sm" title="No evidence batches yet" description="Each batch of eight readings per probe appears here once it is committed." />;
  const columns: Column<EpochSummary>[] = [
    {
      key: "batch",
      header: "Batch",
      primary: true,
      cell: (e) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {e.milestoneIndex === 255 ? <span className="text-text-muted">Observation</span> : <span className="font-semibold">Milestone {e.milestoneIndex + 1}</span>}
          <span className="num text-text-muted">#{e.sequence}</span>
          {e.proofVerified && <Badge variant="success" size="sm" shape="square">ZK proven</Badge>}
        </span>
      ),
    },
    { key: "score", header: "Score", numeric: true, cell: (e) => <span className="font-semibold">{e.score}</span> },
    { key: "conflict", header: "Conflict", numeric: true, cell: (e) => formatBps(e.conflictBps) },
    {
      key: "maxima",
      header: "Humidity · shock",
      numeric: true,
      hideOnCard: !rows.some((e) => e.maxHumidityX100 || e.maxShockX100),
      cell: (e) => (e.maxHumidityX100 || e.maxShockX100 ? `${Number((e.maxHumidityX100 / 100).toFixed(1))}% · ${Number((e.maxShockX100 / 100).toFixed(2))} g` : "–"),
    },
    {
      key: "decision",
      header: "Decision",
      cell: (e) => (
        <span className="inline-flex flex-col items-end gap-0.5 sm:items-start">
          <Badge variant={variant(e.decisionAction)} dot>{decision(e.decisionAction)}</Badge>
          {e.decisionAction === HELD && e.heldDistanceM !== null && <span className="text-caption text-text-muted">{distanceText(e.heldDistanceM)} from the place</span>}
        </span>
      ),
    },
    ...(withSources
      ? [
          {
            key: "devices",
            header: "Devices",
            cell: (e: EpochSummary) =>
              e.sources.length === 0 ? (
                <span className="text-text-muted">–</span>
              ) : (
                <span className="inline-flex flex-col items-end gap-1 sm:items-start">
                  {e.sources.map((s) => {
                    const rec = onChain.devices.get(s.keyHash.toLowerCase());
                    return (
                      <span key={s.keyHash} title={s.keyHash}>
                        <DeviceBadge deviceClass={s.deviceClass} onChain={s.onChain || rec?.registered} revoked={rec?.revoked} compact />
                      </span>
                    );
                  })}
                </span>
              ),
          } satisfies Column<EpochSummary>,
        ]
      : []),
    { key: "commit", header: "Commit", cell: (e) => (e.commitTx ? <CopyField value={e.commitTx} kind="tx" chainId={chainId} size="sm" /> : <span className="text-text-muted">Not committed</span>) },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(e) => e.epochId} caption="Committed evidence batches, newest first" />;
}
