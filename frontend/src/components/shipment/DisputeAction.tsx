"use client";

import { useState } from "react";
import { keccak256, toBytes } from "viem";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { controllerAbi } from "@/lib/chain/abis";
import { useTx } from "@/lib/chain/useTx";

/**
 * The exporter or the financier freezes the facility and asks the arbiter to decide. Only the keccak256 hash of the
 * written reason goes on chain; the text stays with the parties, who share it with the arbiter.
 */
export function DisputeAction({ shipmentId, controller }: { shipmentId: `0x${string}`; controller: `0x${string}` }) {
  const { send, pending } = useTx();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const text = reason.trim();
  const hash = text ? keccak256(toBytes(text)) : null;

  async function submit() {
    if (!hash) return;
    const tx = await send({ address: controller, abi: controllerAbi, functionName: "openDispute", args: [shipmentId, hash], label: "Open dispute", successTitle: "Dispute opened: the arbiter decides next" });
    if (tx) {
      setOpen(false);
      setReason("");
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Open a dispute</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Open a dispute" description="Releases stop at once and the arbiter decides whether the facility resumes or defaults.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="text-sm font-semibold" htmlFor="dispute-reason">What went wrong</label>
          <textarea
            id="dispute-reason"
            data-autofocus
            rows={4}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Container MSKU 482113-0 arrived with a broken seal at Singapore; survey report 2026-118 attached to our email."
            className="-mt-2 rounded-tile border-2 border-line bg-white p-3 text-body outline-none focus:border-ink"
          />
          {hash && (
            <p className="text-sm text-text-muted">
              On chain this is recorded as <code className="font-mono text-xs break-all text-ink">{hash}</code>. Keep the text: the arbiter can check it against this hash.
            </p>
          )}
          <Button type="submit" variant="danger" loading={pending} disabled={!hash}>Freeze releases and open the dispute</Button>
        </form>
      </Modal>
    </>
  );
}
