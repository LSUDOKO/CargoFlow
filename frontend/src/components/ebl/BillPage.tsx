"use client";

import Link from "next/link";
import { useState } from "react";
import { LinkButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { HashBadge } from "@/components/ui/HashBadge";
import { Pill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
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
  return (
    <div className="container-page flex flex-col gap-4 py-8 md:py-10">
      <div className="flex flex-col gap-5 rounded-[var(--radius-card)] bg-ink p-6 text-paper md:p-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-signal uppercase">Electronic bill of lading</p>
          <h1 className="mt-2 font-display text-[clamp(2rem,4.5vw,3.2rem)] leading-tight font-bold tracking-tight">Bill #{String(tokenId)}</h1>
          {bill ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Pill tone={eblStatusTone(bill.status)} dot onDark>{EBL_STATUS_LABEL[bill.status]}</Pill>
              {escrowed && <Pill tone="ink" onDark>Bound to a facility</Pill>}
              <span className="text-sm text-paper/70">{bill.transfers} {bill.transfers === 1 ? "endorsement" : "endorsements"}</span>
            </div>
          ) : (
            <Skeleton className="mt-3 h-6 w-40 bg-paper/15" />
          )}
        </div>
        {bill && <p className="max-w-md text-sm text-paper/80">{escrowed ? "Escrowed by the financing contract: it moves only by documents against payment (to the buyer on payment, the financier on default, the exporter on cancel)." : eblStatusText(bill.status)}</p>}
      </div>

      {hydrated && bill && <BillActions bill={bill} size="md" />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Parties" />
            {bill ? (
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <Party label="Current holder" hint={escrowed ? "The financing contract (escrow)" : undefined} value={bill.holder} chainId={chainId} strong />
                <Party label="Issued by (carrier)" value={bill.issuer} chainId={chainId} />
                <Party label="Shipper" value={bill.shipper} chainId={chainId} />
                {isToOrder(bill.consignee) ? (
                  <div><dt className="text-slate">Consignee</dt><dd className="mt-1 font-semibold">To order</dd></div>
                ) : (
                  <Party label="Consignee" value={bill.consignee} chainId={chainId} />
                )}
                <div><dt className="text-slate">Issued</dt><dd className="mt-1 font-medium">{when(bill.issuedAt)}</dd></div>
                <div><dt className="text-slate">{bill.status === "VOID" ? "Voided" : "Surrendered"}</dt><dd className="mt-1 font-medium">{bill.closedAt ? when(bill.closedAt) : "Not yet"}</dd></div>
              </dl>
            ) : (
              <Skeleton className="h-32" />
            )}
          </Card>
          <Card>
            <CardHeader title="Possession history"><span className="text-sm text-slate">Each move is an on-chain transfer</span></CardHeader>
            <History moves={b.history} loading={b.historyLoading} chainId={chainId} controller={contracts?.controller} issuer={bill?.issuer} />
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Financing" />
            {b.boundShipmentId ? (
              <div className="flex flex-col gap-3 text-sm">
                <p>This bill {escrowed ? "is" : "was"} bound to a CargoFlow facility under documents against payment.</p>
                <LinkButton href={`/track/${b.boundShipmentId}`} variant="secondary" size="sm" className="self-start">Open the shipment</LinkButton>
              </div>
            ) : (
              <p className="text-sm text-slate">{escrowed ? "Bound to a facility (its shipment is not indexed yet)." : "Not bound to any facility."}</p>
            )}
          </Card>
          <Card>
            <CardHeader title="Verify the document" />
            {bill ? <Verify documentHash={bill.documentHash} /> : <Skeleton className="h-24" />}
          </Card>
          <p className="px-1 text-xs text-slate">{MLETR_NOTE}</p>
        </div>
      </div>
    </div>
  );
}

function Party({ label, value, hint, chainId, strong }: { label: string; value: string; hint?: string; chainId?: number; strong?: boolean }) {
  return (
    <div>
      <dt className="text-slate">{label}</dt>
      <dd className={`mt-1 ${strong ? "font-semibold" : ""}`}>
        {hint && <span className="mb-1 block">{hint}</span>}
        {value && !ZERO.test(value) ? <HashBadge value={value} kind="address" chainId={chainId} compact /> : "–"}
      </dd>
    </div>
  );
}

function History({ moves, loading, chainId, controller, issuer }: { moves: { from: string; to: string; txHash: string; at: number }[]; loading: boolean; chainId?: number; controller?: string; issuer?: string }) {
  if (loading) return <Skeleton className="h-24" />;
  if (moves.length === 0) return <p className="text-sm text-slate">The history is not available from this node yet.</p>;
  const word = (m: { from: string; to: string }) => (ZERO.test(m.from) ? "Issued to" : same(m.to, controller) ? "Bound into escrow" : same(m.from, controller) ? "Released from escrow to" : same(m.to, issuer) ? "Returned to the carrier" : "Endorsed to");
  return (
    <ol className="relative flex flex-col gap-4 border-l-2 border-line pl-5">
      {moves.map((m, i) => (
        <li key={`${m.txHash}-${i}`} className="relative text-sm">
          <span aria-hidden="true" className={`absolute top-1 -left-[1.6rem] h-3 w-3 rounded-full border-2 border-white ${i === moves.length - 1 ? "bg-signal ring-2 ring-ink" : "bg-ink"}`} />
          <p className="font-semibold">{word(m)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-slate">
            {!ZERO.test(m.from) && <><HashBadge value={m.from} kind="address" chainId={chainId} compact /><span aria-hidden="true">→</span></>}
            <HashBadge value={m.to} kind="address" chainId={chainId} compact />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate">
            {m.at ? <span>{when(m.at)}</span> : null}
            {m.txHash && <HashBadge value={m.txHash} kind="tx" chainId={chainId} compact />}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Verify({ documentHash }: { documentHash: string }) {
  const [hash, setHash] = useState<string | null>(null);
  const ok = hash ? documentMatches(hash, documentHash) : null;
  return (
    <div className="flex flex-col gap-3">
      <DocumentDrop label="Check a copy of the document" hint="Drop the file you were given: it matches only if it is byte-for-byte the document this bill was issued for." onHash={(h) => setHash(h)} />
      {ok === true && (
        <p role="status" className="rounded-2xl bg-verified/12 px-4 py-3 text-sm"><span className="font-semibold text-[#00733e]">Matches.</span> This file is exactly the document this bill was issued for.</p>
      )}
      {ok === false && (
        <p role="status" className="rounded-2xl bg-danger/10 px-4 py-3 text-sm"><span className="font-semibold text-[#a1191e]">Does not match.</span> This file differs from the document the bill was issued for, even if it looks the same.</p>
      )}
      <p className="flex flex-wrap items-center gap-2 text-xs text-slate">On chain <HashBadge value={documentHash} compact /></p>
    </div>
  );
}

function NotFound({ text }: { text: string }) {
  return (
    <div className="container-page py-20 text-center">
      <h1 className="font-display text-4xl font-bold">We couldn&apos;t find that bill</h1>
      <p className="mx-auto mt-4 max-w-md text-slate">{text}</p>
      <div className="mt-8 flex justify-center gap-3">
        <LinkButton href="/ebl">Open the carrier portal</LinkButton>
        <Link href="/shipments" className="self-center font-semibold underline">Browse the fleet</Link>
      </div>
    </div>
  );
}
