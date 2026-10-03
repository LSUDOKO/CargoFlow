"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { lookupReference } from "@/lib/api/client";
import { Card, CardHeader } from "@/components/ui/Card";
import { HashBadge } from "@/components/ui/HashBadge";
import { StatusPill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button, LinkButton } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { rolesOf, useDocuments, useVessel } from "@/lib/api/extras";
import type { EpochSummary, ShipmentView } from "@/lib/api/schemas";
import { useAudit, useConfig, useEpochs, useShipment, useTelemetry } from "@/lib/api/hooks";
import { useShipmentStream } from "@/lib/api/ws";
import { fallbackBrief } from "@/lib/brief";
import { formatBps, formatTempX100, formatUSDG } from "@/lib/format";
import { latestAssessment } from "@/lib/shipment";
import { useHydrated } from "@/lib/useHydrated";
import { waterfall } from "@/lib/waterfall";
import { AiPanel } from "./AiPanel";
import { AlertsPanel } from "./AlertsPanel";
import { AuditTable } from "./AuditTable";
import { CertificateButton } from "./CertificateButton";
import { DocumentsPanel } from "./DocumentsPanel";
import { EpochList } from "./EpochList";
import { EscrowPanel } from "./EscrowPanel";
import { ExplainPanel } from "./ExplainPanel";
import { Gauge } from "./Gauge";
import { JourneyStrip, MilestoneTimeline } from "./MilestoneTimeline";
import { ProofCard } from "./ProofCard";
import { RecoveryPanel } from "./RecoveryPanel";
import { RoleActions } from "./RoleActions";
import { RouteMap } from "./RouteMap";
import { ShareCard } from "./ShareCard";
import { SourcesPanel } from "./SourcesPanel";
import { TelemetryChart } from "./TelemetryChart";
import { VesselPanel } from "./VesselPanel";

type Section = "overview" | "evidence" | "money" | "records" | "audit";

/**
 * One shipment, for every party. Overview (the default) answers the first questions in plain words: what is
 * happening, where the cargo is, how much money has moved, who acts next; it also carries everything a party has to
 * act on (role actions, evidence sources, a pending recovery). The other tabs hold the detail one click away.
 */
export function ShipmentDashboard({ id, compact }: { id: string; compact?: boolean }) {
  const valid = /^0x[0-9a-fA-F]{64}$/.test(id);
  const router = useRouter();
  // /track/<reference> links work too: resolve the reference, then move to the canonical id URL
  const byRef = useQuery({ queryKey: ["ref", id], queryFn: () => lookupReference(id), enabled: !valid && id.trim() !== "" });
  const resolved = byRef.data?.[0]?.id;
  useEffect(() => {
    if (resolved) router.replace(`/track/${resolved}`);
  }, [resolved, router]);
  const shipment = useShipment(valid ? id : undefined);
  const epochs = useEpochs(valid ? id : undefined);
  const audit = useAudit(valid ? id : undefined);
  const telemetry = useTelemetry(valid ? id : undefined);
  const { data: cfg } = useConfig();
  const { connected } = useShipmentStream(valid ? id : undefined);
  const chainId = cfg?.chainId;
  const hydrated = useHydrated();
  const { address } = useAccount();
  const documents = useDocuments(valid ? id : undefined);
  const vessel = useVessel(valid ? id : undefined);
  const [section, setSection] = useState<Section>("overview");
  const tabsRef = useRef<HTMLDivElement>(null);
  const roles = hydrated && shipment.data ? rolesOf(shipment.data, address) : [];

  if (!valid && (byRef.isPending || resolved)) {
    return (
      <div className="container-page py-20 text-center text-slate" role="status">
        Looking up {id}…
      </div>
    );
  }
  if (!valid || (shipment.error as { status?: number } | null)?.status === 404) {
    return (
      <div className="container-page py-20 text-center">
        <h1 className="font-display text-4xl font-bold">We couldn&apos;t find that shipment</h1>
        <p className="mx-auto mt-4 max-w-md text-slate">
          {valid ? "No shipment with this id is tracked by this deployment." : `No shipment id or reference matches “${id}”.`}
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <LinkButton href="/shipments">Browse the fleet</LinkButton>
          <LinkButton href="/exporter" variant="secondary">Open the exporter portal</LinkButton>
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
  const latest = v?.latestEvidence ?? null;
  const status = v?.facility?.status ?? v?.shipment.status;
  const closed = ["SETTLED", "DEFAULTED", "CANCELLED"].includes(v?.facility?.status ?? "");
  const recovery = status === "PAUSED" || ev.some((e) => e.proofVerified);
  const go = (s: Section) => {
    setSection(s);
    tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const sections = [
    { id: "overview", label: "Overview" },
    { id: "evidence", label: "Evidence", count: ev.length || undefined },
    { id: "money", label: "Money" },
    { id: "records", label: "Documents & alerts", count: documents.data?.documents.length || undefined },
    { id: "audit", label: "Audit trail", count: au.length || undefined },
  ];

  return (
    <div className={compact ? "" : "container-page py-8 md:py-10"}>
      {/* header: identity, parties, the two numbers that matter, and the record-keeping actions */}
      <div className="flex flex-col gap-5 rounded-[var(--radius-card)] bg-ink p-6 text-paper md:p-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            {v ? <StatusPill status={status} onDark /> : <Skeleton className="h-6 w-20 bg-paper/15" />}
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-paper/70">
              <span className={`h-2 w-2 rounded-full ${connected ? "animate-pulse-dot bg-verified" : "bg-slate"}`} aria-hidden="true" />
              {connected ? "Live" : "Reconnecting"}
            </span>
          </div>
          <h1 className={`mt-3 font-display leading-tight font-bold tracking-tight [overflow-wrap:anywhere] ${compact ? "text-[clamp(1.6rem,2.6vw,2.2rem)]" : "text-[clamp(1.8rem,4vw,3rem)]"}`}>
            {v ? v.shipment.externalRef : <Skeleton className="h-10 w-80 bg-paper/15" />}
          </h1>
          {v && (
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <HashBadge value={v.shipment.exporter} kind="address" chainId={chainId} label="exporter" onDark />
              {v.facility?.financier && <HashBadge value={v.facility.financier} kind="address" chainId={chainId} label="financier" onDark />}
              <HashBadge value={v.shipment.buyer} kind="address" chainId={chainId} label="buyer" onDark />
            </div>
          )}
        </div>
        {v && (
          <div className="flex shrink-0 flex-col gap-4 lg:items-end">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <div><dt className="text-paper/60">Invoice</dt><dd className="font-mono text-lg font-semibold">{formatUSDG(v.shipment.invoiceValue)} USDG</dd></div>
              <div><dt className="text-paper/60">Financing</dt><dd className="font-mono text-lg font-semibold">{v.facility ? `${formatUSDG(v.facility.committed)} USDG` : "None yet"}</dd></div>
            </dl>
            {!compact && (
              <div className="flex flex-wrap gap-2">
                <CertificateButton view={v} epochs={ev} audit={au} chainId={chainId} />
                <Button size="sm" variant="inverse" onClick={() => go("records")}>Share</Button>
              </div>
            )}
          </div>
        )}
      </div>

      {!compact && (
        <div ref={tabsRef} className="mt-4 scroll-mt-20 overflow-x-auto pb-1">
          <Tabs label="Shipment sections" tabs={sections} value={section} onChange={(s) => setSection(s as Section)} size="lg" />
        </div>
      )}

      <div id={`panel-${section}`} role={compact ? undefined : "tabpanel"} aria-labelledby={compact ? undefined : `tab-${section}`} className="mt-4 flex flex-col gap-4">
        {(section === "overview" || compact) && (
          <>
            <Card padded>
              {v ? (
                <ExplainPanel view={v} fallback={fallbackBrief(v, latest)} roles={roles} position={telemetry.data?.position ?? null} vesselName={vessel.data?.name}>
                  {!compact && <RoleActions view={v} epochs={ev} />}
                </ExplainPanel>
              ) : (
                <div className="flex flex-col gap-4" aria-busy="true"><Skeleton className="h-8 w-2/3" /><div className="grid gap-2.5 sm:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div></div>
              )}
            </Card>

            <Card>
              <CardHeader title="Journey">
                {v?.facility && (
                  <span className="text-sm text-slate">
                    Each milestone releases its share of the {formatUSDG(v.facility.committed)} USDG once the evidence passes.{" "}
                    <button type="button" className="font-semibold text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink" onClick={() => go("money")}>See the money</button>
                  </span>
                )}
              </CardHeader>
              {v ? <JourneyStrip milestones={v.milestones} facility={v.facility} invoiceValue={v.shipment.invoiceValue} /> : <Skeleton className="h-28" />}
            </Card>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <div className="flex min-w-0 flex-col gap-4">
                <Card>
                  <CardHeader title="Route and position" />
                  {v ? <RouteMap route={v.shipment.route} position={telemetry.data?.position ?? null} status={v.facility?.status} shipmentId={v.shipment.id} maxRouteDeviationM={v.shipment.policy.maxRouteDeviationM} /> : <Skeleton className="h-72" />}
                </Card>
                {!compact && (
                  <Card>
                    <CardHeader title="Ship" />
                    {v ? <VesselPanel shipment={v.shipment} closed={closed} /> : <Skeleton className="h-20" />}
                  </Card>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                {recovery && (
                  <Card className={status === "PAUSED" ? "ring-2 ring-alert/60" : undefined}>
                    <CardHeader title="Zero-knowledge recovery" />
                    <ProofCard epochs={ev} audit={au} chainId={chainId} paused={status === "PAUSED"} />
                    {v && !compact && <RecoveryPanel view={v} />}
                  </Card>
                )}
                {!compact && (
                  <Card>
                    <CardHeader title="Evidence sources" />
                    {v ? <SourcesPanel shipment={v.shipment} chainId={chainId} closed={closed} /> : <Skeleton className="h-16" />}
                  </Card>
                )}
                <Card>
                  <CardHeader title="Latest evidence">
                    {latest && <span className="text-sm text-slate">Milestone {latest.milestoneIndex === 255 ? "–" : latest.milestoneIndex + 1} · batch #{latest.sequence}</span>}
                  </CardHeader>
                  {v ? <EvidenceGauges view={v} latest={latest} /> : <Skeleton className="h-32" />}
                  {latest && !compact && (
                    <button type="button" onClick={() => go("evidence")} className="mt-4 text-sm font-semibold underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
                      All evidence, temperatures and the monitor
                    </button>
                  )}
                </Card>
                {v && <AgreedTerms view={v} chainId={chainId} />}
              </div>
            </div>
          </>
        )}

        {section === "evidence" && !compact && (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Latest evidence">
                  {latest && <span className="text-sm text-slate">Milestone {latest.milestoneIndex === 255 ? "–" : latest.milestoneIndex + 1} · batch #{latest.sequence}</span>}
                </CardHeader>
                {v ? <EvidenceGauges view={v} latest={latest} /> : <Skeleton className="h-32" />}
              </Card>
              <Card>
                <CardHeader title="Monitor decision" />
                {audit.data ? <AiPanel assessment={latestAssessment(au)} /> : <Skeleton className="h-32" />}
              </Card>
            </div>
            <Card>
              <CardHeader title="Temperature per batch">
                <span className="text-sm text-slate">Each batch is eight readings per probe; the band is what all parties agreed.</span>
              </CardHeader>
              {telemetry.data && v ? <TelemetryChart epochs={telemetry.data.epochs} policy={v.shipment.policy} /> : <Skeleton className="h-56" />}
            </Card>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <Card>
                <CardHeader title="Committed evidence">
                  <span className="text-sm text-slate">Only each batch&apos;s fingerprint (Merkle root) is on chain</span>
                </CardHeader>
                {epochs.data ? <EpochList epochs={ev} chainId={chainId} /> : <Skeleton className="h-40" />}
              </Card>
              <Card>
                <CardHeader title="Zero-knowledge recovery" />
                <ProofCard epochs={ev} audit={au} chainId={chainId} paused={status === "PAUSED"} />
              </Card>
            </div>
          </>
        )}

        {section === "money" && !compact && v && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-4">
              <Card>
                <CardHeader title="Escrow" />
                <EscrowPanel facility={v.facility} />
              </Card>
              <Card>
                <CardHeader title="When the buyer pays" />
                <Waterfall view={v} />
              </Card>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <Card>
                <CardHeader title="Milestone releases">
                  <span className="text-sm text-slate">Each release is a transaction you can check</span>
                </CardHeader>
                <MilestoneTimeline milestones={v.milestones} facility={v.facility} chainId={chainId} />
              </Card>
              <Card>
                <CardHeader title="Records" />
                <p className="text-sm text-slate">A PDF of the agreement, every milestone&apos;s evidence and transaction, the waterfall and the attested documents. It becomes the settlement certificate once the invoice is paid.</p>
                <CertificateButton view={v} epochs={ev} audit={au} chainId={chainId} variant="secondary" className="mt-4" />
              </Card>
            </div>
          </div>
        )}

        {section === "records" && !compact && v && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader title="Documents" />
              <DocumentsPanel view={v} />
            </Card>
            <div className="flex min-w-0 flex-col gap-4">
              <Card>
                <CardHeader title="Alerts" />
                <AlertsPanel view={v} />
              </Card>
              <Card>
                <CardHeader title="Share" />
                <ShareCard id={v.shipment.id} reference={v.shipment.externalRef} chainId={chainId} />
              </Card>
            </div>
          </div>
        )}

        {section === "audit" && !compact && (
          <Card>
            <CardHeader title="Audit trail">
              <span className="text-sm text-slate">Every event, decision and transaction, newest first</span>
            </CardHeader>
            {audit.data ? <AuditTable entries={au} chainId={chainId} /> : <Skeleton className="h-64" />}
          </Card>
        )}
      </div>

      {!compact && (
        <p className="mt-6 text-center text-sm text-slate">
          Raw readings stay private: this page shows per-batch aggregates; the chain holds only their fingerprints. <Link href="/#how-it-works" className="font-semibold underline">How it works</Link>
        </p>
      )}
    </div>
  );
}

function EvidenceGauges({ view, latest }: { view: ShipmentView; latest: EpochSummary | null }) {
  const p = view.shipment.policy;
  if (!latest) {
    return <p className="rounded-2xl bg-mist px-4 py-3 text-sm text-slate">No evidence yet. The gauges appear when the data logger&apos;s first batch of eight readings is evaluated.</p>;
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      <Gauge
        value={latest.score}
        max={100}
        threshold={p.minEvidenceScore}
        label="Evidence score"
        display={String(latest.score)}
        limit={`needs ${p.minEvidenceScore}+`}
        hintAlign="left"
        hint={`A 0 to 100 grade of the latest batch of readings: enough sensors, no gaps, on the route and inside the temperature band. Money is released only at ${p.minEvidenceScore} or more.`}
      />
      <Gauge
        value={latest.conflictBps}
        max={10000}
        threshold={p.maxConflictBps}
        label="Sensor conflict"
        display={formatBps(latest.conflictBps)}
        good="low"
        limit={`limit ${formatBps(p.maxConflictBps)}`}
        hint={`How much the probes in the container disagree with each other. A high value points to a faulty or tampered sensor. It must stay at or below ${formatBps(p.maxConflictBps)}.`}
      />
      <Gauge
        value={latest.riskBps}
        max={10000}
        threshold={p.maxRiskBps}
        label="Risk"
        display={formatBps(latest.riskBps)}
        good="low"
        limit={`limit ${formatBps(p.maxRiskBps)}`}
        hintAlign="right"
        hint={`The combined risk to the cargo from temperature drift, missing readings and route deviation. It must stay at or below ${formatBps(p.maxRiskBps)}.`}
      />
    </div>
  );
}

function AgreedTerms({ view, chainId }: { view: ShipmentView; chainId?: number }) {
  const p = view.shipment.policy;
  const f = view.facility;
  const terms: [string, string][] = [
    ["Temperature", `${formatTempX100(p.minTempX100)} to ${formatTempX100(p.maxTempX100)}`],
    ["Readings", `At least every ${Math.round(p.maxGapSec / 60)} min, from ${p.minSensors}+ probes`],
    ["Route", `Within ${Math.round(p.maxRouteDeviationM / 1000)} km of the plan`],
    ["To release money", `Evidence score ${p.minEvidenceScore}+${p.requiresZk ? " and a proof" : ""}`],
    ...(f ? ([["Financing fee", `${f.feeBps / 100}% of what is drawn`]] as [string, string][]) : []),
  ];
  return (
    <Card>
      <CardHeader title="What was agreed" />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {terms.map(([k, val]) => (
          <div key={k} className="contents">
            <dt className="text-slate">{k}</dt>
            <dd className="font-medium">{val}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-slate">Fixed at registration: no party can change these terms afterwards.</p>
      <details className="group mt-4 border-t border-line pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          On-chain references
          <span aria-hidden="true" className="text-slate transition-transform group-open:rotate-90">›</span>
        </summary>
        <div className="mt-3 flex flex-col items-start gap-1.5">
          <HashBadge value={view.shipment.id} label="shipment" />
          <HashBadge value={view.shipment.invoiceHash} label="invoice hash" />
          <HashBadge value={view.shipment.routeCommitment} label="route" />
          <HashBadge value={view.shipment.policyCommitment} label="terms" />
          {chainId && <span className="text-xs text-slate">Chain {chainId}</span>}
        </div>
      </details>
    </Card>
  );
}

function Waterfall({ view }: { view: ShipmentView }) {
  const f = view.facility;
  if (!f) return <p className="rounded-2xl bg-mist px-4 py-3 text-sm text-slate">No financing yet. Once a facility exists, this shows how the buyer&apos;s payment is split.</p>;
  const w = waterfall(f.drawn, view.shipment.invoiceValue, f.feeBps, f.committed);
  const inv = BigInt(view.shipment.invoiceValue);
  const share = inv > 0n ? Number(((w.principal + w.fee) * 1000n) / inv) / 10 : 0;
  const settled = f.status === "SETTLED";
  const rows: [string, bigint, string?][] = [
    ["Principal back to the financier", w.principal],
    [`Fee to the financier (${f.feeBps / 100}%)`, w.fee],
    ["To the exporter", w.residual, "font-semibold"],
  ];
  return (
    <div>
      <p className="text-sm text-slate">{settled ? "The buyer paid the invoice and the contract split it like this." : "If the buyer paid today, the contract would split the invoice like this. It changes as more milestones are released."}</p>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-verified/25" role="img" aria-label={`${share}% of the invoice goes to the financier, the rest to the exporter`}>
        <span className="h-full bg-ink" style={{ width: `${share}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-slate"><span>Financier</span><span>Exporter</span></div>
      <dl className="mt-4 divide-y divide-line text-sm">
        <div className="flex justify-between gap-3 pb-2"><dt className="text-slate">Invoice paid by the buyer</dt><dd className="font-mono">{formatUSDG(inv)} USDG</dd></div>
        {rows.map(([k, val, cls]) => (
          <div key={k} className={`flex justify-between gap-3 py-2 ${cls ?? ""}`}><dt className={cls ? "" : "text-slate"}>{k}</dt><dd className="font-mono">{formatUSDG(val)} USDG</dd></div>
        ))}
        {w.undrawn > 0n && <div className="flex justify-between gap-3 pt-2 text-slate"><dt>Undrawn capital, returned from escrow</dt><dd className="font-mono">{formatUSDG(w.undrawn)} USDG</dd></div>}
      </dl>
    </div>
  );
}
