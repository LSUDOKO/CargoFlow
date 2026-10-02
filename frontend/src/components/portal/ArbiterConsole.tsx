"use client";

import Link from "next/link";
import { useState } from "react";
import { keccak256, toBytes } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { HashBadge } from "@/components/ui/HashBadge";
import { Modal } from "@/components/ui/Modal";
import { StatusPill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { NetworkGuard } from "@/components/wallet/NetworkGuard";
import { useShipmentsByStatus, useShipmentViews } from "@/lib/api/hooks";
import type { ShipmentView } from "@/lib/api/schemas";
import { accessAbi, controllerAbi } from "@/lib/chain/abis";
import { useContracts } from "@/lib/chain/contracts";
import { useTx } from "@/lib/chain/useTx";
import { formatUSDG } from "@/lib/format";

export const DISPUTE_ROLE = keccak256(toBytes("DISPUTE_ROLE"));
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

  return (
    <div className="container-page flex flex-col gap-6 py-10">
      <PortalHeader
        title="Decide disputes"
        mark="on the record"
        lede="Holders of the on-chain dispute role resolve disputes, lift pauses on a verified basis and declare defaults. Every decision is a transaction with a hashed reference anyone can audit."
        art="zk"
      />
      <NetworkGuard purpose="Arbitration happens from the wallet that holds the dispute role on chain.">
        {role.isPending ? (
          <Skeleton className="h-24" />
        ) : !isArbiter ? (
          <Card>
            <h2 className="font-display text-2xl font-semibold">This wallet is not an arbiter</h2>
            <p className="mt-2 max-w-2xl text-slate">
              Only a wallet granted the dispute role in the CargoFlow access contract can decide disputes. The role is granted by the protocol admin, on chain, and every grant is public. You can still follow the queue below.
            </p>
            {address && <div className="mt-4"><HashBadge value={address} kind="address" chainId={chainId} label="connected" /></div>}
          </Card>
        ) : null}

        {queue.isPending ? (
          <Skeleton className="h-40" />
        ) : items.length === 0 ? (
          <Card className="text-center">
            <p className="font-display text-2xl font-semibold">Nothing to decide</p>
            <p className="mx-auto mt-2 max-w-md text-slate">Disputed, paused and unpaid delivered facilities appear here as soon as they happen.</p>
          </Card>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {items.map((v) => (
              <li key={v.shipment.id}>
                <CaseCard view={v} canAct={isArbiter} chainId={chainId} />
              </li>
            ))}
          </ul>
        )}
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
    <Card className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/track/${id}`} className="font-display text-xl font-semibold hover:underline">{view.shipment.externalRef}</Link>
          <p className="mt-1 text-sm text-slate">Milestone {Math.min(f.nextMilestone + 1, f.milestoneCount)} of {f.milestoneCount}</p>
        </div>
        <StatusPill status={f.status} />
      </div>
      <p className="text-sm">{situation}</p>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div><dt className="text-slate">Committed</dt><dd className="font-mono font-semibold">{formatUSDG(f.committed)}</dd></div>
        <div><dt className="text-slate">Drawn</dt><dd className="font-mono font-semibold">{formatUSDG(f.drawn)}</dd></div>
        <div><dt className="text-slate">Invoice</dt><dd className="font-mono font-semibold">{formatUSDG(view.shipment.invoiceValue)}</dd></div>
      </dl>
      <div className="flex flex-wrap gap-2 text-sm">
        <HashBadge value={f.exporter} kind="address" chainId={chainId} label="exporter" compact />
        <HashBadge value={f.financier} kind="address" chainId={chainId} label="financier" compact />
      </div>
      {canAct && (
        <div className="mt-auto flex flex-wrap gap-2">
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
            variant="danger"
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
      {decision && <DecisionModal decision={decision} onClose={() => setDecision(null)} />}
    </Card>
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
        <label htmlFor="decision-note" className="text-sm font-semibold">{decision.noteLabel}</label>
        <textarea
          id="decision-note"
          data-autofocus
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Case 2026-07: survey report SGS-118 confirms the cargo was within temperature on arrival."
          className="rounded-2xl border-2 border-line bg-white p-3 outline-none focus:border-ink"
        />
        {hash && <p className="text-sm text-slate">Recorded on chain as <code className="font-mono text-xs break-all text-ink">{hash}</code>.</p>}
        <Button type="submit" variant={decision.danger ? "danger" : "primary"} loading={busy} disabled={!hash}>{decision.confirm}</Button>
      </form>
    </Modal>
  );
}
