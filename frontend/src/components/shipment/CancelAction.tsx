"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { ShipmentView } from "@/lib/api/schemas";
import { cancelState, countdownText } from "@/lib/cancel";
import { controllerAbi } from "@/lib/chain/abis";
import { useContracts } from "@/lib/chain/contracts";
import { useTx } from "@/lib/chain/useTx";
import { useCancelInfo } from "@/lib/chain/v3";
import { formatUSDG } from "@/lib/format";

/** Seconds since the epoch, refreshed every 30 s so the countdown moves. */
function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * The exporter or the financier closes a facility that never started transit (contracts v3): at any time while
 * CREATED, and once 14 days have passed since the deposit while FINANCED. Asks for confirmation in an in-app dialog
 * that says where the money and the bill of lading go.
 */
export function CancelAction({ view }: { view: ShipmentView }) {
  const { address } = useAccount();
  const { contracts } = useContracts();
  const f = view.facility;
  const info = useCancelInfo(view.shipment.id, f?.status === "CREATED" || f?.status === "FINANCED");
  const now = useNow();
  const { send, pending } = useTx();
  const [open, setOpen] = useState(false);
  if (!f || !contracts || info.supported === false) return null;
  const state = cancelState({ status: f.status, exporter: f.exporter, financier: f.financier, address, financedAt: info.financedAt, timeoutSec: info.timeout, nowSec: now });
  if (state.kind === "hidden") return null;

  if (state.kind === "waiting") {
    return (
      <div className="flex flex-col gap-1">
        <Button variant="danger-outline" disabled aria-describedby="cancel-wait">Cancel facility</Button>
        <p id="cancel-wait" className="text-xs text-text-muted">
          Cancellable in <span className="font-mono font-semibold text-ink tabular">{countdownText(state.remainingSec)}</span> (14 days after the deposit), if transit has not started.
        </p>
      </div>
    );
  }

  async function confirm() {
    const h = await send({ address: contracts!.controller, abi: controllerAbi, functionName: "cancelFacility", args: [view.shipment.id as `0x${string}`], label: "Cancel facility", successTitle: "Facility cancelled" });
    if (h) setOpen(false);
  }

  return (
    <>
      <Button variant="danger-outline" onClick={() => setOpen(true)}>Cancel facility</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Cancel this facility?" description="The facility closes for good before transit. This cannot be undone.">
        <ul className="flex flex-col gap-3 text-sm">
          <li className="flex gap-3 rounded-tile bg-mist px-4 py-3">
            <span aria-hidden="true" className="mt-0.5 font-display font-bold">1</span>
            <span>
              {state.refundsDeposit ? (
                <>The whole <b className="font-mono">{formatUSDG(f.committed)} USDG</b> deposit returns to the financier. Nothing was released, so nothing else moves.</>
              ) : (
                <>Nothing has been deposited yet, so no money moves.</>
              )}
            </span>
          </li>
          <li className="flex gap-3 rounded-tile bg-mist px-4 py-3">
            <span aria-hidden="true" className="mt-0.5 font-display font-bold">2</span>
            <span>A bill of lading bound to the facility returns to the exporter.</span>
          </li>
          {view.cover && (
            <li className="flex gap-3 rounded-tile bg-mist px-4 py-3">
              <span aria-hidden="true" className="mt-0.5 font-display font-bold">3</span>
              <span>The default cover can then be returned to the insurer from the Money tab.</span>
            </li>
          )}
        </ul>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)} data-autofocus>Keep the facility</Button>
          <Button variant="danger" loading={pending} onClick={() => void confirm()}>Cancel the facility</Button>
        </div>
      </Modal>
    </>
  );
}
