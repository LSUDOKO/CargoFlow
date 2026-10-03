"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { HashBadge } from "@/components/ui/HashBadge";
import { Pill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import type { ShipmentView } from "@/lib/api/schemas";
import { controllerAbi, eblRegistryAbi } from "@/lib/chain/abis";
import { useContracts } from "@/lib/chain/contracts";
import { useTx } from "@/lib/chain/useTx";
import { useControllerApproval, useMyBills, usePaused, useTitle } from "@/lib/chain/v3";
import { bindableReason, DAP_RULE, EBL_STATUS_LABEL, eblStatusTone, isToOrder, MLETR_NOTE, parseTokenId, type Bill } from "@/lib/ebl";
import { useHydrated } from "@/lib/useHydrated";
import { PausedBanner } from "./PausedBanner";

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** True when the deployment has a bill of lading registry (contracts v3). */
export function useTitleEnabled() {
  return !!useContracts().contracts?.eblRegistry;
}

/**
 * The facility's electronic bill of lading (contracts v3): which bill is bound, where it is now, and the rule that
 * moves it (documents against payment). The exporter binds a bill it holds from here while CREATED or FINANCED.
 */
export function TitleCard({ view }: { view: ShipmentView }) {
  const hydrated = useHydrated();
  const { address } = useAccount();
  const { contracts, chainId } = useContracts();
  const title = useTitle(view);
  const f = view.facility;
  if (!contracts?.eblRegistry || !f) return null;
  const bill = title.bill;
  const isExporter = hydrated && same(address, f.exporter);
  const open = f.status === "CREATED" || f.status === "FINANCED";
  const where = bill ? whereIsIt(bill.holder, { controller: contracts.controller, buyer: f.buyer, financier: f.financier, exporter: f.exporter }) : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-2xl bg-mist px-4 py-3 text-sm">
        <span className="font-semibold">{DAP_RULE.split(":")[0]}:</span>
        {DAP_RULE.slice(DAP_RULE.indexOf(":") + 1)}
      </p>
      {title.loading && !bill ? (
        <Skeleton className="h-20" />
      ) : bill ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/ebl/${bill.tokenId}`} className="font-display text-2xl font-bold hover:underline">Bill #{String(bill.tokenId)}</Link>
            <div className="flex flex-wrap gap-1.5">
              <Pill tone={eblStatusTone(bill.status)} dot>{EBL_STATUS_LABEL[bill.status]}</Pill>
              {where && <Pill tone={where.tone}>{where.label}</Pill>}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-slate">Held by</dt><dd>{where?.escrow ? <span className="font-medium">The financing contract (escrow)</span> : <HashBadge value={bill.holder} kind="address" chainId={chainId} compact />}</dd></div>
            <div><dt className="text-slate">Consignee</dt><dd>{isToOrder(bill.consignee) ? <span className="font-medium">To order</span> : <HashBadge value={bill.consignee} kind="address" chainId={chainId} compact />}</dd></div>
            <div className="col-span-2"><dt className="text-slate">Document fingerprint</dt><dd><HashBadge value={bill.documentHash} compact /></dd></div>
          </dl>
          {where?.escrow && <p className="text-sm text-slate">While bound nobody can move it: not the exporter, the carrier or the admin. It leaves escrow only by the rule above.</p>}
        </div>
      ) : (
        <p className="text-sm text-slate">{open ? "No bill of lading is bound yet. The exporter can bind one before transit starts." : "No bill of lading was bound to this facility."}</p>
      )}
      {!bill && open && isExporter && <BindTitle view={view} />}
      <p className="text-xs text-slate">{MLETR_NOTE}</p>
    </div>
  );
}

function whereIsIt(holder: string, p: { controller: string; buyer: string; financier: string; exporter: string }): { label: string; tone: "verified" | "ink" | "alert" | "slate"; escrow?: boolean } {
  if (same(holder, p.controller)) return { label: "In escrow", tone: "ink", escrow: true };
  if (same(holder, p.buyer)) return { label: "With the buyer", tone: "verified" };
  if (same(holder, p.financier)) return { label: "With the financier", tone: "alert" };
  if (same(holder, p.exporter)) return { label: "With the exporter", tone: "slate" };
  return { label: "Endorsed onward", tone: "slate" };
}

/** Approve the controller for the bill, then bindTitle: the bill moves into escrow. */
function BindTitle({ view }: { view: ShipmentView }) {
  const { address } = useAccount();
  const { contracts } = useContracts();
  const paused = usePaused();
  const mine = useMyBills(address);
  const { send, pending } = useTx();
  const f = view.facility!;
  const candidates = mine.held.filter((b) => !bindableReason(b, f.exporter, f.buyer));
  const others = mine.held.filter((b) => bindableReason(b, f.exporter, f.buyer));
  const [picked, setPicked] = useState<string>("");
  const [manual, setManual] = useState("");
  const tokenId = picked ? BigInt(picked) : parseTokenId(manual);
  const approval = useControllerApproval(tokenId, address);
  const id = view.shipment.id as `0x${string}`;
  if (!contracts?.eblRegistry) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="font-semibold">Bind a bill of lading</h3>
      {paused.controller && <PausedBanner />}
      {mine.loading ? (
        <Skeleton className="h-12" />
      ) : candidates.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-slate">Bills you hold that can be bound (live, consigned to the buyer or to order)</legend>
          {candidates.map((b) => (
            <BillChoice key={String(b.tokenId)} bill={b} checked={picked === String(b.tokenId)} onChange={() => { setPicked(String(b.tokenId)); setManual(""); }} />
          ))}
        </fieldset>
      ) : (
        <p className="text-sm text-slate">
          {others.length > 0 ? `You hold ${others.length} ${others.length === 1 ? "bill" : "bills"}, but none can be bound here: ${bindableReason(others[0]!, f.exporter, f.buyer)}` : "This wallet holds no live bill of lading. The carrier issues one to the shipper from the carrier portal."}
        </p>
      )}
      {candidates.length === 0 && (
        <Field label="Bill number" value={manual} onChange={(e) => { setManual(e.target.value); setPicked(""); }} inputMode="numeric" placeholder="12" hint="The number the carrier gave the bill." className="max-w-xs" />
      )}
      <div className="flex flex-wrap gap-2">
        {tokenId && !approval.approved && (
          <Button
            variant="secondary"
            loading={pending}
            disabled={paused.controller || approval.loading}
            onClick={() => send({ address: contracts.eblRegistry!, abi: eblRegistryAbi, functionName: "approve", args: [contracts.controller, tokenId], label: `Approve bill #${tokenId}`, successTitle: `The financing contract may now escrow bill #${tokenId}` })}
          >
            1. Approve bill #{String(tokenId)}
          </Button>
        )}
        <Button
          loading={pending}
          disabled={!tokenId || paused.controller || (!approval.approved && !approval.loading)}
          onClick={() => tokenId && send({ address: contracts.controller, abi: controllerAbi, functionName: "bindTitle", args: [id, tokenId], label: "Bind bill of lading", successTitle: `Bill #${tokenId} bound: it is now in escrow` })}
        >
          {tokenId && !approval.approved ? "2. " : ""}Bind bill of lading
        </Button>
      </div>
    </div>
  );
}

function BillChoice({ bill, checked, onChange }: { bill: Bill; checked: boolean; onChange: () => void }) {
  return (
    <label className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-2.5 text-sm ${checked ? "border-ink bg-ink/4" : "border-line hover:border-ink/40"}`}>
      <input type="radio" name="bind-bill" checked={checked} onChange={onChange} className="accent-[var(--color-ink)]" />
      <span className="font-semibold">Bill #{String(bill.tokenId)}</span>
      <span className="text-slate">{isToOrder(bill.consignee) ? "To order" : "Named consignee"}</span>
      <span className="ml-auto"><HashBadge value={bill.documentHash} compact /></span>
    </label>
  );
}
