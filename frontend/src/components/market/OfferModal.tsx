"use client";

import { useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { WalletButton } from "@/components/wallet/WalletButton";
import { offerMessage, parsePctToBps, pct, postOffer, rankOffers, roleOn, validateOffer, type MarketRequest } from "@/lib/api/market";
import { formatUSDG } from "@/lib/format";
import { useHydrated } from "@/lib/useHydrated";
import { useSigned } from "./useSigned";

/** A financier offers a fee on an open request. The fee is signed (no gas) and capped at the exporter's maximum. */
export function OfferModal({ request: r, open, onClose }: { request: MarketRequest; open: boolean; onClose: () => void }) {
  const { run, busy, error, setError, address } = useSigned();
  const hydrated = useHydrated();
  const best = rankOffers(r.offers)[0];
  const mine = address ? rankOffers(r.offers.filter((o) => o.financier.toLowerCase() === address.toLowerCase()))[0] : undefined;
  const [fee, setFee] = useState(() => (best ? (Math.max(0, best.feeBps - 10) / 100).toString() : (r.maxFeeBps / 100).toString()));
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const role = roleOn(r, hydrated ? address : undefined);
  const err = validateOffer(fee, r.maxFeeBps);
  const bps = parsePctToBps(fee);
  const earn = bps !== undefined ? (BigInt(r.amount) * BigInt(bps)) / 10_000n : null;

  const close = () => {
    setSent(null);
    setTouched(false);
    setError(null);
    onClose();
  };

  async function submit() {
    setTouched(true);
    if (err || bps === undefined) return;
    const ok = await run((t) => offerMessage(r.id, bps, t), (t, signature) => postOffer(r.id, { feeBps: bps, issuedAt: t, signature }), "The offer could not be sent.");
    if (ok !== undefined) setSent(bps);
  }

  // modals render in place: reset the text colour in case the trigger sits on a navy surface
  return (
    <div className="surface-light text-ink">
      <Modal open={open} onClose={close} title={sent !== null ? "Offer sent" : `Offer to fund ${r.externalRef}`} description={sent !== null ? undefined : `${formatUSDG(r.amount)} USDG in ${r.milestoneCount} evidence-gated tranche${r.milestoneCount > 1 ? "s" : ""}.`}>
        {sent !== null ? (
          <div className="flex flex-col gap-4">
            <p>
              Your offer of <b>{pct(sent)}</b> is in front of the exporter. If they accept it, they open the facility on chain naming your wallet,
              and you deposit the capital from the financier portal.
            </p>
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`/market/${r.id}`} variant="secondary">See all offers</LinkButton>
              <Button variant="ghost" onClick={close}>Done</Button>
            </div>
          </div>
        ) : !hydrated || !address ? (
          <div className="flex flex-col items-start gap-4">
            <p className="text-slate">Connect the wallet you will fund from. Offers are signed messages: they cost no gas and commit nothing until the exporter opens the facility.</p>
            <WalletButton />
          </div>
        ) : role === "exporter" || role === "buyer" ? (
          <p className="rounded-2xl bg-alert/12 p-4 text-sm">
            This wallet is the {role} on this shipment. The financier must be a different wallet from the exporter and the buyer.
          </p>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <dl className="grid grid-cols-3 gap-3 rounded-2xl bg-ink/4 p-4 text-sm">
              <div><dt className="text-slate">Maximum fee</dt><dd className="font-mono font-semibold">{pct(r.maxFeeBps)}</dd></div>
              <div><dt className="text-slate">Best offer</dt><dd className="font-mono font-semibold">{best ? pct(best.feeBps) : "None yet"}</dd></div>
              <div><dt className="text-slate">Offers</dt><dd className="font-mono font-semibold">{r.offers.length}</dd></div>
            </dl>
            <Field
              label="Your fee"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              inputMode="decimal"
              suffix="%"
              data-autofocus
              error={touched || fee.trim() !== "" ? err : null}
              hint={earn !== null ? `${formatUSDG(earn)} USDG if fully drawn, paid from the invoice at settlement.` : undefined}
            />
            {mine && <p className="text-sm text-slate">You offered {pct(mine.feeBps)}. Sending a new fee replaces it.</p>}
            {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
            <p className="text-sm text-slate">Your wallet signs a message naming this request and the fee. Signing costs no gas.</p>
            <Button type="submit" loading={busy !== null} disabled={!!err}>
              {busy === "sign" ? "Waiting for your signature…" : busy === "send" ? "Sending…" : mine ? "Sign and update offer" : "Sign and send offer"}
            </Button>
          </form>
        )}
      </Modal>
    </div>
  );
}
