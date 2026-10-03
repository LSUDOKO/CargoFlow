"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseEventLogs } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { Callout } from "@/components/ui/Banner";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { CopyField } from "@/components/ui/CopyField";
import { cx } from "@/components/ui/cx";
import { CastEmptyState } from "@/components/cast/CastEmptyState";
import { Field } from "@/components/ui/Field";
import { Badge, Pill } from "@/components/ui/Pill";
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
    <div className="container-page py-(--space-page-y)">
      <PortalHeader
        eyebrow="For carriers"
        who="carrier"
        greeting="Hi, I'm the Carrier"
        title="Bills of lading that carry the title"
        lede="Each bill is a token, and whoever holds it controls the goods. Endorse it on, surrender it at delivery, or bind it to a facility."
      />
      <div className="flex flex-col gap-10">
        <Callout variant="info" title="Legal standing">{MLETR_NOTE}</Callout>
        {!contracts ? (
          <Skeleton className="h-40 rounded-card" />
        ) : !contracts.eblRegistry ? (
          <CastEmptyState
            who="carrier"
            expression="focused"
            title="Bills of lading are not enabled on this deployment"
            description="This network runs contracts without the bill of lading registry. Shipments and facilities still work as usual."
            action={<LinkButton href="/shipments" variant="secondary">Browse the fleet</LinkButton>}
          />
        ) : (
          <>
            <Lookup />
            {hydrated && (
              <NetworkGuard
                purpose="Issuing, endorsing and surrendering bills are transactions from your wallet."
                points={["Issue a bill from the document's fingerprint (carriers)", "Endorse a bill you hold to the next holder", "Surrender a bill to the carrier at delivery"]}
              >
                <Signed />
              </NetworkGuard>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Lookup() {
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Look up a bill" description="Anyone can check a bill's status, parties and possession history." />
      <form
        className="flex max-w-form flex-col gap-3 sm:flex-row sm:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          const id = parseTokenId(raw);
          if (!id) return setErr("Enter the bill's number, for example 12.");
          router.push(`/ebl/${id}`);
        }}
      >
        <Field label="Bill number" hideLabel value={raw} onChange={(e) => { setRaw(e.target.value); setErr(null); }} placeholder="Bill number, e.g. 12" inputMode="numeric" error={err} className="min-w-0 flex-1" />
        <Button type="submit" variant="secondary">Open bill</Button>
      </form>
    </Card>
  );
}

function Signed() {
  const { address } = useAccount();
  const carrier = useIsCarrier(address);
  const bills = useMyBills(address);
  return (
    <div className="grid items-start gap-6 lg:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-7">
        {carrier.loading ? <Skeleton className="h-72" /> : carrier.isCarrier || carrier.unknown ? <IssueCard unknownRole={!carrier.isCarrier} /> : <NotCarrier />}
      </div>
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-5">
        <Card>
          <CardHeader title="Bills you hold">{bills.held.length > 0 && <Badge shape="square">{bills.held.length}</Badge>}</CardHeader>
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
      <p className="text-sm text-text-muted">Only a carrier can issue bills: this wallet does not hold the carrier role. Ask the deployment&apos;s administrator to grant it, or use this page to manage the bills you hold.</p>
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
      {unknownRole && <Callout variant="warning" className="mb-4">The carrier role could not be checked. The contract refuses the issue if this wallet is not a carrier.</Callout>}
      {issued !== null && (
        <Callout variant="success" live="polite" className="mb-4 animate-confirm" title={`Bill #${String(issued)} issued to the shipper`}>
          <Link href={`/ebl/${issued}`} className="font-semibold underline">Open its public page</Link>
        </Callout>
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
          <div className="-mt-2 flex flex-wrap items-center gap-2 text-small text-text-muted">Fingerprint <CopyField value={form.documentHash} kind="hash" size="sm" /></div>
        )}
        <Field label="Shipper address" value={form.shipper} onChange={(e) => setForm({ ...form, shipper: e.target.value })} placeholder={address ?? "0x…"} hint="The bill is minted to the shipper, who holds the title first." error={err("shipper")} spellCheck={false} autoComplete="off" />
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">Consignee</legend>
          <div className="inline-flex gap-1 rounded-full bg-mist p-1">
            {[
              { v: false, label: "Named consignee" },
              { v: true, label: "To order" },
            ].map((o) => (
              <label key={o.label} className={cx("flex h-9 cursor-pointer items-center rounded-full px-4 text-sm font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink", form.toOrder === o.v ? "bg-ink text-paper shadow-1" : "text-ink/70 hover:bg-ink/6 hover:text-ink")}>
                <input type="radio" name="consignee-kind" className="sr-only" checked={form.toOrder === o.v} onChange={() => setForm({ ...form, toOrder: o.v })} />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
        {form.toOrder ? (
          <p className="-mt-1 text-small text-text-muted">A &quot;to order&quot; bill names no consignee: whoever holds it by endorsement is entitled to the goods.</p>
        ) : (
          <Field label="Consignee address" value={form.consignee} onChange={(e) => setForm({ ...form, consignee: e.target.value })} placeholder="0x…" hint="Usually the buyer. To bind the bill to a facility, the consignee must be its buyer (or choose to order)." error={err("consignee")} spellCheck={false} autoComplete="off" />
        )}
        <Button type="submit" loading={pending} className="self-start">Issue bill of lading</Button>
      </form>
    </Card>
  );
}

function BillList({ bills, empty }: { bills: Bill[]; empty: string }) {
  if (bills.length === 0) return <p className="text-sm text-text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {bills.map((b) => (
        <li key={String(b.tokenId)} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/ebl/${b.tokenId}`} className="num font-display text-h4 underline-offset-2 hover:underline">Bill #{String(b.tokenId)}</Link>
            <Pill tone={eblStatusTone(b.status)} dot>{EBL_STATUS_LABEL[b.status]}</Pill>
            <span className="text-small text-text-muted">{isToOrder(b.consignee) ? "To order" : "Named consignee"}, <span className="num">{b.transfers}</span> {b.transfers === 1 ? "endorsement" : "endorsements"}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CopyField value={b.documentHash} label="Document" kind="hash" size="sm" />
            <BillActions bill={b} />
          </div>
        </li>
      ))}
    </ul>
  );
}
