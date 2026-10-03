"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { HashBadge } from "@/components/ui/HashBadge";
import { Pill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { WalletButton } from "@/components/wallet/WalletButton";
import { useCover } from "@/lib/api/hooks";
import type { Cover, CoverOffer, Parametric, ShipmentView } from "@/lib/api/schemas";
import { coverPoolAbi, usdgAbi } from "@/lib/chain/abis";
import { useContracts } from "@/lib/chain/contracts";
import { useTx } from "@/lib/chain/useTx";
import { useOfferTriggers, useParametricCover, usePaused } from "@/lib/chain/v3";
import { claimSplit, coverActions, coverOpen, coverSummary, MAX_TRIGGER_EPOCHS, premiumOf, TRIGGER_STATES, validateOffer, validateParametric, type OfferForm, type ParametricForm } from "@/lib/cover";
import { formatBps, formatUSDG, shortHash } from "@/lib/format";
import { fundingNeeds } from "@/lib/portal";
import { useHydrated } from "@/lib/useHydrated";
import { ParametricTrigger, SplitTable } from "./ParametricTrigger";
import { PausedBanner } from "./PausedBanner";

type ChainId = 46630 | 31337;

/** True when the deployment has a CoverPool (contracts v2); every cover view is hidden otherwise. */
export function useCoverEnabled() {
  return !!useContracts().contracts?.coverPool;
}

/** The connected wallet's USDG balance, its allowance to the cover pool and what the pool owes it. */
function useWallet() {
  const { address } = useAccount();
  const { contracts, chainId } = useContracts();
  const pool = contracts?.coverPool;
  const reads = useReadContracts({
    contracts:
      contracts && pool && address
        ? [
            { address: contracts.usdg, abi: usdgAbi, functionName: "balanceOf", args: [address], chainId: chainId as ChainId },
            { address: contracts.usdg, abi: usdgAbi, functionName: "allowance", args: [address, pool], chainId: chainId as ChainId },
            { address: pool, abi: coverPoolAbi, functionName: "claimable", args: [address], chainId: chainId as ChainId },
          ]
        : [],
    query: { enabled: !!pool && !!address, refetchInterval: 10_000 },
  });
  return {
    balance: reads.data?.[0]?.result as bigint | undefined,
    allowance: reads.data?.[1]?.result as bigint | undefined,
    claimable: reads.data?.[2]?.result as bigint | undefined,
  };
}

/** The overview's one-line cover status, with a link to the Money tab. */
export function CoverSummary({ view, onOpen }: { view: ShipmentView; onOpen?: () => void }) {
  const status = view.facility?.status;
  const text = coverSummary(view.cover, view.openCoverOffers, status, (a) => shortHash(a, 4, 4));
  const tone = view.cover?.status === "ACTIVE" ? "verified" : view.cover?.status === "CLAIMED" || view.cover?.status === "TRIGGERED" ? "alert" : view.openCoverOffers > 0 ? "ink" : "slate";
  const word = view.cover ? { ACTIVE: "Covered", RELEASED: "Returned", CLAIMED: "Paid out", TRIGGERED: "Triggered" }[view.cover.status] ?? view.cover.status : view.openCoverOffers > 0 ? "Offers waiting" : "Not covered";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={tone} dot>{word}</Pill>
        {view.cover?.parametric && <Pill tone="ink">Parametric</Pill>}
      </div>
      <p className="text-sm">{text}</p>
      {onOpen && (
        <button type="button" onClick={onOpen} className="self-start text-sm font-semibold underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
          {coverOpen(status) && !view.cover ? "Offer or accept cover" : "See the cover"}
        </button>
      )}
    </div>
  );
}

/**
 * Default cover for the Money tab: what it is, the accepted cover or the open offers, and what the connected wallet
 * can do (an insurer offers or withdraws, the financier accepts, anyone releases after settlement or claims after a
 * default, and a credited wallet collects).
 */
export function CoverPanel({ view }: { view: ShipmentView }) {
  const hydrated = useHydrated();
  const { address, isConnected } = useAccount();
  const { contracts } = useContracts();
  const pool = contracts?.coverPool;
  const id = view.shipment.id as `0x${string}`;
  const q = useCover(id, !!pool);
  const wallet = useWallet();
  const { send, pending } = useTx();
  const paused = usePaused();
  const chainCover = useParametricCover(id, !!pool);
  const rawOffers = q.data?.offers ?? [];
  const triggers = useOfferTriggers(id, rawOffers.map((o) => o.insurer));
  const f = view.facility;
  if (!pool || !contracts) return null;

  // the backend's view, completed by the chain where the backend predates contracts v3
  const offers = rawOffers.map((o) => ({ ...o, parametric: o.parametric ?? asParametric(triggers.get(o.insurer.toLowerCase())) }));
  const base = q.data?.cover ?? view.cover;
  const cover = base ? mergeCover(base, chainCover) : null;
  const status = f?.status;
  const acts = coverActions({ status, financier: f?.financier, cover, offers, address: hydrated ? address : undefined });
  const approve = (amount: bigint, what: string) =>
    send({ address: contracts.usdg, abi: usdgAbi, functionName: "approve", args: [pool as Address, amount], label: `Approve ${formatUSDG(amount)} USDG`, successTitle: `Cover pool approved for ${what}` });

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-text-muted">
        Default cover protects the financier. An insurer escrows USDG in the cover pool; the financier buys the cover by paying the premium straight to the insurer.
        If the buyer pays, the cover goes back to the insurer. If the facility defaults, the financier is paid up to the principal already advanced to the exporter, and the rest goes back to the insurer.
      </p>

      {!f ? (
        <p className="rounded-tile bg-mist px-4 py-3 text-sm text-text-muted">Cover can be offered once a financing facility exists.</p>
      ) : q.isPending && !view.cover ? (
        <Skeleton className="h-24" />
      ) : cover ? (
        <AcceptedCover view={view} cover={cover} />
      ) : (
        <Offers
          offers={offers}
          premiumFor={(o) => premiumOf(o.amount, o.premiumBps)}
          action={(o) => {
            const mine = !!address && o.insurer.toLowerCase() === address.toLowerCase();
            if (mine)
              return (
                <Button size="sm" variant="secondary" loading={pending} onClick={() => send({ address: pool, abi: coverPoolAbi, functionName: "withdrawOffer", args: [id], label: "Withdraw cover offer", successTitle: "Cover offer withdrawn" })}>
                  Withdraw my offer
                </Button>
              );
            if (!acts.accept) return null;
            if (paused.coverPool) return <span className="text-xs font-medium text-warning-fg">Acceptance is paused by the guardian</span>;
            const premium = premiumOf(o.amount, o.premiumBps);
            const needs = fundingNeeds(wallet.balance, wallet.allowance, premium);
            if (wallet.balance !== undefined && needs.shortfall > 0n) return <span className="text-xs font-medium text-warning-fg">You need {formatUSDG(needs.shortfall)} more USDG for the premium</span>;
            return (
              <div className="flex flex-wrap justify-end gap-2">
                {premium > 0n && needs.needsApproval && (
                  <Button size="sm" variant="secondary" loading={pending} disabled={wallet.balance === undefined} onClick={() => approve(premium, "the premium")}>
                    1. Approve {formatUSDG(premium)} USDG
                  </Button>
                )}
                <Button
                  size="sm"
                  loading={pending}
                  disabled={premium > 0n && !needs.ready}
                  onClick={() => send({ address: pool, abi: coverPoolAbi, functionName: "acceptCover", args: [id, o.insurer as Address], label: "Accept cover", successTitle: "Cover accepted" })}
                >
                  {premium > 0n && needs.needsApproval ? "2. " : ""}Accept this cover
                </Button>
              </div>
            );
          }}
        />
      )}

      {!cover && acts.accept && paused.coverPool && <PausedBanner scope="coverPool" />}

      {f && cover?.status === "ACTIVE" && cover.parametric && (TRIGGER_STATES as readonly string[]).includes(status ?? "") && <ParametricTrigger view={view} cover={cover} />}

      {f && cover?.status === "ACTIVE" && (acts.release || acts.claim) && (
        <div className="flex flex-wrap items-center gap-3 rounded-tile bg-mist px-4 py-3">
          <p className="min-w-0 flex-1 text-sm">
            {acts.release
              ? status === "CANCELLED"
                ? "The facility was cancelled before transit, so the cover goes back to the insurer. Anyone can trigger this."
                : "The invoice is paid, so the cover goes back to the insurer. Anyone can trigger this."
              : `The facility defaulted. Paying out sends the financier ${formatUSDG(claimSplit(cover.amount, f.drawn).payout)} USDG and returns ${formatUSDG(claimSplit(cover.amount, f.drawn).remainder)} USDG to the insurer. Anyone can trigger this.`}
          </p>
          {acts.release ? (
            <Button size="sm" loading={pending} onClick={() => send({ address: pool, abi: coverPoolAbi, functionName: "release", args: [id], label: "Return the cover", successTitle: "Cover returned to the insurer" })}>
              Return the cover to the insurer
            </Button>
          ) : (
            <Button size="sm" loading={pending} onClick={() => send({ address: pool, abi: coverPoolAbi, functionName: "claim", args: [id], label: "Pay out the cover", successTitle: "Cover paid out" })}>
              Pay out the cover
            </Button>
          )}
        </div>
      )}

      {hydrated && wallet.claimable !== undefined && wallet.claimable > 0n && (
        <div className="flex flex-wrap items-center gap-3 rounded-tile bg-verified/12 px-4 py-3">
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">The cover pool holds {formatUSDG(wallet.claimable)} USDG for this wallet.</span> Payouts are collected rather than pushed, so nobody can block another party&apos;s payment.
          </p>
          <Button size="sm" loading={pending} onClick={() => send({ address: pool, abi: coverPoolAbi, functionName: "withdraw", args: [], label: "Collect cover payout", successTitle: `${formatUSDG(wallet.claimable!)} USDG collected` })}>
            Collect {formatUSDG(wallet.claimable)} USDG
          </Button>
        </div>
      )}

      {f && coverOpen(status) && !cover && (
        <div className="border-t border-line pt-5">
          {!hydrated ? null : !isConnected ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-text-muted">Connect a wallet to offer cover on this shipment.</p>
              <WalletButton compact />
            </div>
          ) : acts.offer && paused.coverPool ? (
            <PausedBanner scope="coverPool" />
          ) : acts.offer ? (
            <OfferFormView
              committed={f.committed}
              wallet={wallet}
              pending={pending}
              approve={approve}
              offer={(amount, bps, trigger) =>
                trigger
                  ? send({ address: pool, abi: coverPoolAbi, functionName: "offerParametricCover", args: [id, amount, bps, trigger.epochs, trigger.salvage], label: "Offer parametric cover", successTitle: "Parametric cover offered" })
                  : send({ address: pool, abi: coverPoolAbi, functionName: "offerCover", args: [id, amount, bps], label: "Offer cover", successTitle: "Cover offered" })
              }
            />
          ) : acts.offerBlocked && !acts.myOffer ? (
            <p className="text-sm text-text-muted">{acts.offerBlocked}</p>
          ) : null}
        </div>
      )}
      {f && !coverOpen(status) && !cover && <p className="text-sm text-text-muted">Cover could only be offered and accepted before transit started; none was taken out.</p>}
    </div>
  );
}

function Offers({ offers, premiumFor, action }: { offers: CoverOffer[]; premiumFor: (o: CoverOffer) => bigint; action: (o: CoverOffer) => React.ReactNode }) {
  if (offers.length === 0) return <p className="rounded-tile bg-mist px-4 py-3 text-sm text-text-muted">No cover offers yet.</p>;
  return (
    <div>
      <h3 className="mb-2 eyebrow">Open offers</h3>
      <ul className="flex flex-col divide-y divide-line rounded-tile border border-line">
        {offers.map((o) => (
          <li key={o.insurer} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-lg font-semibold">{formatUSDG(o.amount)} <span className="font-sans text-sm font-normal text-text-muted">USDG of cover</span></p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-text-muted">
                <span>Premium {formatBps(o.premiumBps)} ({formatUSDG(premiumFor(o))} USDG)</span>
                <span aria-hidden="true">·</span>
                <HashBadge value={o.insurer} kind="address" label="insurer" compact />
              </p>
              {o.parametric && (
                <p className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-ink/5 px-3 py-2 text-sm">
                  <Pill tone="ink">Parametric</Pill>
                  <span>
                    Pays out automatically after <b>{o.parametric.consecutiveFailedEpochs} failed evidence {o.parametric.consecutiveFailedEpochs === 1 ? "batch" : "batches"} in a row</b>
                    {BigInt(o.parametric.salvageToExporter) > 0n ? <>, with up to <b className="font-mono">{formatUSDG(o.parametric.salvageToExporter)} USDG</b> salvage to the exporter</> : null}. Final once triggered.
                  </span>
                </p>
              )}
            </div>
            {action(o)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AcceptedCover({ view, cover }: { view: ShipmentView; cover: NonNullable<ShipmentView["cover"]> }) {
  const f = view.facility!;
  const split = claimSplit(cover.amount, f.drawn);
  const word = { ACTIVE: "Active", RELEASED: "Returned to the insurer", CLAIMED: "Paid out", TRIGGERED: "Triggered: paid out" }[cover.status] ?? cover.status;
  const p = cover.parametric;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-display text-4xl font-bold tabular">{formatUSDG(cover.amount)} <span className="font-sans text-base font-normal text-text-muted">USDG of cover</span></p>
        <Pill tone={cover.status === "ACTIVE" ? "verified" : cover.status === "CLAIMED" || cover.status === "TRIGGERED" ? "alert" : "slate"} dot>{word}</Pill>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-text-muted">Insurer</dt><dd><HashBadge value={cover.insurer} kind="address" compact /></dd></div>
        <div><dt className="text-text-muted">Premium paid</dt><dd className="font-mono font-semibold">{formatUSDG(cover.premium)} USDG</dd></div>
        {p && (
          <div className="col-span-2"><dt className="text-text-muted">Parametric trigger</dt><dd>{p.consecutiveFailedEpochs} failed evidence {p.consecutiveFailedEpochs === 1 ? "batch" : "batches"} in a row; salvage to the exporter up to <span className="font-mono font-semibold">{formatUSDG(p.salvageToExporter)} USDG</span>.</dd></div>
        )}
        {cover.status === "ACTIVE" && (
          <div className="col-span-2"><dt className="text-text-muted">If the facility defaulted now</dt><dd>The financier would receive <span className="font-mono font-semibold">{formatUSDG(split.payout)} USDG</span> (the principal drawn so far, up to the cover); <span className="font-mono">{formatUSDG(split.remainder)} USDG</span> would return to the insurer.</dd></div>
        )}
        {cover.status === "RELEASED" && <div className="col-span-2"><dt className="text-text-muted">Outcome</dt><dd>The invoice was paid, so the whole <span className="font-mono font-semibold">{formatUSDG(cover.insurerReturn)} USDG</span> went back to the insurer.</dd></div>}
        {cover.status === "TRIGGERED" && (
          <div className="col-span-2">
            <dt className="text-text-muted">Outcome</dt>
            <dd className="mb-2">The parametric trigger was proved on chain. The cover is final: a later settlement or default does not reopen it. Each party collects its share below.</dd>
            <SplitTable financier={cover.financierPayout} exporter={p?.exporterSalvage ?? "0"} insurer={cover.insurerReturn} caption="Credited by the trigger" />
          </div>
        )}
        {cover.status === "CLAIMED" && (
          <div className="col-span-2"><dt className="text-text-muted">Outcome</dt><dd>The facility defaulted: the financier received <span className="font-mono font-semibold">{formatUSDG(cover.financierPayout)} USDG</span> and <span className="font-mono">{formatUSDG(cover.insurerReturn)} USDG</span> went back to the insurer.</dd></div>
        )}
      </dl>
    </div>
  );
}

function OfferFormView({ committed, wallet, pending, approve, offer }: { committed: string; wallet: ReturnType<typeof useWallet>; pending: boolean; approve: (amount: bigint, what: string) => void; offer: (amount: bigint, premiumBps: number, trigger?: { epochs: number; salvage: bigint }) => void }) {
  const [form, setForm] = useState<OfferForm>({ amount: "", premiumPct: "2" });
  const [parametric, setParametric] = useState(false);
  const [pf, setPf] = useState<ParametricForm>({ epochs: "3", salvage: "0" });
  const [touched, setTouched] = useState(false);
  const v0 = validateOffer(form, committed);
  const pv = validateParametric(pf, v0.amount);
  // a parametric offer is valid only when its trigger is too
  const v = parametric && Object.keys(pv.errors).length ? { ...v0, amount: undefined } : v0;
  const perr = (k: keyof ParametricForm) => (parametric && (touched || pf[k] !== "") ? pv.errors[k] : undefined);
  const err = (k: keyof OfferForm) => (touched || form[k] ? v.errors[k] : undefined);
  const amount = v.amount ?? 0n;
  const needs = fundingNeeds(wallet.balance, wallet.allowance, amount);
  const valid = v.amount !== undefined && v.premiumBps !== undefined;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (valid && needs.ready) offer(v.amount!, v.premiumBps!, parametric ? { epochs: pv.epochs!, salvage: pv.salvage! } : undefined);
      }}
    >
      <div>
        <h3 className="font-semibold">Offer cover as an insurer</h3>
        <p className="text-sm text-text-muted">You escrow the cover now and can withdraw it until the financier accepts. Offers close when transit starts.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cover amount (USDG)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" placeholder={formatUSDG(committed).replace(/,/g, "")} suffix="USDG" hint={`Up to the facility's ${formatUSDG(committed)} USDG.`} error={err("amount")} />
        <Field label="Premium" value={form.premiumPct} onChange={(e) => setForm({ ...form, premiumPct: e.target.value })} inputMode="decimal" suffix="%" hint={valid ? `The financier pays you ${formatUSDG(premiumOf(amount, v.premiumBps!))} USDG on accepting.` : "Up to 20% of the cover."} error={err("premiumPct")} />
      </div>
      <div className="rounded-tile border border-line p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={parametric} onChange={(e) => setParametric(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--color-ink)]" />
          <span>
            <span className="block font-semibold">Add a parametric trigger</span>
            <span className="block text-sm text-text-muted">The cover also pays out, before any default, when enough committed evidence batches fail in a row. Anyone can prove it on chain.</span>
          </span>
        </label>
        {parametric && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Failed batches in a row" value={pf.epochs} onChange={(e) => setPf({ ...pf, epochs: e.target.value })} inputMode="numeric" hint={`From 1 to ${MAX_TRIGGER_EPOCHS}. Only batches after acceptance count.`} error={perr("epochs")} />
            <Field label="Salvage to the exporter (USDG)" value={pf.salvage} onChange={(e) => setPf({ ...pf, salvage: e.target.value })} inputMode="decimal" suffix="USDG" hint="Paid from what is left after the financier, up to the cover." error={perr("salvage")} />
          </div>
        )}
      </div>
      {valid && wallet.balance !== undefined && needs.shortfall > 0n ? (
        <p className="rounded-tile bg-alert/12 px-4 py-3 text-sm">This wallet holds {formatUSDG(wallet.balance)} USDG; the offer escrows {formatUSDG(amount)}.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {valid && needs.needsApproval && (
            <Button variant="secondary" loading={pending} disabled={wallet.balance === undefined} onClick={() => approve(amount, "the cover")}>
              1. Approve {formatUSDG(amount)} USDG
            </Button>
          )}
          <Button type="submit" loading={pending} disabled={valid && !needs.ready}>
            {valid && needs.needsApproval ? "2. " : ""}Offer {valid ? `${formatUSDG(amount)} USDG of ` : ""}{parametric ? "parametric " : ""}cover
          </Button>
        </div>
      )}
    </form>
  );
}

const asParametric = (t: { consecutiveFailedEpochs: number; salvageToExporter: string } | null | undefined): Parametric =>
  t ? { consecutiveFailedEpochs: t.consecutiveFailedEpochs, salvageToExporter: t.salvageToExporter, epochFloor: 0, exporterSalvage: "0" } : null;

/** The backend's cover with the chain's status, trigger and payouts where the backend does not know them yet. */
function mergeCover(base: Cover, chain: ReturnType<typeof useParametricCover>): Cover {
  const status = chain.status && chain.status !== "NONE" ? chain.status : base.status;
  const triggered = status === "TRIGGERED";
  return {
    ...base,
    status,
    parametric: base.parametric ?? chain.parametric,
    financierPayout: triggered && base.financierPayout === "0" && chain.payouts ? chain.payouts.financier : base.financierPayout,
    insurerReturn: triggered && base.insurerReturn === "0" && chain.payouts ? chain.payouts.insurer : base.insurerReturn,
  };
}
