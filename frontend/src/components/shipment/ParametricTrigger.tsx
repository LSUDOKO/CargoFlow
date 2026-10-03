"use client";

import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { useEpochs } from "@/lib/api/hooks";
import type { Cover, ShipmentView } from "@/lib/api/schemas";
import { coverPoolAbi } from "@/lib/chain/abis";
import { useContracts } from "@/lib/chain/contracts";
import { useTx } from "@/lib/chain/useTx";
import { useEpochOrdinals } from "@/lib/chain/v3";
import { findTrigger, parametricSplit, type OrdinalEpoch } from "@/lib/cover";
import { formatUSDG } from "@/lib/format";

/**
 * The parametric trigger of an active cover (contracts v3): how many failed evidence batches in a row it needs, how
 * many the record shows, and, once met, a button anyone can press to prove it with the epoch ids
 * (CoverPool.triggerParametric). Ordinals come from the chain (EvidenceRegistry.epochOrdinal); without them the
 * backend's commit order stands in, and the contract has the final word either way.
 */
export function ParametricTrigger({ view, cover }: { view: ShipmentView; cover: Cover }) {
  const { contracts } = useContracts();
  const id = view.shipment.id;
  const epochs = useEpochs(id);
  const committed = (epochs.data?.epochs ?? []).filter((e) => !!e.commitTx).sort((a, b) => a.sequence - b.sequence || a.createdAt.localeCompare(b.createdAt));
  // the newest 64 are enough: N is at most 32
  const recent = committed.slice(-64);
  const chain = useEpochOrdinals(id, recent.map((e) => e.epochId));
  const { send, pending } = useTx();
  const p = cover.parametric!;
  const f = view.facility!;
  const fromChain = recent.some((e) => (chain.ordinals.get(e.epochId.toLowerCase()) ?? 0) > 0);
  const list: OrdinalEpoch[] = recent.map((e, i) => ({
    epochId: e.epochId,
    ordinal: fromChain ? (chain.ordinals.get(e.epochId.toLowerCase()) ?? 0) : committed.length - recent.length + i + 1,
    compliant: e.compliant,
  }));
  const check = findTrigger(list, p.consecutiveFailedEpochs, p.epochFloor);
  const split = parametricSplit(cover.amount, f.drawn, p.salvageToExporter);
  const n = p.consecutiveFailedEpochs;
  const pct = Math.min(100, Math.round((Math.min(check.streak, n) / n) * 100));

  return (
    <div className={`flex flex-col gap-3 rounded-2xl px-4 py-4 ${check.met ? "bg-danger/8 ring-2 ring-danger/40" : "bg-mist"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Parametric trigger</h3>
        {check.met ? <Pill tone="danger" dot>Trigger met</Pill> : <Pill tone="slate">Not met</Pill>}
      </div>
      <p className="text-sm">
        Pays out when <b>{n} committed evidence {n === 1 ? "batch fails" : "batches fail"} in a row</b> after the cover was accepted
        {p.epochFloor > 0 ? ` (after batch ${p.epochFloor})` : ""}, while the facility is in transit, paused or disputed.
      </p>
      <div>
        <div className="flex justify-between text-xs text-slate">
          <span>Failed in a row</span>
          <span className="font-mono font-semibold text-ink tabular">{Math.min(check.streak, n)} of {n}</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink/10" role="img" aria-label={`${Math.min(check.streak, n)} of ${n} failed batches in a row`}>
          <span className={`block h-full ${check.met ? "bg-danger" : "bg-alert"}`} style={{ width: `${check.met ? 100 : pct}%` }} />
        </div>
      </div>
      <SplitTable financier={split.financier} exporter={split.exporter} insurer={split.insurer} caption={check.met ? "Triggering now credits" : "If triggered now"} />
      {check.met && contracts?.coverPool && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            variant="danger"
            loading={pending}
            onClick={() => send({ address: contracts.coverPool!, abi: coverPoolAbi, functionName: "triggerParametric", args: [id as `0x${string}`, check.epochIds as `0x${string}`[]], label: "Trigger the cover", successTitle: "Parametric cover triggered" })}
          >
            Trigger the payout
          </Button>
          <p className="text-xs text-slate">Anyone can press this: the contract checks the {n} batches itself. Each party then collects its share.</p>
        </div>
      )}
    </div>
  );
}

/** The three-way split of a parametric payout. */
export function SplitTable({ financier, exporter, insurer, caption }: { financier: bigint | string; exporter: bigint | string; insurer: bigint | string; caption: string }) {
  const rows: [string, bigint | string, string][] = [
    ["Financier", financier, "min(cover, principal drawn)"],
    ["Exporter salvage", exporter, "min(salvage, what is left)"],
    ["Back to the insurer", insurer, "the remainder"],
  ];
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-slate uppercase">{caption}</p>
      <dl className="mt-1.5 divide-y divide-line text-sm">
        {rows.map(([k, v, why]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 py-1.5">
            <dt>{k} <span className="text-xs text-slate">· {why}</span></dt>
            <dd className="font-mono font-semibold whitespace-nowrap tabular">{formatUSDG(v)} USDG</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
