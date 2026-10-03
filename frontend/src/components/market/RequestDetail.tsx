"use client";

import Link from "next/link";
import { useState } from "react";
import type { Address, Hex } from "viem";
import { useAccount } from "wagmi";
import { Button, LinkButton } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Banner";
import { Card, CardHeader } from "@/components/ui/Card";
import { CopyField } from "@/components/ui/CopyField";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { KeyValue } from "@/components/ui/KeyValue";
import { Modal } from "@/components/ui/Modal";
import { Badge, StatusPill } from "@/components/ui/Pill";
import { PageHeader } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { NetworkGuard } from "@/components/wallet/NetworkGuard";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useShipment } from "@/lib/api/hooks";
import type { ShipmentView } from "@/lib/api/schemas";
import {
  acceptedOffer, acceptMessage, advanceRate, age, closeMessage, pct, postAccept, postClose, rankOffers, roleOn, useMarket, type MarketRequest, type Offer, type Role,
} from "@/lib/api/market";
import { controllerAbi } from "@/lib/chain/abis";
import { useContracts } from "@/lib/chain/contracts";
import { useTx } from "@/lib/chain/useTx";
import { usePaused } from "@/lib/chain/v3";
import { PausedBanner } from "@/components/shipment/PausedBanner";
import { buildMilestones } from "@/lib/exporter";
import { formatTempX100, formatUSDG } from "@/lib/format";
import { useHydrated } from "@/lib/useHydrated";
import { OfferModal } from "./OfferModal";
import { PartyLink } from "./PartyLink";
import { BandChip, RequestStatusPill, RouteLabel } from "./RequestBits";
import { useSigned } from "./useSigned";

export function RequestDetail({ id }: { id: string }) {
  const m = useMarket();
  const r = m.all.find((x) => x.id.toLowerCase() === id.toLowerCase());
  const { data: view } = useShipment(r?.shipmentId);
  const { address } = useAccount();
  const hydrated = useHydrated();
  const role = r ? roleOn(r, hydrated ? address : undefined) : "viewer";

  if (m.isPending && !r) return <DetailSkeleton />;
  if (!r) {
    return (
      <div className="container-page py-(--space-page-y)">
        <PageHeader back={<BackLink />} title={m.unavailable ? "The market is not live on this backend yet" : "We couldn't find that request"} />
        <EmptyState
          title={m.unavailable ? "No financing requests here" : "This request is not on the market"}
          description={m.unavailable ? "This deployment's API does not serve financing requests yet." : "It may have been closed and removed, or the link is incomplete."}
          action={<LinkButton href="/market" variant="secondary">Back to the market</LinkButton>}
        />
      </div>
    );
  }

  const rate = advanceRate(r.amount, r.invoiceValue);
  const threshold = r.policy.minEvidenceScore ?? view?.shipment.policy.minEvidenceScore;
  return (
    <div className="container-page py-(--space-page-y)">
      <PageHeader
        back={<BackLink />}
        title={<span className="font-sans font-semibold tracking-tight break-all">{r.externalRef}</span>}
        description={<RouteLabel route={r.route} className="font-medium text-ink/80" />}
        meta={
          <>
            <RequestStatusPill status={r.status} />
            <BandChip policy={r.policy} />
            <span className="inline-flex items-center gap-2 text-small text-text-muted">Exporter <PartyLink address={r.exporter} /></span>
            <span className="text-small text-text-muted">Posted <time dateTime={r.createdAt}>{age(r.createdAt)}</time></span>
          </>
        }
      />

      <div className="flex flex-col gap-6">
        <Card>
          <KeyValue
            layout="grid"
            columns={4}
            className="lg:grid-cols-5"
            items={[
              { label: "Seeking", value: <span className="num text-lg font-semibold">{formatUSDG(r.amount)} <span className="text-sm text-text-muted">USDG</span></span> },
              { label: "Invoice", value: <span className="num text-lg font-semibold">{formatUSDG(r.invoiceValue)} <span className="text-sm text-text-muted">USDG</span></span>, hint: "Paid by the buyer" },
              { label: "Advance", value: <span className="num text-lg font-semibold">{rate}%</span>, hint: "of the invoice" },
              { label: "Max fee", value: <span className="num text-lg font-semibold">{pct(r.maxFeeBps)}</span>, hint: `${formatUSDG((BigInt(r.amount) * BigInt(r.maxFeeBps)) / 10_000n)} USDG at full draw` },
              { label: "Tranches", value: <span className="num text-lg font-semibold">{r.milestoneCount}</span>, hint: `Released at score ${threshold ?? "–"}+` },
            ]}
          />
          {r.note && <p className="mt-5 rounded-tile bg-surface-sunken px-4 py-3 text-sm text-ink/80">“{r.note}”</p>}
        </Card>

        <div className="grid items-start gap-6 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-6 lg:col-span-8">
            <NextStep request={r} role={role} view={view} />
            <Offers request={r} role={role} />
          </div>
          <aside className="flex min-w-0 flex-col gap-6 lg:col-span-4">
            <ShipmentSummary request={r} view={view} />
          </aside>
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/market" className="inline-flex w-fit items-center gap-1.5 font-semibold text-text-muted hover:text-ink">
      <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      Market
    </Link>
  );
}

function DetailSkeleton() {
  return (
    <div className="container-page flex flex-col gap-6 py-(--space-page-y)" role="status" aria-label="Loading the request">
      <Skeleton className="h-5 w-20" />
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-28 rounded-card" />
      <div className="grid gap-6 lg:grid-cols-12"><Skeleton className="h-64 rounded-card lg:col-span-8" /><Skeleton className="h-64 rounded-card lg:col-span-4" /></div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ next step

function StepCard({ eyebrow, title, children, tone = "white" }: { eyebrow: string; title: string; children: React.ReactNode; tone?: "white" | "ink" }) {
  // "ink" marks the step that waits on this wallet: the eyebrow turns lime-green, the card stays calm
  return (
    <Card as="section" aria-labelledby="next-step" elevation={tone === "ink" ? 2 : 1}>
      <p className={tone === "ink" ? "eyebrow text-signal-fg" : "eyebrow"}>{eyebrow}</p>
      <h2 id="next-step" className="mt-1 font-display text-h2">{title}</h2>
      <div className="mt-2 max-w-reading text-body text-ink/80">{children}</div>
    </Card>
  );
}

function NextStep({ request: r, role, view }: { request: MarketRequest; role: Role; view: ShipmentView | undefined }) {
  const [offering, setOffering] = useState(false);
  const { address } = useAccount();
  const acc = acceptedOffer(r);
  const facility = view?.facility ?? null;
  const mine = address ? r.offers.filter((o) => o.financier.toLowerCase() === address.toLowerCase()) : [];

  if (r.status === "closed") {
    return <StepCard eyebrow="Closed" title="This request is closed">The exporter withdrew it or financed the shipment elsewhere. Nothing more happens here.</StepCard>;
  }
  if (role === "viewer") {
    return (
      <StepCard eyebrow="Next step" title={r.status === "open" ? "Connect a wallet to make an offer" : "Connect a wallet to see your part"} tone="ink">
        <p>Financiers offer a fee with a signed message; nothing moves until the exporter accepts and opens the facility on chain.</p>
        <div className="mt-5"><WalletButton /></div>
      </StepCard>
    );
  }
  if (role === "buyer") {
    return <StepCard eyebrow="You are the buyer" title="Nothing to do yet">You confirm delivery and pay the invoice once every tranche has been released on evidence. The shipment dashboard will show when.</StepCard>;
  }

  if (role === "exporter") {
    if (r.status === "open") {
      return (
        <StepCard eyebrow="Your request" title={r.offers.length ? "Pick the offer you want" : "Waiting for offers"} tone="ink">
          <p>{r.offers.length ? "Offers are ranked by fee below. Accepting is a signed message; then you open the facility on chain naming that financier." : "Financiers see this request in the market now. You'll be able to accept an offer here as soon as one arrives."}</p>
          <div className="mt-5"><CloseRequest request={r} /></div>
        </StepCard>
      );
    }
    if (r.status === "accepted" && acc) {
      if (facility) {
        return (
          <StepCard eyebrow="Facility open" title="Waiting for the financier's deposit">
            <p>The facility names <PartyLink address={facility.financier} /> at {pct(facility.feeBps)}. Once they deposit {formatUSDG(facility.committed)} USDG into escrow, start transit from the dashboard.</p>
            <div className="mt-5 flex flex-wrap gap-2"><LinkButton href={`/track/${r.shipmentId}`} variant="secondary">Open the shipment dashboard</LinkButton></div>
          </StepCard>
        );
      }
      return <CreateFacility request={r} offer={acc} view={view} />;
    }
    return (
      <StepCard eyebrow="Funded" title="Capital is in escrow">
        <p>Start transit from the dashboard. Each tranche releases to your wallet when the cargo&apos;s evidence clears the policy.</p>
        <div className="mt-5"><LinkButton href={`/track/${r.shipmentId}`}>Open the shipment dashboard</LinkButton></div>
      </StepCard>
    );
  }

  // any other wallet: a financier
  if (r.status === "open") {
    return (
      <StepCard eyebrow="Financier" title={mine.length ? `You offered ${pct(Math.min(...mine.map((o) => o.feeBps)))}` : "Price this shipment"} tone="ink">
        <p>
          {mine.length
            ? "The exporter sees every offer ranked by fee. You can change your fee until they accept one; the new fee replaces the old."
            : `Offer a fee up to ${pct(r.maxFeeBps)}. You earn it on what the exporter draws, paid from the invoice at settlement.`}
        </p>
        <div className="mt-5"><Button onClick={() => setOffering(true)}>{mine.length ? "Change your offer" : "Make an offer"}</Button></div>
        {offering && <OfferModal request={r} open={offering} onClose={() => setOffering(false)} />}
      </StepCard>
    );
  }
  const won = acc && address && acc.financier.toLowerCase() === address.toLowerCase();
  if (!won) {
    return <StepCard eyebrow="Financier" title="Another offer was accepted">{acc ? `The exporter accepted ${pct(acc.feeBps)} from another financier.` : "This request is no longer taking offers."} Find another shipment in the market.</StepCard>;
  }
  if (r.status === "accepted") {
    return facility && facility.financier.toLowerCase() === address!.toLowerCase() ? (
      <StepCard eyebrow="Your offer was accepted" title="Deposit the capital" tone="ink">
        <p>The exporter opened the facility naming your wallet at {pct(facility.feeBps)}. Approve and deposit {formatUSDG(facility.committed)} USDG from the financier portal; it stays in escrow until evidence releases it.</p>
        <div className="mt-5"><LinkButton href="/financier">Deposit in the financier portal</LinkButton></div>
      </StepCard>
    ) : (
      <StepCard eyebrow="Your offer was accepted" title="Waiting for the exporter to open the facility">
        The exporter now sends one transaction naming your wallet and {pct(acc.feeBps)}. You&apos;ll deposit from the financier portal as soon as it lands; this page updates by itself.
      </StepCard>
    );
  }
  return (
    <StepCard eyebrow="Funded" title="Your capital is in escrow">
      Releases follow the evidence automatically. Track it from the financier portal or the shipment dashboard.
      <div className="mt-5 flex flex-wrap gap-2"><LinkButton href="/financier" variant="secondary">Open the financier portal</LinkButton></div>
    </StepCard>
  );
}

function CloseRequest({ request: r }: { request: MarketRequest }) {
  const [confirm, setConfirm] = useState(false);
  const { run, busy, error } = useSigned();
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>Close this request</Button>
      <div>
        <Modal open={confirm} onClose={() => setConfirm(false)} title="Close this request?" description="Financiers will no longer see it or be able to offer. The shipment itself is unaffected.">
          {error && <Callout variant="danger" live="assertive" className="mb-3">{error}</Callout>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}>Keep it open</Button>
            <Button
              variant="danger"
              loading={busy !== null}
              onClick={async () => {
                const ok = await run((t) => closeMessage(r.id, t), (t, signature) => postClose(r.id, { issuedAt: t, signature }), "The request could not be closed.");
                if (ok !== undefined) setConfirm(false);
              }}
            >
              {busy === "sign" ? "Waiting for your signature…" : "Sign and close"}
            </Button>
          </div>
        </Modal>
      </div>
    </>
  );
}

function CreateFacility({ request: r, offer, view }: { request: MarketRequest; offer: Offer; view: ShipmentView | undefined }) {
  const { contracts } = useContracts();
  const { send, pending, hash } = useTx();
  const paused = usePaused();
  const threshold = view?.shipment.policy.minEvidenceScore ?? r.policy.minEvidenceScore;
  let plan: ReturnType<typeof buildMilestones> | null = null;
  let planError: string | null = null;
  try {
    plan = threshold === undefined ? null : buildMilestones(BigInt(r.amount), r.milestoneCount, threshold, r.externalRef);
  } catch (e) {
    planError = e instanceof Error ? e.message : "The milestone plan is invalid.";
  }
  const fee = (BigInt(r.amount) * BigInt(offer.feeBps)) / 10_000n;
  return (
    <StepCard eyebrow={`Accepted ${pct(offer.feeBps)}`} title="Open the facility on chain" tone="ink">
      <p>One transaction creates the escrowed facility naming this financier. They then deposit the capital, and you start transit from the dashboard.</p>
      <KeyValue
        layout="grid"
        columns={4}
        className="mt-5 rounded-tile bg-surface-sunken p-4"
        items={[
          { label: "Financier", value: <PartyLink address={offer.financier} /> },
          { label: "Facility", value: `${formatUSDG(r.amount)} USDG`, numeric: true },
          { label: "Fee", value: `${pct(offer.feeBps)}, ${formatUSDG(fee)} USDG`, numeric: true },
          { label: "Tranches", value: `${r.milestoneCount} of about ${formatUSDG(BigInt(r.amount) / BigInt(Math.max(1, r.milestoneCount)), { compact: true })} USDG`, numeric: true },
        ]}
      />
      <div className="mt-5">
        <NetworkGuard compact purpose="Opening the facility is a transaction from your exporter wallet.">
          {paused.controller && <PausedBanner className="mb-3" />}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              loading={pending}
              disabled={!contracts || !plan || paused.controller}
              onClick={() =>
                contracts && plan &&
                send({
                  address: contracts.controller, abi: controllerAbi, functionName: "createFacility",
                  args: [r.shipmentId as Hex, offer.financier as Address, offer.feeBps, plan],
                  label: "Open facility", successTitle: "Financing facility opened",
                })
              }
            >
              Create facility
            </Button>
            {hash && <CopyField value={hash} kind="tx" size="sm" label="Transaction" />}
          </div>
        </NetworkGuard>
      </div>
      {planError && <Callout variant="danger" live="assertive" className="mt-3">{planError}</Callout>}
    </StepCard>
  );
}

// ------------------------------------------------------------------------------------------------ offers

type RankedOffer = Offer & { rank: number };

function Offers({ request: r, role }: { request: MarketRequest; role: Role }) {
  const ranked: RankedOffer[] = rankOffers(r.offers).map((o, i) => ({ ...o, rank: i + 1 }));
  const [accepting, setAccepting] = useState<Offer | null>(null);
  const canAccept = role === "exporter" && r.status === "open";
  const fee = (o: Offer) => (BigInt(r.amount) * BigInt(o.feeBps)) / 10_000n;
  const columns: Column<RankedOffer>[] = [
    { key: "rank", header: "Rank", width: "4rem", cell: (o) => <span className={o.rank === 1 ? "num grid h-7 w-7 place-items-center rounded-full bg-signal text-sm font-semibold text-ink" : "num grid h-7 w-7 place-items-center rounded-full bg-ink/6 text-sm font-semibold text-text-muted"}>{o.rank}</span> },
    { key: "financier", header: "Financier", primary: true, cell: (o) => <PartyLink address={o.financier} /> },
    { key: "fee", header: "Fee", numeric: true, cell: (o) => <span className="font-semibold text-ink">{pct(o.feeBps)}</span> },
    { key: "full", header: "At full draw", numeric: true, cell: (o) => <>{formatUSDG(fee(o))} <span className="text-text-muted">USDG</span></> },
    { key: "age", header: "Offered", cell: (o) => <time dateTime={o.createdAt} className="text-text-muted">{age(o.createdAt)}</time> },
    {
      key: "act",
      header: <span className="sr-only">Action</span>,
      align: "right",
      cardLabel: "Action",
      cell: (o) => (o.accepted ? <Badge variant="success" dot>Accepted</Badge> : canAccept ? <Button size="xs" variant={o.rank === 1 ? "primary" : "secondary"} onClick={() => setAccepting(o)}>Accept</Button> : null),
    },
  ];
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <CardHeader title={`Offers (${ranked.length})`} description="Ranked by fee, cheapest first." />
      </div>
      {ranked.length === 0 ? (
        <EmptyState frame="plain" size="sm" title="No offers yet" description="Financiers see this request in the market and offer a fee with a signed message." className="pt-2" />
      ) : (
        <DataTable caption="Offers on this request" columns={columns} rows={ranked} rowKey={(o) => o.id} className="max-sm:px-4 max-sm:pb-4" />
      )}
      {accepting && <AcceptModal request={r} offer={accepting} onClose={() => setAccepting(null)} />}
    </Card>
  );
}

function AcceptModal({ request: r, offer, onClose }: { request: MarketRequest; offer: Offer; onClose: () => void }) {
  const { run, busy, error } = useSigned();
  const fee = (BigInt(r.amount) * BigInt(offer.feeBps)) / 10_000n;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Accept ${pct(offer.feeBps)}?`}
      description="Accepting closes the request to other offers. You then open the facility on chain naming this financier."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            loading={busy !== null}
            onClick={async () => {
              const ok = await run((t) => acceptMessage(r.id, offer.id, t), (t, signature) => postAccept(r.id, { offerId: offer.id, issuedAt: t, signature }), "The offer could not be accepted.");
              if (ok !== undefined) onClose();
            }}
          >
            {busy === "sign" ? "Waiting for your signature…" : busy === "send" ? "Accepting…" : "Sign and accept"}
          </Button>
        </>
      }
    >
      <KeyValue
        className="rounded-tile bg-surface-sunken px-4 py-1"
        items={[
          { label: "Financier", value: <PartyLink address={offer.financier} /> },
          { label: "Facility", value: `${formatUSDG(r.amount)} USDG in ${r.milestoneCount} tranches`, numeric: true },
          { label: "Fee at full draw", value: `${formatUSDG(fee)} USDG`, numeric: true },
        ]}
      />
      {error && <Callout variant="danger" live="assertive" className="mt-3">{error}</Callout>}
      <p className="mt-4 text-small text-text-muted">Your wallet signs a message naming this request and offer. Signing costs no gas.</p>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ shipment

function ShipmentSummary({ request: r, view }: { request: MarketRequest; view: ShipmentView | undefined }) {
  const p = view?.shipment.policy ?? r.policy;
  return (
    <Card>
      <CardHeader title="The shipment">
        {view?.facility ? <StatusPill status={view.facility.status} /> : <Badge variant="neutral">No facility yet</Badge>}
      </CardHeader>
      <div className="flex flex-col gap-2">
        <CopyField value={r.shipmentId} label="Shipment" kind="hash" className="w-full" />
        <span className="inline-flex items-center gap-2 text-small text-text-muted">Buyer <PartyLink address={r.buyer} /></span>
      </div>
      <KeyValue
        className="mt-3"
        items={[
          { label: "Temperature", value: p.minTempX100 !== undefined && p.maxTempX100 !== undefined ? `${formatTempX100(p.minTempX100)} to ${formatTempX100(p.maxTempX100)}` : "–", numeric: true },
          { label: "Evidence score", value: p.minEvidenceScore !== undefined ? `${p.minEvidenceScore} / 100` : "–", hint: "to release a tranche", numeric: true },
          { label: "Route deviation", value: p.maxRouteDeviationM !== undefined ? `${(p.maxRouteDeviationM / 1000).toLocaleString("en-US")} km` : "–", numeric: true },
          { label: "Sensors", value: p.minSensors !== undefined ? `at least ${p.minSensors}` : "–" },
        ]}
      />
      <p className="mt-4 text-small text-text-muted">The policy is hashed on chain and frozen. Every tranche is released by the contract only on evidence that meets it.</p>
      <LinkButton href={`/track/${r.shipmentId}`} variant="secondary" size="sm" className="mt-4 w-full">Open the shipment dashboard</LinkButton>
    </Card>
  );
}
