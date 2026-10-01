"use client";

import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { HashBadge } from "@/components/ui/HashBadge";
import { StatusPill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button, LinkButton } from "@/components/ui/Button";
import { useAudit, useConfig, useEpochs, useShipment, useTelemetry } from "@/lib/api/hooks";
import { useShipmentStream } from "@/lib/api/ws";
import { formatBps, formatUSDG } from "@/lib/format";
import { latestAssessment } from "@/lib/shipment";
import { AiPanel } from "./AiPanel";
import { AuditTable } from "./AuditTable";
import { EpochList } from "./EpochList";
import { EscrowPanel } from "./EscrowPanel";
import { Gauge } from "./Gauge";
import { MilestoneTimeline } from "./MilestoneTimeline";
import { ProofCard } from "./ProofCard";
import { RoleActions } from "./RoleActions";
import { RouteMap } from "./RouteMap";
import { TelemetryChart } from "./TelemetryChart";

export function ShipmentDashboard({ id, compact }: { id: string; compact?: boolean }) {
  const valid = /^0x[0-9a-fA-F]{64}$/.test(id);
  const shipment = useShipment(valid ? id : undefined);
  const epochs = useEpochs(valid ? id : undefined);
  const audit = useAudit(valid ? id : undefined);
  const telemetry = useTelemetry(valid ? id : undefined);
  const { data: cfg } = useConfig();
  const { connected } = useShipmentStream(valid ? id : undefined);
  const chainId = cfg?.chainId;

  if (!valid || (shipment.error as { status?: number } | null)?.status === 404) {
    return (
      <div className="container-page py-20 text-center">
        <h1 className="font-display text-4xl font-bold">We couldn&apos;t find that shipment</h1>
        <p className="mx-auto mt-4 max-w-md text-slate">
          {valid ? "No shipment with this id is tracked by this deployment." : "That doesn't look like a shipment id. Ids are 0x followed by 64 hex characters."}
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <LinkButton href="/shipments">Browse the fleet</LinkButton>
          <LinkButton href="/demo" variant="secondary">Run the live demo</LinkButton>
        </div>
      </div>
    );
  }
  if (shipment.isError) {
    return (
      <div className="container-page py-20 text-center">
        <h1 className="font-display text-3xl font-bold">This shipment could not be loaded</h1>
        <p className="mx-auto mt-3 max-w-md text-slate">{shipment.error.message}</p>
        <Button className="mt-6" onClick={() => shipment.refetch()}>Try again</Button>
      </div>
    );
  }
  const v = shipment.data;
  const ev = epochs.data?.epochs ?? [];
  const au = audit.data?.entries ?? [];
  const latest = v?.latestEvidence;
  const policy = v?.shipment.policy;

  return (
    <div className={compact ? "" : "container-page py-8 md:py-10"}>
      {/* header */}
      <div className="flex flex-col gap-5 rounded-[var(--radius-card)] bg-ink p-6 text-paper md:p-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            {v ? <StatusPill status={v.facility?.status ?? v.shipment.status} /> : <Skeleton className="h-6 w-20 bg-paper/15" />}
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-paper/70">
              <span className={`h-2 w-2 rounded-full ${connected ? "animate-pulse-dot bg-verified" : "bg-slate"}`} aria-hidden="true" />
              {connected ? "Live" : "Reconnecting"}
            </span>
          </div>
          <h1 className="mt-3 font-display text-[clamp(1.8rem,4vw,3rem)] leading-tight font-bold tracking-tight break-all">
            {v ? v.shipment.externalRef : <Skeleton className="h-10 w-80 bg-paper/15" />}
          </h1>
          {v && (
            <div className="mt-3 flex flex-wrap gap-2 text-sm [&>span]:bg-paper/10 [&>span]:text-paper">
              <HashBadge value={v.shipment.id} label="id" />
              <HashBadge value={v.shipment.exporter} kind="address" chainId={chainId} label="exporter" />
              {v.facility?.financier && <HashBadge value={v.facility.financier} kind="address" chainId={chainId} label="financier" />}
              <HashBadge value={v.shipment.buyer} kind="address" chainId={chainId} label="buyer" />
            </div>
          )}
        </div>
        {v && (
          <dl className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div><dt className="text-paper/60">Invoice</dt><dd className="font-mono text-lg font-semibold">{formatUSDG(v.shipment.invoiceValue)} USDG</dd></div>
            <div><dt className="text-paper/60">Facility</dt><dd className="font-mono text-lg font-semibold">{v.facility ? `${formatUSDG(v.facility.committed)} USDG` : "None yet"}</dd></div>
          </dl>
        )}
      </div>

      {v && !compact && (
        <Card className="mt-4" padded>
          <RoleActions view={v} epochs={ev} />
        </Card>
      )}

      <div className={`mt-4 grid gap-4 ${compact ? "xl:grid-cols-2" : "lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,340px)]"}`}>
        {/* left: route + milestones */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Route" />
            {v ? <RouteMap route={v.shipment.route} position={telemetry.data?.position ?? null} status={v.facility?.status} /> : <Skeleton className="h-48" />}
          </Card>
          <Card>
            <CardHeader title="Milestones" />
            {v ? <MilestoneTimeline milestones={v.milestones} facility={v.facility} chainId={chainId} /> : <Skeleton className="h-64" />}
          </Card>
        </div>

        {/* center: evidence */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Evidence">
              {latest && <span className="text-sm text-slate">Latest epoch: milestone {latest.milestoneIndex === 255 ? "–" : latest.milestoneIndex + 1}</span>}
            </CardHeader>
            {latest && policy ? (
              <div className="grid grid-cols-3 gap-2">
                <Gauge value={latest.score} max={100} threshold={policy.minEvidenceScore} label="Evidence score" display={String(latest.score)} />
                <Gauge value={latest.conflictBps} max={10000} threshold={policy.maxConflictBps} label="Sensor conflict" display={formatBps(latest.conflictBps)} good="low" />
                <Gauge value={latest.riskBps} max={10000} threshold={policy.maxRiskBps} label="Risk" display={formatBps(latest.riskBps)} good="low" />
              </div>
            ) : (
              <p className="text-slate">{v ? "No evidence yet. Gauges appear when the first 8-reading epoch closes." : <Skeleton className="h-32" />}</p>
            )}
          </Card>
          <Card>
            <CardHeader title="Temperature per epoch" />
            {telemetry.data && policy ? <TelemetryChart epochs={telemetry.data.epochs} policy={policy} /> : <Skeleton className="h-56" />}
          </Card>
          <Card>
            <CardHeader title="Committed evidence" />
            {epochs.data ? <EpochList epochs={ev} chainId={chainId} /> : <Skeleton className="h-40" />}
          </Card>
        </div>

        {/* right: money, monitor, proof */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Escrow" />
            {v ? <EscrowPanel facility={v.facility} /> : <Skeleton className="h-40" />}
          </Card>
          <Card>
            <CardHeader title="Monitor" />
            {audit.data ? <AiPanel assessment={latestAssessment(au)} /> : <Skeleton className="h-32" />}
          </Card>
          <Card>
            <CardHeader title="Zero-knowledge recovery" />
            <ProofCard epochs={ev} audit={au} chainId={chainId} paused={v?.facility?.status === "PAUSED"} />
          </Card>
        </div>
      </div>

      {!compact && (
        <Card className="mt-4">
          <CardHeader title="Audit trail">
            <span className="text-sm text-slate">Every event, decision and transaction, newest first</span>
          </CardHeader>
          {audit.data ? <AuditTable entries={au} chainId={chainId} /> : <Skeleton className="h-64" />}
        </Card>
      )}
      {!compact && (
        <p className="mt-6 text-center text-sm text-slate">
          Raw readings stay private: this page shows per-epoch aggregates; the chain holds only Merkle roots. <Link href="/#how-it-works" className="font-semibold underline">How it works</Link>
        </p>
      )}
    </div>
  );
}
