"use client";

import Link from "next/link";
import { useState } from "react";
import { keccak256, toBytes } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { Callout } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CopyField } from "@/components/ui/CopyField";
import { CastEmptyState } from "@/components/cast/CastEmptyState";
import { Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { StatusPill } from "@/components/ui/Pill";
import { Section } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { Stat } from "@/components/ui/Stat";
import { NetworkGuard } from "@/components/wallet/NetworkGuard";
import { useConfig, useShipmentsByStatus, useShipmentViews } from "@/lib/api/hooks";
import type { ShipmentView } from "@/lib/api/schemas";
import { accessAbi, controllerAbi } from "@/lib/chain/abis";
import { useContracts } from "@/lib/chain/contracts";
import { useTx } from "@/lib/chain/useTx";
import { formatUSDG } from "@/lib/format";

import { DISPUTE_ROLE } from "@/lib/chain/roles";
const QUEUE = ["DISPUTED", "PAUSED", "DELIVERED"];
const ORDER: Record<string, number> = { DISPUTED: 0, PAUSED: 1, DELIVERED: 2 };

type Decision = {
  title: string;
  description: string;
  confirm: string;
  danger?: boolean;
  noteLabel: string;
  run: (note: `0x${string}`) => Promise<unknown>;
};

/** The on-chain dispute role's console: resolve disputes, lift pauses on a verified basis, declare defaults. */
export function ArbiterConsole() {
  const { address } = useAccount();
  const { contracts, chainId } = useContracts();
  const config = useConfig();
  const role = useReadContract({
    address: contracts?.access,
    abi: accessAbi,
    functionName: "hasRole",
    args: address ? [DISPUTE_ROLE, address] : undefined,
    chainId: chainId as never,
    query: { enabled: !!contracts && !!address },
  });
  const queue = useShipmentsByStatus(QUEUE);
  const views = useShipmentViews((queue.data?.shipments ?? []).map((s) => s.id));
  const items = views
    .map((q) => q.data)
    .filter((v): v is ShipmentView => !!v?.facility && QUEUE.includes(v.facility.status))
    .sort((a, b) => (ORDER[a.facility!.status] ?? 9) - (ORDER[b.facility!.status] ?? 9));
  const isArbiter = role.data === true;
  // a disabled query (no contracts or no wallet yet) stays "pending" forever in TanStack Query: that is "unknown", not loading
  const roleDisabled = !contracts || !address;

  const count = (st: string) => items.filter((v) => v.facility!.status === st).length;
  return (
    <div className="container-page py-(--space-page-y)">
      <PortalHeader
        eyebrow="For arbiters"
        who="arbiter"
        greeting="Hi, I'm the Arbiter"
        title="Decide disputes on the record"
        lede="Holders of the on-chain dispute role resolve disputes, lift pauses on a verified basis and declare defaults. Every decision carries a hashed reference anyone can audit."
      />
      <NetworkGuard
        purpose="Arbitration happens from the wallet that holds the dispute role on chain."
        points={["Resume a disputed facility with a recorded reference", "Lift an evidence pause on independent verification", "Declare a default that returns undrawn capital"]}
      >
        <div className="flex flex-col gap-10">
          {config.isError ? (
            <Callout variant="danger" live="assertive" title="The deployment's configuration could not be loaded" action={<Button variant="secondary" size="sm" loading={config.isFetching} onClick={() => void config.refetch()}>Try again</Button>}>
              Without it this page cannot find the access contract to check the dispute role. {config.error.message}
            </Callout>
          ) : roleDisabled ? (
            config.isPending ? <Skeleton className="h-24 rounded-card" /> : null
          ) : role.isPending ? (
            <Skeleton className="h-24 rounded-card" />
          ) : role.isError ? (
            <Callout variant="warning" live="assertive" title="The dispute role could not be checked" action={<Button variant="secondary" size="sm" loading={role.isFetching} onClick={() => void role.refetch()}>Check again</Button>}>
              The network did not answer. You can follow the queue below and try again in a moment.
            </Callout>
          ) : !isArbiter ? (
            <Card tone="paper" className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <h2 className="font-display text-h3">This wallet is not an arbiter</h2>
                <p className="mt-1 max-w-reading text-sm text-text-muted">
                  Only a wallet granted the dispute role in the CargoFlow access contract can decide disputes. The protocol admin grants it on chain, and every grant is public. You can still follow the queue below.
                </p>
              </div>
              {address && <CopyField value={address} label="Connected" kind="address" chainId={chainId} className="shrink-0" />}
            </Card>
          ) : null}

          <Section title="Queue" description="Disputed first, then paused, then delivered but unpaid.">
            {queue.isPending ? (
              <Skeleton className="h-40 rounded-card" />
            ) : queue.isError ? (
              <Callout variant="danger" title="The queue could not be loaded" action={<Button variant="secondary" size="sm" loading={queue.isFetching} onClick={() => void queue.refetch()}>Try again</Button>}>
                {queue.error.message}
              </Callout>
            ) : items.length === 0 ? (
              <CastEmptyState who="arbiter" title="Nothing to decide" description="Disputed, paused and unpaid delivered facilities appear here as soon as they happen." />
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-4">
                  <Stat size="sm" label="Disputed" value={count("DISPUTED")} />
                  <Stat size="sm" label="Paused" value={count("PAUSED")} />
                  <Stat size="sm" label="Unpaid" value={count("DELIVERED")} />
                </div>
                <Card padded={false} className="overflow-hidden">
                  <ul className="divide-y divide-border" aria-label="Cases to decide">
                    {items.map((v) => (
                      <CaseCard key={v.shipment.id} view={v} canAct={isArbiter} chainId={chainId} />
                    ))}
                  </ul>
                </Card>
              </div>
            )}
          </Section>
        </div>
      </NetworkGuard>
    </div>
  );
}

function CaseCard({ view, canAct, chainId }: { view: ShipmentView; canAct: boolean; chainId?: number }) {
  const f = view.facility!;
  const id = view.shipment.id as `0x${string}`;
  const { contracts } = useContracts();
  const { send } = useTx();
  const [decision, setDecision] = useState<Decision | null>(null);
  const controller = contracts?.controller;

  const call = (functionName: string, args: readonly unknown[], label: string, successTitle: string) =>
    controller ? send({ address: controller, abi: controllerAbi, functionName, args, label, successTitle }) : Promise.resolve(undefined);

  const situation =
    f.status === "DISPUTED"
      ? "A party opened a dispute. Releases are frozen until you resume the facility or declare a default."
      : f.status === "PAUSED"
        ? "The evidence failed the policy and releases are paused. The exporter can resume with a zero-knowledge proof, or you can lift the pause on a verified basis."
        : "Every milestone was released and delivery was confirmed, but the invoice is unpaid.";

  return (
    <li className="grid gap-4 p-4 md:p-5 lg:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-2 lg:col-span-7">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/track/${id}`} className="font-display text-h4 underline-offset-2 hover:underline">{view.shipment.externalRef}</Link>
          <StatusPill status={f.status} />
          <span className="num text-small text-text-muted">Milestone {Math.min(f.nextMilestone + 1, f.milestoneCount)} of {f.milestoneCount}</span>
        </div>
        <p className="max-w-reading text-sm text-ink/80">{situation}</p>
        <div className="flex flex-wrap gap-2">
          <CopyField value={f.exporter} kind="address" chainId={chainId} label="Exporter" size="sm" />
          <CopyField value={f.financier} kind="address" chainId={chainId} label="Financier" size="sm" />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3 lg:col-span-5 lg:items-end">
        <dl className="grid w-full grid-cols-3 gap-3 text-sm lg:max-w-sm">
          <div><dt className="text-small text-text-muted">Committed</dt><dd className="num font-semibold">{formatUSDG(f.committed)}</dd></div>
          <div><dt className="text-small text-text-muted">Drawn</dt><dd className="num font-semibold">{formatUSDG(f.drawn)}</dd></div>
          <div><dt className="text-small text-text-muted">Invoice</dt><dd className="num font-semibold">{formatUSDG(view.shipment.invoiceValue)}</dd></div>
        </dl>
      {canAct && (
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {f.status === "DISPUTED" && (
            <Button
              onClick={() =>
                setDecision({
                  title: "Resume the facility",
                  description: "The dispute is resolved in the exporter's favour: releases continue from the next milestone.",
                  confirm: "Resolve and resume",
                  noteLabel: "Resolution reference",
                  run: (note) => call("resolveDispute", [id, true, note], "Resolve dispute", "Dispute resolved: facility resumed"),
                })
              }
            >
              Resume
            </Button>
          )}
          {f.status === "PAUSED" && (
            <Button
              onClick={() =>
                setDecision({
                  title: "Lift the pause",
                  description: "Use this only on independent verification, for example a surveyor's report that the goods are sound.",
                  confirm: "Lift the pause",
                  noteLabel: "Basis for lifting the pause",
                  run: (note) => call("resumeByVerifier", [id, note], "Lift pause", "Pause lifted"),
                })
              }
            >
              Lift the pause
            </Button>
          )}
          <Button
            variant="danger-outline"
            onClick={() =>
              setDecision({
                title: "Declare a default",
                description: "This closes the facility for good. The undrawn capital returns to the financier and nothing more is released. It cannot be undone.",
                confirm: "Declare default",
                danger: true,
                noteLabel: "Default reference",
                run: (note) =>
                  f.status === "DISPUTED"
                    ? call("resolveDispute", [id, false, note], "Declare default", "Dispute resolved: facility defaulted")
                    : call("markDefaulted", [id, note], "Declare default", "Facility defaulted"),
              })
            }
          >
            Declare default
          </Button>
        </div>
      )}
      </div>
      {decision && <DecisionModal decision={decision} onClose={() => setDecision(null)} />}
    </li>
  );
}

function DecisionModal({ decision, onClose }: { decision: Decision; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const text = note.trim();
  const hash = text ? keccak256(toBytes(text)) : null;
  return (
    <Modal open onClose={onClose} title={decision.title} description={decision.description}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!hash) return;
          setBusy(true);
          const tx = await decision.run(hash);
          setBusy(false);
          if (tx) onClose();
        }}
      >
        <Textarea
          label={decision.noteLabel}
          data-autofocus
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Case 2026-07: survey report SGS-118 confirms the cargo was within temperature on arrival."
          help="Only its keccak-256 hash goes on chain."
        />
        {hash && <p className="text-small text-text-muted">Recorded on chain as <code className="font-mono text-caption break-all text-ink">{hash}</code>.</p>}
        <Button type="submit" variant={decision.danger ? "danger" : "primary"} loading={busy} disabled={!hash}>{decision.confirm}</Button>
      </form>
    </Modal>
  );
}
