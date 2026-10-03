"use client";

import Link from "next/link";
import { useState } from "react";
import type { Address, Hex } from "viem";
import { useAccount } from "wagmi";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { HashBadge } from "@/components/ui/HashBadge";
import { Modal } from "@/components/ui/Modal";
import { Pill, StatusPill } from "@/components/ui/Pill";
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
import { BandChip, RequestStatusPill, RouteLabel, Term } from "./RequestBits";
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
      <div className="container-page py-16">
        <BackLink />
        <Card className="mt-6 text-center">
          <h1 className="font-display text-2xl font-semibold">{m.unavailable ? "The market is not live on this backend yet" : "We couldn't find that request"}</h1>
          <p className="mx-auto mt-2 max-w-md text-slate">
            {m.unavailable ? "This deployment's API does not serve financing requests yet." : "It may have been closed and removed, or the link is incomplete."}
          </p>
          <div className="mt-6 flex justify-center"><LinkButton href="/market" variant="secondary">Back to the market</LinkButton></div>
        </Card>
      </div>
    );
  }

  const rate = advanceRate(r.amount, r.invoiceValue);
  return (
    <div className="container-page flex flex-col gap-6 py-10">
      <BackLink />
      <header className="rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-card)] md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-[clamp(2rem,4.5vw,3.2rem)] leading-none font-bold tracking-[-0.04em] break-all">{r.externalRef}</h1>
              <RequestStatusPill status={r.status} />
            </div>
            <RouteLabel route={r.route} className="mt-3 text-lg font-medium text-ink/80" />
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate">
              <BandChip policy={r.policy} />
              <span className="inline-flex items-center gap-2">Exporter <PartyLink address={r.exporter} /></span>
              <span>Posted <time dateTime={r.createdAt}>{age(r.createdAt)}</time></span>
            </div>
          </div>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-6 sm:grid-cols-3 lg:grid-cols-5">
          <Term label="Seeking" sub="USDG">{formatUSDG(r.amount)}</Term>
          <Term label="Invoice" sub="USDG, paid by the buyer">{formatUSDG(r.invoiceValue)}</Term>
          <Term label="Advance" sub="of the invoice">{rate}%</Term>
          <Term label="Max fee" sub={`${formatUSDG((BigInt(r.amount) * BigInt(r.maxFeeBps)) / 10_000n)} USDG at full draw`}>{pct(r.maxFeeBps)}</Term>
          <Term label="Tranches" sub={`released at score ${r.policy.minEvidenceScore ?? view?.shipment.policy.minEvidenceScore ?? "–"}+`}>{r.milestoneCount}</Term>
        </dl>
        {r.note && <p className="mt-6 rounded-2xl bg-mist px-4 py-3 text-ink/80">“{r.note}”</p>}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <NextStep request={r} role={role} view={view} />
          <Offers request={r} role={role} />
        </div>
        <aside className="flex flex-col gap-6">
          <ShipmentSummary request={r} view={view} />
        </aside>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/market" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-slate hover:text-ink">
      <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      Market
    </Link>
  );
}

function DetailSkeleton() {
  return (
    <div className="container-page flex flex-col gap-6 py-10" role="status" aria-label="Loading the request">
      <Skeleton className="h-5 w-20" />
      <div className="rounded-[var(--radius-card)] bg-white p-8 shadow-[var(--shadow-card)]">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="mt-4 h-5 w-64" />
        <div className="mt-8 grid grid-cols-2 gap-6 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]"><Skeleton className="h-64 rounded-[var(--radius-card)]" /><Skeleton className="h-64 rounded-[var(--radius-card)]" /></div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ next step

function StepCard({ eyebrow, title, children, tone = "white" }: { eyebrow: string; title: string; children: React.ReactNode; tone?: "white" | "ink" }) {
  return (
    <section aria-labelledby="next-step" className={cx("rounded-[var(--radius-card)] p-6 shadow-[var(--shadow-card)] md:p-7", tone === "ink" ? "surface-ink bg-ink text-paper" : "border border-line bg-white")}>
      <p className={cx("text-xs font-semibold tracking-wide uppercase", tone === "ink" ? "text-signal" : "text-slate")}>{eyebrow}</p>
      <h2 id="next-step" className="mt-1 font-display text-2xl font-semibold">{title}</h2>
      <div className={cx("mt-3", tone === "ink" ? "text-paper/80" : "text-ink/80")}>{children}</div>
    </section>
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
        <div className="mt-5 text-ink"><WalletButton /></div>
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
      <Button variant="inverse" size="sm" onClick={() => setConfirm(true)}>Close this request</Button>
      <div className="surface-light text-ink">
        <Modal open={confirm} onClose={() => setConfirm(false)} title="Close this request?" description="Financiers will no longer see it or be able to offer. The shipment itself is unaffected.">
          {error && <p role="alert" className="mb-3 text-sm font-medium text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
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
            <Button variant="ghost" onClick={() => setConfirm(false)}>Keep it open</Button>
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
      <dl className="mt-5 grid grid-cols-2 gap-4 rounded-2xl bg-paper/8 p-4 text-sm sm:grid-cols-4">
        <div><dt className="text-paper/65">Financier</dt><dd className="mt-1"><PartyLink address={offer.financier} onDark /></dd></div>
        <div><dt className="text-paper/65">Facility</dt><dd className="mt-1 font-mono font-semibold text-paper">{formatUSDG(r.amount)} USDG</dd></div>
        <div><dt className="text-paper/65">Fee</dt><dd className="mt-1 font-mono font-semibold text-paper">{pct(offer.feeBps)} · {formatUSDG(fee)} USDG</dd></div>
        <div><dt className="text-paper/65">Tranches</dt><dd className="mt-1 font-mono font-semibold text-paper">{r.milestoneCount} × ~{formatUSDG(BigInt(r.amount) / BigInt(Math.max(1, r.milestoneCount)), { compact: true })}</dd></div>
      </dl>
      <div className="mt-5 text-ink">
        <NetworkGuard purpose="Opening the facility is a transaction from your exporter wallet.">
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
            {hash && <HashBadge value={hash} kind="tx" onDark />}
          </div>
        </NetworkGuard>
      </div>
      {planError && <p role="alert" className="mt-3 text-sm font-medium text-[#FFB4B6]">{planError}</p>}
    </StepCard>
  );
}

// ------------------------------------------------------------------------------------------------ offers

function Offers({ request: r, role }: { request: MarketRequest; role: Role }) {
  const ranked = rankOffers(r.offers);
  const [accepting, setAccepting] = useState<Offer | null>(null);
  const canAccept = role === "exporter" && r.status === "open";
  return (
    <Card>
      <CardHeader title={`Offers (${ranked.length})`}>
        <span className="text-sm text-slate">Ranked by fee, cheapest first</span>
      </CardHeader>
      {ranked.length === 0 ? (
        <p className="rounded-2xl bg-mist px-4 py-6 text-center text-slate">No offers yet. Financiers see this request in the market.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {ranked.map((o, i) => {
            const fee = (BigInt(r.amount) * BigInt(o.feeBps)) / 10_000n;
            return (
              <li
                key={o.id}
                className={cx(
                  "grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-2xl border px-4 py-3 sm:grid-cols-[2rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_7rem]",
                  o.accepted ? "border-verified/50 bg-verified/8" : i === 0 ? "border-ink/25 bg-white" : "border-line bg-white",
                )}
              >
                <span className={cx("grid h-8 w-8 place-items-center rounded-full font-display text-sm font-bold", i === 0 ? "bg-signal text-ink" : "bg-ink/6 text-slate")}>{i + 1}</span>
                <PartyLink address={o.financier} />
                <div className="col-start-2 text-sm sm:col-start-auto">
                  <span className="font-display text-lg font-bold tabular">{pct(o.feeBps)}</span>
                  <span className="ml-2 text-slate">{formatUSDG(fee)} USDG</span>
                </div>
                <time dateTime={o.createdAt} className="col-start-2 text-sm text-slate sm:col-start-auto">{age(o.createdAt)}</time>
                <div className="col-start-3 row-span-2 row-start-1 justify-self-end sm:col-start-auto sm:row-span-1 sm:row-start-auto">
                  {o.accepted ? (
                    <Pill tone="verified" dot>Accepted</Pill>
                  ) : canAccept ? (
                    <Button size="sm" variant={i === 0 ? "primary" : "secondary"} onClick={() => setAccepting(o)}>Accept</Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {accepting && <AcceptModal request={r} offer={accepting} onClose={() => setAccepting(null)} />}
    </Card>
  );
}

function AcceptModal({ request: r, offer, onClose }: { request: MarketRequest; offer: Offer; onClose: () => void }) {
  const { run, busy, error } = useSigned();
  const fee = (BigInt(r.amount) * BigInt(offer.feeBps)) / 10_000n;
  return (
    <Modal open onClose={onClose} title={`Accept ${pct(offer.feeBps)}?`} description="Accepting closes the request to other offers. You then open the facility on chain naming this financier.">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-2xl bg-ink/4 p-4 text-sm">
        <dt className="text-slate">Financier</dt><dd><PartyLink address={offer.financier} /></dd>
        <dt className="text-slate">Facility</dt><dd className="font-mono font-semibold">{formatUSDG(r.amount)} USDG in {r.milestoneCount}</dd>
        <dt className="text-slate">Fee at full draw</dt><dd className="font-mono font-semibold">{formatUSDG(fee)} USDG</dd>
      </dl>
      {error && <p role="alert" className="mt-3 text-sm font-medium text-danger">{error}</p>}
      <p className="mt-4 text-sm text-slate">Your wallet signs a message naming this request and offer. Signing costs no gas.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          loading={busy !== null}
          onClick={async () => {
            const ok = await run((t) => acceptMessage(r.id, offer.id, t), (t, signature) => postAccept(r.id, { offerId: offer.id, issuedAt: t, signature }), "The offer could not be accepted.");
            if (ok !== undefined) onClose();
          }}
        >
          {busy === "sign" ? "Waiting for your signature…" : busy === "send" ? "Accepting…" : "Sign and accept"}
        </Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ shipment

function ShipmentSummary({ request: r, view }: { request: MarketRequest; view: ShipmentView | undefined }) {
  const p = view?.shipment.policy ?? r.policy;
  const rows: [string, React.ReactNode][] = [
    ["Buyer", <PartyLink key="b" address={r.buyer} />],
    ["Shipment id", <HashBadge key="id" value={r.shipmentId} compact />],
    ["Temperature", p.minTempX100 !== undefined && p.maxTempX100 !== undefined ? `${formatTempX100(p.minTempX100)} to ${formatTempX100(p.maxTempX100)}` : "–"],
    ["Evidence score", p.minEvidenceScore !== undefined ? `${p.minEvidenceScore} / 100 to release` : "–"],
    ["Route deviation", p.maxRouteDeviationM !== undefined ? `${(p.maxRouteDeviationM / 1000).toLocaleString("en-US")} km allowed` : "–"],
    ["Probes", p.minSensors !== undefined ? `at least ${p.minSensors}` : "–"],
  ];
  return (
    <Card>
      <CardHeader title="The shipment">
        {view?.facility ? <StatusPill status={view.facility.status} /> : <Pill tone="slate">No facility yet</Pill>}
      </CardHeader>
      <dl className="flex flex-col divide-y divide-line text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-slate">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-slate">The policy is hashed on chain and frozen. Every tranche is released by the contract only on evidence that meets it.</p>
      <LinkButton href={`/track/${r.shipmentId}`} variant="secondary" size="sm" className="mt-4 w-full">Open the shipment dashboard</LinkButton>
    </Card>
  );
}
