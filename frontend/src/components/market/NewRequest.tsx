"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { Button, LinkButton } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Banner";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Textarea } from "@/components/ui/Field";
import { KeyValue } from "@/components/ui/KeyValue";
import { PageHeader } from "@/components/ui/Section";
import { StatusPill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useShipment, useShipmentsFor, useShipmentViews } from "@/lib/api/hooks";
import type { Shipment } from "@/lib/api/schemas";
import { NOTE_MAX, parsePctToBps, parseUsdg, pct, postRequest, requestMessage, useMarket, validateRequest, type RequestForm } from "@/lib/api/market";
import { policiesAbi } from "@/lib/chain/abis";
import { useContracts } from "@/lib/chain/contracts";
import { formatUSDG } from "@/lib/format";
import { useHydrated } from "@/lib/useHydrated";
import { BandChip, RouteLabel } from "./RequestBits";
import { useSigned } from "./useSigned";

const isId = (s: string | undefined) => !!s && /^0x[0-9a-fA-F]{64}$/.test(s);

export function NewRequest({ shipmentId }: { shipmentId?: string }) {
  const { address } = useAccount();
  const hydrated = useHydrated();
  return (
    <div className="container-page py-(--space-page-y)">
      <PageHeader
        back={
          <Link href="/market" className="inline-flex w-fit items-center gap-1.5 font-semibold text-text-muted hover:text-ink">
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Market
          </Link>
        }
        title="Request financing"
        description="Put a registered shipment in front of every financier. You set the amount and the most you will pay; they compete on the fee."
      />
      {!hydrated || !address ? (
        <Card padded="lg" className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-display text-h3">Connect your exporter wallet</h2>
            <p className="mt-1 text-sm text-text-muted">Requests are signed by the wallet that registered the shipment. Signing costs no gas.</p>
          </div>
          <WalletButton />
        </Card>
      ) : isId(shipmentId) ? (
        <RequestFormFor id={shipmentId!.toLowerCase()} address={address} />
      ) : (
        <PickShipment address={address} />
      )}
    </div>
  );
}

/** The exporter's registered shipments that have no facility and are not already on the market. */
function PickShipment({ address }: { address: string }) {
  const { data, isPending } = useShipmentsFor(address);
  const m = useMarket();
  const own = (data?.shipments ?? []).filter((s) => s.exporter.toLowerCase() === address.toLowerCase());
  const views = useShipmentViews(own.map((s) => s.id));
  const listed = new Set(m.all.filter((r) => r.status === "open" || r.status === "accepted").map((r) => r.shipmentId.toLowerCase()));
  const eligible = own.filter((s, i) => views[i]?.data && views[i]!.data!.facility === null && !listed.has(s.id.toLowerCase()));
  const loading = isPending || views.some((v) => v.isPending);
  return (
    <Card>
      <CardHeader title="Choose a shipment" />
      {loading ? (
        <div className="flex flex-col gap-2">{[0, 1].map((i) => <Skeleton key={i} className="h-16 rounded-tile" />)}</div>
      ) : eligible.length === 0 ? (
        <EmptyState
          frame="plain"
          size="sm"
          title="No shipment is waiting for financing"
          description="A request needs a shipment you registered with its cold-chain policy set and no facility yet. Register one in the exporter portal."
          action={<LinkButton href="/exporter" variant="secondary">Open the exporter portal</LinkButton>}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {eligible.map((s) => (
            <li key={s.id}>
              <Link href={`/market/new?shipment=${s.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-tile border border-border bg-surface px-4 py-3 shadow-1 transition-[border-color,box-shadow] duration-(--duration-fast) hover:border-border-strong hover:shadow-2">
                <span className="font-display text-h4">{s.externalRef}</span>
                <RouteLabel route={s.route} className="text-sm text-ink/75" />
                <span className="num ml-auto text-sm font-semibold">{formatUSDG(s.invoiceValue)} <span className="text-text-muted">USDG invoice</span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RequestFormFor({ id, address }: { id: string; address: string }) {
  const { data: view, isPending, error } = useShipment(id);
  const { contracts, chainId } = useContracts();
  const m = useMarket();
  const policySet = useReadContract({
    address: contracts?.policies,
    abi: policiesAbi,
    functionName: "isSet",
    args: [id as `0x${string}`],
    chainId: chainId as 46630 | 31337 | undefined,
    query: { enabled: !!contracts },
  });

  if (isPending) return <Skeleton className="h-96 rounded-card" />;
  if (error || !view) {
    return <Blocked title="We couldn't find that shipment" body="It may not be registered yet, or the backend has not picked it up. Register it in the exporter portal first." />;
  }
  const s = view.shipment;
  const existing = m.all.find((r) => r.shipmentId.toLowerCase() === id && (r.status === "open" || r.status === "accepted"));
  if (s.exporter.toLowerCase() !== address.toLowerCase()) {
    return <Blocked title="This shipment belongs to another exporter" body={`Only the wallet that registered ${s.externalRef} can request financing for it.`} />;
  }
  if (view.facility) {
    return <Blocked title={`${s.externalRef} already has a facility`} body="Its financing is arranged. Follow it from the shipment dashboard." href={`/track/${id}`} cta="Open the dashboard" />;
  }
  if (existing) {
    return <Blocked title={`${s.externalRef} is already on the market`} body="It has a live request. Review its offers there." href={`/market/${existing.id}`} cta="See the request" />;
  }
  if (policySet.data === false) {
    return <Blocked title="Set the cold-chain policy first" body="Financiers price a shipment by its frozen policy. Finish registration in the exporter portal." href="/exporter" cta="Open the exporter portal" />;
  }
  return <RequestFormInner shipment={s} />;
}

function Blocked({ title, body, href, cta }: { title: string; body: string; href?: string; cta?: string }) {
  return (
    <EmptyState
      title={title}
      description={body}
      action={
        <>
          {href && cta && <LinkButton href={href} variant="secondary">{cta}</LinkButton>}
          <LinkButton href="/market/new" variant="ghost">Pick another shipment</LinkButton>
        </>
      }
    />
  );
}

function RequestFormInner({ shipment: s }: { shipment: Shipment }) {
  const router = useRouter();
  const invoice = BigInt(s.invoiceValue);
  const [f, setF] = useState<RequestForm>(() => ({ amount: formatUSDG((invoice * 40n) / 100n).replace(/,/g, ""), maxFeePct: "3", milestones: "5", note: "" }));
  const [touched, setTouched] = useState(false);
  const { run, busy, error } = useSigned();
  const noteId = useId();
  const errs = validateRequest(f, invoice);
  const err = (k: keyof RequestForm) => (touched || f[k].trim() !== "" ? errs[k] : undefined) ?? null;
  const amt = parseUsdg(f.amount);
  const bps = parsePctToBps(f.maxFeePct);
  const n = Number(f.milestones);
  const maxFee = amt !== undefined && bps !== undefined ? (amt * BigInt(bps)) / 10_000n : undefined;
  const residual = amt !== undefined && maxFee !== undefined ? invoice - amt - maxFee : undefined;
  const valid = Object.keys(errs).length === 0;

  async function submit() {
    setTouched(true);
    if (!valid || amt === undefined || bps === undefined) return;
    const body = { shipmentId: s.id.toLowerCase(), amount: amt.toString(), maxFeeBps: bps, milestoneCount: n, note: f.note.trim() };
    const out = await run(
      (t) => requestMessage(body.shipmentId, amt, bps, n, t),
      (t, signature) => postRequest({ ...body, issuedAt: t, signature }),
      "The request could not be posted.",
    );
    if (out !== undefined) router.push(out?.id ? `/market/${out.id}` : "/market");
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-12">
      <Card padded="lg" className="lg:col-span-8">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-tile bg-surface-sunken px-4 py-3">
            <div>
              <p className="font-display text-h4">{s.externalRef}</p>
              <RouteLabel route={s.route} className="text-sm text-ink/75" />
            </div>
            <div className="flex items-center gap-2">
              <BandChip policy={s.policy} className="bg-surface" />
              <StatusPill status={s.status} />
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Amount to raise" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="decimal" suffix="USDG" error={err("amount")} hint={`Invoice ${formatUSDG(invoice)} USDG. Amount plus the maximum fee must fit inside it.`} />
            <Field label="Maximum fee" value={f.maxFeePct} onChange={(e) => setF({ ...f, maxFeePct: e.target.value })} inputMode="decimal" suffix="%" error={err("maxFeePct")} hint="Financiers can only offer at or below this." />
            <Field
              label="Milestones"
              value={f.milestones}
              onChange={(e) => setF({ ...f, milestones: e.target.value })}
              inputMode="numeric"
              error={err("milestones")}
              hint={amt && Number.isInteger(n) && n >= 1 && n <= 8 ? `${n} tranche${n > 1 ? "s" : ""} of about ${formatUSDG(amt / BigInt(n))} USDG, each released on evidence` : "1 to 8 evidence-gated tranches"}
            />
          </div>
          <Textarea
            id={noteId}
            label="Note for financiers"
            optional
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            rows={3}
            placeholder="Repeat buyer, third season on this lane; insured reefer with two probes."
            error={errs.note ? `Keep the note under ${NOTE_MAX} characters (${f.note.length} now).` : null}
            help={`${f.note.length} / ${NOTE_MAX} characters`}
          />
          {error && <Callout variant="danger" live="assertive">{error}</Callout>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            <p className="max-w-md text-small text-text-muted">Your wallet signs a message naming the shipment, amount, maximum fee and milestones. Signing costs no gas.</p>
            <Button type="submit" loading={busy !== null} disabled={touched && !valid}>
              {busy === "sign" ? "Waiting for your signature…" : busy === "send" ? "Posting…" : "Sign and post request"}
            </Button>
          </div>
        </form>
      </Card>

      <aside className="lg:sticky lg:top-24 lg:col-span-4" aria-label="Settlement, worst case">
        <Card>
          <CardHeader title="At settlement, worst case" description="If fully drawn at your maximum fee, the buyer's invoice pays out:" as="h2" />
          <KeyValue
            items={[
              { label: "Financier: principal", value: amt !== undefined ? `${formatUSDG(amt)} USDG` : "–", numeric: true },
              { label: `Financier: fee${bps !== undefined ? ` at ${pct(bps)}` : ""}`, value: maxFee !== undefined ? `${formatUSDG(maxFee)} USDG` : "–", numeric: true },
              { label: "You: residual", value: residual !== undefined && residual >= 0n ? `${formatUSDG(residual)} USDG` : "–", numeric: true },
              { label: <span className="font-semibold text-ink">Invoice</span>, id: "invoice", value: <span className="text-base font-semibold">{formatUSDG(invoice)} USDG</span>, numeric: true },
            ]}
          />
          <p className="mt-4 text-small text-text-muted">You also receive every tranche of the principal during transit, as evidence clears. Offers usually land below the maximum.</p>
        </Card>
      </aside>
    </div>
  );
}
