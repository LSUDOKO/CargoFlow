"use client";

import Link from "next/link";
import { useState } from "react";
import { Callout } from "@/components/ui/Banner";
import { LinkButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { CopyField } from "@/components/ui/CopyField";
import { EmptyState } from "@/components/ui/EmptyState";
import { KeyValue } from "@/components/ui/KeyValue";
import { Badge, Pill } from "@/components/ui/Pill";
import { PageHeader } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { Timeline, type TimelineItem } from "@/components/ui/Timeline";
import { useContracts } from "@/lib/chain/contracts";
import { useBill } from "@/lib/chain/v3";
import { documentMatches, EBL_STATUS_LABEL, eblStatusText, eblStatusTone, isToOrder, MLETR_NOTE, parseTokenId } from "@/lib/ebl";
import { useHydrated } from "@/lib/useHydrated";
import { BillActions } from "./BillActions";
import { DocumentDrop } from "./DocumentDrop";

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const ZERO = /^0x0{40}$/i;
const when = (sec: number) => (sec ? new Date(sec * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "–");

/** The public page of one bill: status, parties, possession history, the bound shipment and a document check. */
export function BillPage({ raw }: { raw: string }) {
  const tokenId = parseTokenId(raw);
  const { contracts, chainId } = useContracts();
  const hydrated = useHydrated();
  const b = useBill(tokenId);
  const bill = b.bill;

  if (!tokenId) return <NotFound text={`“${raw}” is not a bill number.`} />;
  if (contracts && !contracts.eblRegistry) return <NotFound text="Bills of lading are not enabled on this deployment." />;
  if (!bill && !b.loading && (b.notFound || contracts)) return <NotFound text={`No bill #${tokenId} exists on this deployment.`} />;

  const escrowed = !!bill && same(bill.holder, contracts?.controller);
  const addr = (v: string | undefined, label: string) => (v && !ZERO.test(v) ? <CopyField value={v} kind="address" chainId={chainId} size="sm" label={label} /> : "–");
  return (
    <div className="container-page py-(--space-page-y)">
      <PageHeader
        back={<BackLink />}
        eyebrow="Electronic bill of lading"
        title={<span className="num">Bill #{String(tokenId)}</span>}
        description={bill ? (escrowed ? "Escrowed by the financing contract: it moves only by documents against payment (to the buyer on payment, the financier on default, the exporter on cancel)." : eblStatusText(bill.status)) : undefined}
        meta={
          bill ? (
            <>
              <Pill tone={eblStatusTone(bill.status)} dot>{EBL_STATUS_LABEL[bill.status]}</Pill>
              {escrowed && <Badge variant="ink">Bound to a facility</Badge>}
              <Badge shape="square"><span className="num">{bill.transfers}</span>&nbsp;{bill.transfers === 1 ? "endorsement" : "endorsements"}</Badge>
            </>
          ) : (
            <Skeleton className="h-6 w-48" />
          )
        }
        actions={hydrated && bill ? <BillActions bill={bill} size="md" /> : undefined}
      />

      <div className="flex flex-col gap-6">
        <div className="grid items-start gap-6 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-6 lg:col-span-8">
            <Card>
              <CardHeader title="Title record" description="Who holds the bill, who issued it and to whom." />
              {bill ? (
                <KeyValue
                  layout="grid"
                  columns={2}
                  items={[
                    { label: "Current holder", value: addr(bill.holder, "Holder"), hint: escrowed ? "The financing contract (escrow)" : undefined },
                    { label: "Issued by (carrier)", value: addr(bill.issuer, "Carrier") },
                    { label: "Shipper", value: addr(bill.shipper, "Shipper") },
                    { label: "Consignee", value: isToOrder(bill.consignee) ? "To order" : addr(bill.consignee, "Consignee") },
                    { label: "Issued", value: when(bill.issuedAt), numeric: true },
                    { label: bill.status === "VOID" ? "Voided" : "Surrendered", value: bill.closedAt ? when(bill.closedAt) : "Not yet", numeric: true },
                  ]}
                />
              ) : (
                <Skeleton className="h-32" />
              )}
            </Card>
            <Card>
              <CardHeader title="Possession history" description="Each move is an on-chain transfer, oldest first." />
              <History moves={b.history} loading={b.historyLoading} chainId={chainId} controller={contracts?.controller} issuer={bill?.issuer} live={bill?.status === "ISSUED"} />
            </Card>
          </div>
          <aside className="flex min-w-0 flex-col gap-6 lg:col-span-4">
            <Card>
              <CardHeader title="Financing" as="h2" />
              {b.boundShipmentId ? (
                <div className="flex flex-col gap-3 text-sm">
                  <p>This bill {escrowed ? "is" : "was"} bound to a CargoFlow facility under documents against payment.</p>
                  <LinkButton href={`/track/${b.boundShipmentId}`} variant="secondary" size="sm" className="self-start">Open the shipment</LinkButton>
                </div>
              ) : (
                <p className="text-sm text-text-muted">{escrowed ? "Bound to a facility (its shipment is not indexed yet)." : "Not bound to any facility."}</p>
              )}
            </Card>
            <Card>
              <CardHeader title="Verify the document" />
              {bill ? <Verify documentHash={bill.documentHash} /> : <Skeleton className="h-24" />}
            </Card>
          </aside>
        </div>
        <Callout variant="info" title="Legal standing">{MLETR_NOTE}</Callout>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/ebl" className="inline-flex w-fit items-center gap-1.5 font-semibold text-text-muted hover:text-ink">
      <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      Carrier portal
    </Link>
  );
}

function History({ moves, loading, chainId, controller, issuer, live }: { moves: { from: string; to: string; txHash: string; at: number }[]; loading: boolean; chainId?: number; controller?: string; issuer?: string; live?: boolean }) {
  if (loading) return <Skeleton className="h-24" />;
  if (moves.length === 0) return <p className="text-sm text-text-muted">The history is not available from this node yet.</p>;
  const word = (m: { from: string; to: string }) => (ZERO.test(m.from) ? "Issued to the shipper" : same(m.to, controller) ? "Bound into escrow" : same(m.from, controller) ? "Released from escrow" : same(m.to, issuer) ? "Returned to the carrier" : "Endorsed");
  const items: TimelineItem[] = moves.map((m, i) => ({
    id: `${m.txHash}-${i}`,
    title: word(m),
    state: i === moves.length - 1 && live ? "active" : "done",
    time: m.at ? <time dateTime={new Date(m.at * 1000).toISOString()}>{when(m.at)}</time> : undefined,
    meta: (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {!ZERO.test(m.from) && (
            <>
              <CopyField value={m.from} kind="address" chainId={chainId} size="sm" label="From" />
              <span aria-hidden="true" className="text-text-muted">→</span>
            </>
          )}
          <CopyField value={m.to} kind="address" chainId={chainId} size="sm" label="To" />
        </div>
        {m.txHash && <CopyField value={m.txHash} kind="tx" chainId={chainId} size="sm" label="Transaction" className="w-fit" />}
      </div>
    ),
  }));
  return <Timeline label="Possession history" items={items} />;
}

function Verify({ documentHash }: { documentHash: string }) {
  const [hash, setHash] = useState<string | null>(null);
  const ok = hash ? documentMatches(hash, documentHash) : null;
  return (
    <div className="flex flex-col gap-3">
      <DocumentDrop label="Check a copy of the document" hint="It matches only if it is byte-for-byte the document this bill was issued for." onHash={(h) => setHash(h)} />
      {ok === true && <Callout variant="success" live="polite" title="Matches">This file is exactly the document this bill was issued for.</Callout>}
      {ok === false && <Callout variant="danger" live="polite" title="Does not match">This file differs from the document the bill was issued for, even if it looks the same.</Callout>}
      <div className="flex flex-wrap items-center gap-2 text-small text-text-muted">On chain <CopyField value={documentHash} kind="hash" size="sm" /></div>
    </div>
  );
}

function NotFound({ text }: { text: string }) {
  return (
    <div className="container-page py-(--space-page-y)">
      <PageHeader back={<BackLink />} title="We couldn't find that bill" />
      <EmptyState
        title="No bill to show"
        description={text}
        action={
          <>
            <LinkButton href="/ebl" variant="secondary">Open the carrier portal</LinkButton>
            <LinkButton href="/shipments" variant="ghost">Browse the fleet</LinkButton>
          </>
        }
      />
    </div>
  );
}
