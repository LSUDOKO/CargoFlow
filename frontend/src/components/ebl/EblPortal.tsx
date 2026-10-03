"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseEventLogs } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { HashBadge } from "@/components/ui/HashBadge";
import { Pill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { NetworkGuard } from "@/components/wallet/NetworkGuard";
import { eblRegistryAbi } from "@/lib/chain/abis";
import { useContracts } from "@/lib/chain/contracts";
import { useTx } from "@/lib/chain/useTx";
import { useIsCarrier, useMyBills } from "@/lib/chain/v3";
import { EBL_STATUS_LABEL, eblStatusTone, isToOrder, MLETR_NOTE, parseTokenId, validateIssue, type Bill, type IssueForm } from "@/lib/ebl";
import { useHydrated } from "@/lib/useHydrated";
import { BillActions } from "./BillActions";
import { DocumentDrop } from "./DocumentDrop";

/** The carrier portal: look up a bill, issue bills (CARRIER_ROLE), and act on the bills this wallet holds. */
export function EblPortal() {
  const { contracts } = useContracts();
  const hydrated = useHydrated();
  return (
    <div className="container-page flex flex-col gap-6 py-10">
      <PortalHeader
        title="Bills of lading that"
        mark="carry the title"
        lede="A carrier issues each bill as a token. Whoever holds it controls the goods: endorse it to pass the title on, surrender it to the carrier at delivery, or bind it to a facility so it moves only against payment."
        art="merkle"
      />
      <p className="-mt-2 text-sm text-slate">{MLETR_NOTE}</p>
      {!contracts ? (
        <Skeleton className="h-40" />
      ) : !contracts.eblRegistry ? (
        <Card className="text-center">
          <p className="font-display text-2xl font-semibold">Bills of lading are not enabled on this deployment</p>
          <p className="mx-auto mt-2 max-w-md text-slate">This network runs contracts without the bill of lading registry. Shipments and facilities still work as usual.</p>
          <LinkButton href="/shipments" variant="secondary" className="mt-6">Browse the fleet</LinkButton>
        </Card>
      ) : (
        <>
          <Lookup />
          {hydrated && (
            <NetworkGuard purpose="Issuing, endorsing and surrendering bills are transactions from your wallet.">
              <Signed />
            </NetworkGuard>
          )}
        </>
      )}
    </div>
  );
}

function Lookup() {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const id = parseTokenId(raw);
          if (!id) return setErr("Enter the bill's number, for example 12.");
          router.push(`/ebl/${id}`);
        }}
      >
        <Field label="Look up a bill" value={raw} onChange={(e) => { setRaw(e.target.value); setErr(null); }} placeholder="Bill number" inputMode="numeric" error={err} className="flex-1" hint="Anyone can check a bill's status, parties and possession history." />
        <Button type="submit" variant="secondary" className="sm:mb-[1.85rem]">Open bill</Button>
      </form>
    </Card>
  );
}

function Signed() {
  const { address } = useAccount();
  const carrier = useIsCarrier(address);
  const bills = useMyBills(address);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        {carrier.loading ? <Skeleton className="h-72" /> : carrier.isCarrier || carrier.unknown ? <IssueCard unknownRole={!carrier.isCarrier} /> : <NotCarrier />}
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader title="Bills you hold">{bills.held.length > 0 && <span className="text-sm text-slate">{bills.held.length}</span>}</CardHeader>
          {bills.loading ? <Skeleton className="h-24" /> : <BillList bills={bills.held} empty="This wallet holds no bills. A carrier issues a bill to the shipper; holders endorse it onward." />}
        </Card>
        {bills.issued.length > 0 && (
          <Card>
            <CardHeader title="Bills you issued" />
            <BillList bills={bills.issued} empty="" />
          </Card>
        )}
      </div>
    </div>
  );
}

function NotCarrier() {
  return (
    <Card tone="paper">
      <CardHeader title="Issue a bill" />
      <p className="text-sm text-slate">Only a carrier can issue bills: this wallet does not hold the carrier role. Ask the deployment&apos;s administrator to grant it, or use this page to manage the bills you hold.</p>
    </Card>
  );
}

function IssueCard({ unknownRole }: { unknownRole: boolean }) {
  const { address } = useAccount();
  const { contracts, chainId } = useContracts();
  const client = usePublicClient({ chainId: chainId as 46630 | 31337 });
  const { send, pending } = useTx();
  const [form, setForm] = useState<IssueForm>({ shipper: "", consignee: "", toOrder: false, documentHash: "" });
  const [touched, setTouched] = useState(false);
  const [issued, setIssued] = useState<bigint | null>(null);
  const v = validateIssue(form);
  const err = (k: keyof IssueForm) => (touched ? v.errors[k] : undefined);

  async function submit() {
    setTouched(true);
    if (!v.args || !contracts?.eblRegistry) return;
    const h = await send({ address: contracts.eblRegistry, abi: eblRegistryAbi, functionName: "issue", args: v.args, label: "Issue bill of lading", successTitle: "Bill of lading issued" });
    if (!h) return;
    try {
      const receipt = await client!.getTransactionReceipt({ hash: h });
      const ev = parseEventLogs({ abi: eblRegistryAbi, logs: receipt.logs, eventName: "BillIssued" })[0];
      setIssued((ev?.args as { tokenId?: bigint } | undefined)?.tokenId ?? null);
    } catch {
      setIssued(null);
    }
    setForm({ shipper: "", consignee: "", toOrder: false, documentHash: "" });
    setTouched(false);
  }

  return (
    <Card>
      <CardHeader title="Issue a bill of lading">{!unknownRole && <Pill tone="verified" dot>Carrier</Pill>}</CardHeader>
      {unknownRole && <p className="mb-4 rounded-2xl bg-alert/12 px-4 py-3 text-sm">The carrier role could not be checked. The contract refuses the issue if this wallet is not a carrier.</p>}
      {issued !== null && (
        <p className="mb-4 rounded-2xl bg-verified/12 px-4 py-3 text-sm">
          <span className="font-semibold">Bill #{String(issued)} issued</span> to the shipper. <Link href={`/ebl/${issued}`} className="font-semibold underline">Open its public page</Link>
        </p>
      )}
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <DocumentDrop
          label="Bill of lading document"
          hint="One bill per document: the same file can never be issued twice."
          error={err("documentHash")}
          onHash={(h) => setForm((f) => ({ ...f, documentHash: h ?? "" }))}
        />
        {form.documentHash && (
          <p className="-mt-2 flex flex-wrap items-center gap-2 text-sm text-slate">Fingerprint <HashBadge value={form.documentHash} compact /></p>
        )}
        <Field label="Shipper address" value={form.shipper} onChange={(e) => setForm({ ...form, shipper: e.target.value })} placeholder={address ?? "0x…"} hint="The bill is minted to the shipper, who holds the title first." error={err("shipper")} spellCheck={false} autoComplete="off" />
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">Consignee</legend>
          <div className="flex flex-wrap gap-2">
            {[
              { v: false, label: "Named consignee" },
              { v: true, label: "To order" },
            ].map((o) => (
              <label key={o.label} className={`flex cursor-pointer items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-semibold ${form.toOrder === o.v ? "border-ink bg-ink text-paper" : "border-line hover:border-ink/40"}`}>
                <input type="radio" name="consignee-kind" className="sr-only" checked={form.toOrder === o.v} onChange={() => setForm({ ...form, toOrder: o.v })} />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
        {form.toOrder ? (
          <p className="-mt-1 text-sm text-slate">A &quot;to order&quot; bill names no consignee: whoever holds it by endorsement is entitled to the goods.</p>
        ) : (
          <Field label="Consignee address" value={form.consignee} onChange={(e) => setForm({ ...form, consignee: e.target.value })} placeholder="0x…" hint="Usually the buyer. To bind the bill to a facility, the consignee must be its buyer (or choose to order)." error={err("consignee")} spellCheck={false} autoComplete="off" />
        )}
        <Button type="submit" loading={pending} className="self-start">Issue bill of lading</Button>
      </form>
    </Card>
  );
}

function BillList({ bills, empty }: { bills: Bill[]; empty: string }) {
  if (bills.length === 0) return <p className="text-sm text-slate">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {bills.map((b) => (
        <li key={String(b.tokenId)} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/ebl/${b.tokenId}`} className="font-display text-lg font-semibold hover:underline">Bill #{String(b.tokenId)}</Link>
            <Pill tone={eblStatusTone(b.status)} dot>{EBL_STATUS_LABEL[b.status]}</Pill>
            <span className="text-sm text-slate">{isToOrder(b.consignee) ? "To order" : "Named consignee"} · {b.transfers} {b.transfers === 1 ? "endorsement" : "endorsements"}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <HashBadge value={b.documentHash} label="document" compact />
            <BillActions bill={b} />
          </div>
        </li>
      ))}
    </ul>
  );
}
