"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { lookupReference } from "@/lib/api/client";
import { Callout } from "@/components/ui/Banner";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { CopyField } from "@/components/ui/CopyField";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/EmptyState";
import { KeyValue } from "@/components/ui/KeyValue";
import { StatusPill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { Stat } from "@/components/ui/Stat";
import { Tabs } from "@/components/ui/Tabs";
import { rolesOf, useDocuments, useExplanation, useVessel } from "@/lib/api/extras";
import type { EpochSummary, ShipmentView } from "@/lib/api/schemas";
import { useAudit, useConfig, useEpochs, useShipment, useTelemetry } from "@/lib/api/hooks";
import { useShipmentStream } from "@/lib/api/ws";
import { fallbackBrief } from "@/lib/brief";
import { formatBps, formatTempX100, formatUSDG } from "@/lib/format";
import { distanceText, hasPlace, isHeld, nextPlaceDistance, placePhrase } from "@/lib/places";
import { latestAssessment } from "@/lib/shipment";
import { useHydrated } from "@/lib/useHydrated";
import { useSearchFlag } from "@/lib/useSearchFlag";
import { claudeNewChat, shipmentPrompt } from "@/lib/developer";
import { AiPanel } from "./AiPanel";
import { AlertsPanel } from "./AlertsPanel";
import { AuditTable } from "./AuditTable";
import { CertificateButton } from "./CertificateButton";
import { CoverPanel, CoverSummary, useCoverEnabled } from "./CoverPanel";
import { DocumentsPanel } from "./DocumentsPanel";
import { EpcisDownload } from "./EpcisDownload";
import { EpochList } from "./EpochList";
import { EscrowPanel, Waterfall } from "./EscrowPanel";
import { ExplainPanel } from "./ExplainPanel";
import { Gauge } from "./Gauge";
import { JourneyTimeline, MilestoneTable } from "./MilestoneTimeline";
import { ProofCard } from "./ProofCard";
import { RecoveryPanel } from "./RecoveryPanel";
import { RoleActions } from "./RoleActions";
import { RouteMap } from "./RouteMap";
import { ShareCard } from "./ShareCard";
import { DeviceBadge } from "./DeviceBadge";
import { SourcesPanel } from "./SourcesPanel";
import { TitleCard, useTitleEnabled } from "./TitleCard";
import { TelemetryChart } from "./TelemetryChart";
import { VesselPanel } from "./VesselPanel";

type Section = "overview" | "evidence" | "money" | "records" | "audit";

// long references (CF-LIVE-1791029236301) in Inter, not Space Grotesk: its flagged 1 reads as a 7 at display sizes
const idType = "font-sans font-semibold tracking-tight [overflow-wrap:anywhere]";
const linkCls = "font-semibold text-ink underline decoration-ink/30 underline-offset-2 transition-colors duration-(--duration-fast) hover:decoration-ink";

/**
 * One shipment, for every party (template B, the two-column detail). The header names the shipment, its parties and
 * the four numbers that matter, with the connected wallet's actions right under it on every tab. Overview answers
 * the first questions in plain words (what is happening, where the cargo is, what the journey has paid); the other
 * tabs hold the detail one click away.
 */
export function ShipmentDashboard({ id }: { id: string }) {
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
  const explanation = useExplanation(valid ? id : undefined); // same cache entry as the status brief's
  const coverOn = useCoverEnabled();
  const titleOn = useTitleEnabled();
  const [section, setSection] = useState<Section>("overview");
  // ?recover=1 (from a RECOVERY_READY notification or alert): open on the overview with the recovery panel focused
  const recoverLink = useSearchFlag("recover");
  const tabsRef = useRef<HTMLDivElement>(null);
  const roles = hydrated && shipment.data ? rolesOf(shipment.data, address) : [];

  if (!valid && (byRef.isPending || resolved)) {
    return (
      <div className="container-page py-20 text-center text-text-muted" role="status">
        Looking up {id}…
      </div>
    );
  }
  if (!valid || (shipment.error as { status?: number } | null)?.status === 404) {
    return (
      <NotFound
        title="We couldn't find that shipment"
        description={valid ? "No shipment with this id is tracked by this deployment." : `No shipment id or reference matches “${id}”.`}
        action={<><LinkButton href="/shipments">Browse the fleet</LinkButton><LinkButton href="/exporter" variant="secondary">Open the exporter portal</LinkButton></>}
      />
    );
  }
  if (shipment.isError) {
    return <NotFound title="This shipment could not be loaded" description={shipment.error.message} action={<Button onClick={() => shipment.refetch()}>Try again</Button>} />;
  }
  const v = shipment.data;
  const ev = epochs.data?.epochs ?? [];
  const au = audit.data?.entries ?? [];
  const latest = v?.latestEvidence ?? null;
  const f = v?.facility ?? null;
  const status = f?.status ?? v?.shipment.status;
  const paused = status === "PAUSED";
  const closed = ["SETTLED", "DEFAULTED", "CANCELLED"].includes(f?.status ?? "");
  const recovery = paused || ev.some((e) => e.proofVerified);
  // how far the cargo is from the next milestone's place (contracts v2), for the journey and the milestone table
  const nextIdx = f?.nextMilestone ?? 0;
  const nextDistanceM = v ? nextPlaceDistance({ milestone: v.milestones[nextIdx], index: nextIdx, hold: explanation.data?.hold, latest, position: telemetry.data?.position }) : null;
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
  const recoveryCard = recovery && (
    <Card className={cx(paused && "ring-2 ring-warning ring-offset-0")}>
      <CardHeader title="Zero-knowledge recovery" description={paused ? "Releases are paused. A proof of in-range readings resumes the facility." : undefined} />
      <ProofCard epochs={ev} audit={au} chainId={chainId} paused={paused} />
      {v && <RecoveryPanel view={v} focus={recoverLink && section === "overview"} />}
    </Card>
  );

  return (
    <div className="container-page py-(--space-page-y)">
      {/* header: identity, parties, the four numbers that matter, the record-keeping actions, then the wallet's own actions */}
      <header className="overflow-hidden rounded-sheet shadow-1">
        <div className="surface-ink bg-ink px-5 py-6 text-paper md:px-8 md:py-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="eyebrow">Shipment</span>
                {v ? <StatusPill status={status} onDark /> : <Skeleton className="h-6 w-20 bg-paper/15" />}
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-paper/70">
                  <span className={cx("h-2 w-2 rounded-full", connected ? "animate-pulse-dot bg-success" : "bg-paper/40")} aria-hidden="true" />
                  {connected ? "Live" : "Reconnecting"}
                </span>
              </div>
              <h1 className={cx("mt-2.5 text-h2 md:text-h1", idType)}>{v ? v.shipment.externalRef : <Skeleton className="h-10 w-80 max-w-full bg-paper/15" />}</h1>
              {v && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <CopyField value={v.shipment.exporter} kind="address" chainId={chainId} label="Exporter" size="sm" onDark />
                  {f?.financier && <CopyField value={f.financier} kind="address" chainId={chainId} label="Financier" size="sm" onDark />}
                  <CopyField value={v.shipment.buyer} kind="address" chainId={chainId} label="Buyer" size="sm" onDark />
                </div>
              )}
            </div>
            {v && (
              <div className="flex shrink-0 flex-col gap-3 lg:items-end">
                <div className="flex flex-wrap gap-2">
                  <CertificateButton view={v} epochs={ev} audit={au} chainId={chainId} />
                  <Button size="sm" variant="inverse" onClick={() => go("records")}>Share</Button>
                </div>
                <a
                  href={claudeNewChat(shipmentPrompt(v.shipment.id, v.shipment.externalRef))}
                  target="_blank"
                  rel="noreferrer"
                  title="Opens Claude with this shipment. Enable the CargoFlow connector in that chat (see Developers → Use with Claude)."
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-paper/80 underline decoration-paper/30 underline-offset-2 transition-colors duration-(--duration-fast) hover:text-paper hover:decoration-paper"
                >
                  Ask Claude about this shipment<span className="sr-only"> (opens claude.ai in a new tab; needs the CargoFlow connector)</span>
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" /></svg>
                </a>
              </div>
            )}
          </div>
          <HeaderStats view={v} />
        </div>
        {v && hydrated && (
          <div className="border-x border-b border-border bg-surface px-5 py-4 md:px-8">
            <RoleActions view={v} epochs={ev} />
          </div>
        )}
      </header>

      <div ref={tabsRef} className="mt-6 scroll-mt-20">
        <Tabs label="Shipment sections" tabs={sections} value={section} onChange={(s) => setSection(s as Section)} variant="underline" />
      </div>

      <div id={`panel-${section}`} role="tabpanel" aria-labelledby={`tab-${section}`} key={section} className="mt-6 animate-enter">
        {section === "overview" && (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12 lg:gap-6">
            <div className="flex min-w-0 flex-col gap-4 lg:col-span-8 lg:gap-6">
              {paused && recoveryCard}
              <Card>
                {v ? (
                  <ExplainPanel view={v} fallback={fallbackBrief(v, latest)} roles={roles} position={telemetry.data?.position ?? null} vesselName={vessel.data?.name} />
                ) : (
                  <div className="flex flex-col gap-4" aria-busy="true"><Skeleton className="h-8 w-2/3" /><div className="grid gap-2.5 sm:grid-cols-3"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div></div>
                )}
              </Card>
              <Card>
                <CardHeader title="Route and position" />
                {v ? <RouteMap route={v.shipment.route} position={telemetry.data?.position ?? null} status={f?.status} shipmentId={v.shipment.id} maxRouteDeviationM={v.shipment.policy.maxRouteDeviationM} /> : <Skeleton className="h-72" />}
                <section aria-labelledby="ship-h" className="mt-5 border-t border-border pt-4">
                  <h3 id="ship-h" className="mb-3 font-display text-h4">Ship</h3>
                  {v ? <VesselPanel shipment={v.shipment} closed={closed} /> : <Skeleton className="h-16" />}
                </section>
              </Card>
              <Card>
                <CardHeader title="Latest evidence" description={latest ? `Milestone ${latest.milestoneIndex === 255 ? "–" : latest.milestoneIndex + 1} · batch #${latest.sequence}` : undefined}>
                  {latest && <Button size="sm" variant="ghost" onClick={() => go("evidence")}>All evidence</Button>}
                </CardHeader>
                {v ? <EvidenceGauges view={v} latest={latest} /> : <Skeleton className="h-32" />}
              </Card>
              <Card>
                <CardHeader title="Evidence sources" description="The data loggers and devices that sign this shipment's readings." />
                {v ? <SourcesPanel shipment={v.shipment} chainId={chainId} closed={closed} /> : <Skeleton className="h-16" />}
              </Card>
            </div>
            <aside aria-label="Journey and terms" className="flex min-w-0 flex-col gap-4 lg:col-span-4 lg:gap-6">
              <Card>
                <CardHeader
                  title="Journey"
                  description={f ? <>Each milestone releases its share of the <span className="num">{formatUSDG(f.committed)}</span> USDG once the evidence passes. <button type="button" className={linkCls} onClick={() => go("money")}>See the money</button></> : undefined}
                />
                {v ? <JourneyTimeline milestones={v.milestones} facility={f} invoiceValue={v.shipment.invoiceValue} nextDistanceM={nextDistanceM} /> : <Skeleton className="h-96" />}
              </Card>
              {!paused && recoveryCard}
              {v && coverOn && f && (
                <Card>
                  <CardHeader title="Default cover" />
                  <CoverSummary view={v} onOpen={() => go("money")} />
                </Card>
              )}
              {v && titleOn && f && (
                <Card>
                  <CardHeader title="Title (bill of lading)" />
                  <TitleCard view={v} />
                </Card>
              )}
              {v && <AgreedTerms view={v} chainId={chainId} />}
            </aside>
          </div>
        )}

        {section === "evidence" && (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12 lg:gap-6">
            <Card className="lg:col-span-7">
              <CardHeader title="Latest evidence" description={latest ? `Milestone ${latest.milestoneIndex === 255 ? "–" : latest.milestoneIndex + 1} · batch #${latest.sequence}` : undefined} />
              {v ? <EvidenceGauges view={v} latest={latest} /> : <Skeleton className="h-32" />}
            </Card>
            <div className="flex min-w-0 flex-col gap-4 lg:col-span-5 lg:gap-6">
              <Card>
                <CardHeader title="Monitor decision" />
                {audit.data ? <AiPanel assessment={latestAssessment(au)} /> : <Skeleton className="h-32" />}
              </Card>
              <Card>
                <CardHeader title="Zero-knowledge recovery" />
                <ProofCard epochs={ev} audit={au} chainId={chainId} paused={paused} />
              </Card>
            </div>
            <Card className="lg:col-span-12">
              <CardHeader title="Temperature per batch" description="Each batch is eight readings per probe; the green band is what all parties agreed." />
              {telemetry.data && v ? <TelemetryChart epochs={telemetry.data.epochs} policy={v.shipment.policy} /> : <Skeleton className="h-64" />}
            </Card>
            <Card className="lg:col-span-12">
              <CardHeader title="Committed evidence" description="Only each batch's fingerprint (Merkle root) is on chain." />
              {epochs.data ? <EpochList epochs={ev} chainId={chainId} /> : <Skeleton className="h-40" />}
            </Card>
          </div>
        )}

        {section === "money" && v && (
          <div className="flex flex-col gap-4 lg:gap-6">
            <MoneyStats view={v} />
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12 lg:gap-6">
              <div className="flex min-w-0 flex-col gap-4 lg:col-span-8 lg:gap-6">
                <Card>
                  <CardHeader title="Escrow" description="One segment per milestone: released to the exporter, or still held for the evidence." />
                  <EscrowPanel facility={f} milestones={v.milestones} />
                </Card>
                <Card>
                  <CardHeader title="When the buyer pays" />
                  <Waterfall view={v} />
                </Card>
                <Card>
                  <CardHeader title="Milestone releases" description="Each release is a transaction you can check." />
                  <MilestoneTable milestones={v.milestones} facility={f} chainId={chainId} nextDistanceM={nextDistanceM} />
                </Card>
              </div>
              <aside aria-label="Cover and records" className="flex min-w-0 flex-col gap-4 lg:col-span-4 lg:gap-6">
                {coverOn && (
                  <Card>
                    <CardHeader title="Default cover" />
                    <CoverPanel view={v} />
                  </Card>
                )}
                <Card>
                  <CardHeader title="Records" />
                  <p className="text-sm text-text-muted">A PDF of the agreement, every milestone&apos;s evidence and transaction, the waterfall and the attested documents. It becomes the settlement certificate once the invoice is paid.</p>
                  <CertificateButton view={v} epochs={ev} audit={au} chainId={chainId} variant="secondary" className="mt-4" />
                </Card>
              </aside>
            </div>
          </div>
        )}

        {section === "records" && v && (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12 lg:gap-6">
            <div className="flex min-w-0 flex-col gap-4 lg:col-span-7 lg:gap-6">
              <Card>
                <CardHeader title="Documents" />
                <DocumentsPanel view={v} />
              </Card>
              <Card>
                <CardHeader title="Standards export" />
                <EpcisDownload shipmentId={v.shipment.id} reference={v.shipment.externalRef} />
              </Card>
            </div>
            <div className="flex min-w-0 flex-col gap-4 lg:col-span-5 lg:gap-6">
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

        {section === "audit" && (
          <Card>
            <CardHeader title="Audit trail" description="Every event, decision and transaction, newest first. Open a row for its transaction and details." />
            {audit.data ? <AuditTable entries={au} chainId={chainId} /> : <Skeleton className="h-64" />}
          </Card>
        )}
      </div>

      <p className="mt-10 text-center text-small text-text-muted">
        Raw readings stay private: this page shows per-batch aggregates; the chain holds only their fingerprints. <Link href="/#how-it-works" className={linkCls}>How it works</Link>
      </p>
    </div>
  );
}

/** A full-page problem state: the empty state carries the page's one h1. */
function NotFound({ title, description, action }: { title: string; description: React.ReactNode; action: React.ReactNode }) {
  return (
    <div className="container-page py-(--space-page-y)">
      <EmptyState as="h1" title={title} description={description} action={action} className="mx-auto max-w-2xl" />
    </div>
  );
}

/** Invoice, financing, money released and the latest evidence score, under the shipment's name. */
function HeaderStats({ view }: { view: ShipmentView | undefined }) {
  const loading = !view;
  const f = view?.facility ?? null;
  const latest = view?.latestEvidence ?? null;
  const pct = f && BigInt(f.committed) > 0n ? Number((BigInt(f.drawn) * 1000n) / BigInt(f.committed)) / 10 : 0;
  return (
    <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-border-ink pt-5 lg:grid-cols-4">
      <Stat onDark tile={false} loading={loading} label="Invoice" value={view ? formatUSDG(view.shipment.invoiceValue) : ""} unit="USDG" hint={f?.status === "SETTLED" ? "Paid by the buyer" : "Paid by the buyer on delivery"} />
      <Stat onDark tile={false} loading={loading} label="Financing" value={f ? formatUSDG(f.committed) : "None yet"} unit={f ? "USDG" : undefined} hint={f ? `${f.feeBps / 100}% fee on what is drawn` : "No facility opened"} />
      <Stat
        onDark
        tile={false}
        loading={loading}
        label="Released to the exporter"
        value={f ? formatUSDG(f.drawn) : "–"}
        unit={f ? "USDG" : undefined}
        hint={
          f ? (
            <span className="flex flex-col gap-1.5">
              <span className="num">{f.nextMilestone} of {f.milestoneCount} milestones</span>
              <span className="block h-1 w-full max-w-40 overflow-hidden rounded-full bg-paper/15" aria-hidden="true">
                <span className="block h-full rounded-full bg-signal transition-[width] duration-(--duration-slow) ease-standard" style={{ width: `${pct}%` }} />
              </span>
            </span>
          ) : "Not financed"
        }
      />
      <Stat onDark tile={false} loading={loading} label="Latest evidence score" value={latest ? String(latest.score) : "–"} unit={latest ? "/ 100" : undefined} hint={view ? (latest ? `Needs ${view.shipment.policy.minEvidenceScore}+ to release` : "No evidence yet") : undefined} />
    </div>
  );
}

/** The money in four numbers: committed, released, still in escrow and the fee. */
function MoneyStats({ view }: { view: ShipmentView }) {
  const f = view.facility;
  if (!f) return null;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Stat label="Committed" value={formatUSDG(f.committed)} unit="USDG" hint={`For ${f.milestoneCount} milestones`} />
      <Stat label="Released to the exporter" value={formatUSDG(f.drawn)} unit="USDG" hint={`${f.nextMilestone} of ${f.milestoneCount} milestones`} />
      <Stat label="Still in escrow" value={formatUSDG(f.remaining)} unit="USDG" hint={f.status === "PAUSED" ? "Held by the pause" : f.status === "SETTLED" ? "Closed" : "Released on passing evidence"} />
      <Stat label="Financing fee" value={String(f.feeBps / 100)} unit="%" hint="Of what is drawn" />
    </div>
  );
}

function EvidenceGauges({ view, latest }: { view: ShipmentView; latest: EpochSummary | null }) {
  const p = view.shipment.policy;
  if (!latest) {
    return <EmptyState size="sm" frame="plain" title="No evidence yet" description="The gauges appear when the data logger's first batch of eight readings is evaluated." />;
  }
  const hum = latest.maxHumidityX100, shock = latest.maxShockX100;
  const showLimits = p.maxHumidityX100 > 0 || p.maxShockX100 > 0 || hum > 0 || shock > 0;
  return (
    <div className="flex flex-col gap-4">
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
      {showLimits && (
        <dl className="grid grid-cols-2 divide-x divide-border border-t border-border pt-3">
          <Maximum label="Highest humidity in the batch" value={`${formatPct(hum)} RH`} limit={p.maxHumidityX100 ? `limit ${formatPct(p.maxHumidityX100)}` : "no limit"} over={p.maxHumidityX100 > 0 && hum > p.maxHumidityX100} />
          <Maximum label="Hardest shock in the batch" value={formatG(shock)} limit={p.maxShockX100 ? `limit ${formatG(p.maxShockX100)}` : "no limit"} over={p.maxShockX100 > 0 && shock > p.maxShockX100} />
        </dl>
      )}
      {latest.sources.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="eyebrow">Source devices</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {latest.sources.map((s) => (
              <li key={s.keyHash} className="flex flex-wrap items-center gap-2">
                <DeviceBadge deviceClass={s.deviceClass} onChain={s.onChain} />
                <CopyField value={s.keyHash} kind="hash" label="Key" size="sm" />
              </li>
            ))}
          </ul>
        </div>
      )}
      {isHeld(latest) && (
        <Callout variant="info" title="Held: not at the place yet.">
          This evidence passed, but it was taken {latest.heldDistanceM !== null ? `${distanceText(latest.heldDistanceM)} from` : "outside"} the milestone&apos;s place, so the milestone waits. Nothing failed.
        </Callout>
      )}
    </div>
  );
}

const formatPct = (x100: number) => `${Number((x100 / 100).toFixed(1))}%`;
const formatG = (x100: number) => `${Number((x100 / 100).toFixed(2))} g`;

function Maximum({ label, value, limit, over }: { label: string; value: string; limit: string; over: boolean }) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <dt className="text-small text-text-muted">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
        <span className={cx("num text-body font-semibold", over ? "text-danger-fg" : "text-ink")}>{value}</span>
        <span className={cx("text-caption", over ? "font-semibold text-danger-fg" : "text-text-muted")}>{limit}</span>
      </dd>
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
    ["Humidity", p.maxHumidityX100 ? `At most ${formatPct(p.maxHumidityX100)} relative humidity` : "No limit"],
    ["Shock", p.maxShockX100 ? `No shock above ${formatG(p.maxShockX100)}` : "No limit"],
    ["To release money", `Evidence score ${p.minEvidenceScore}+${p.requiresZk ? " and a proof" : ""}`],
    ...(f ? ([["Financing fee", `${f.feeBps / 100}% of what is drawn`]] as [string, string][]) : []),
    // milestone places (contracts v2): where each placed milestone's evidence must come from
    ...view.milestones.filter((m) => hasPlace(m)).map((m): [string, string] => [`Milestone ${m.index + 1}`, `Releases only ${placePhrase(m)}`]),
  ];
  return (
    <Card>
      <CardHeader title="What was agreed" description="Fixed at registration: no party can change these terms afterwards." />
      <KeyValue layout="grid" columns={2} dense items={terms.map(([k, val]) => ({ label: k, value: val }))} className="gap-y-3" />
      <details className="group mt-5 border-t border-border pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          On-chain references
          <span aria-hidden="true" className="text-text-muted transition-transform duration-(--duration-fast) group-open:rotate-90">›</span>
        </summary>
        <div className="mt-3 flex flex-col items-start gap-1.5">
          <CopyField value={view.shipment.id} kind="hash" label="Shipment" size="sm" />
          <CopyField value={view.shipment.invoiceHash} kind="hash" label="Invoice hash" size="sm" />
          <CopyField value={view.shipment.routeCommitment} kind="hash" label="Route" size="sm" />
          <CopyField value={view.shipment.policyCommitment} kind="hash" label="Terms" size="sm" />
          {chainId && <span className="text-caption text-text-muted">Chain <span className="num">{chainId}</span></span>}
        </div>
      </details>
    </Card>
  );
}
