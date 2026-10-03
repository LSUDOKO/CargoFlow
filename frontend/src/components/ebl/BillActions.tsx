"use client";

import { useState } from "react";
import { isAddress, keccak256, toBytes, zeroHash, type Address } from "viem";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { eblRegistryAbi } from "@/lib/chain/abis";
import { useContracts } from "@/lib/chain/contracts";
import { useTx } from "@/lib/chain/useTx";
import { billActions, type Bill } from "@/lib/ebl";

type Open = "transfer" | "surrender" | "void" | null;

/** What the connected wallet can do with a bill: endorse it on, surrender it to the carrier, or (the issuer) void it. */
export function BillActions({ bill, size = "sm" }: { bill: Bill; size?: "sm" | "md" }) {
  const { address } = useAccount();
  const { contracts } = useContracts();
  const { send, pending } = useTx();
  const [open, setOpen] = useState<Open>(null);
  const [to, setTo] = useState("");
  const [touched, setTouched] = useState(false);
  const [reason, setReason] = useState("");
  const ebl = contracts?.eblRegistry;
  if (!ebl || !address) return null;
  const acts = billActions(bill, address, contracts.controller);
  if (!acts.transfer && !acts.surrender && !acts.void) return null;
  const n = `#${bill.tokenId}`;
  const toErr = !isAddress(to.trim()) ? "Enter the new holder's wallet address (0x…)." : to.trim().toLowerCase() === address.toLowerCase() ? "That is your own address." : null;

  const done = (h: string | undefined) => {
    if (h) {
      setOpen(null);
      setTo("");
      setReason("");
      setTouched(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {acts.transfer && <Button size={size} onClick={() => setOpen("transfer")}>Endorse to…</Button>}
      {acts.surrender && <Button size={size} variant="secondary" onClick={() => setOpen("surrender")}>Surrender to carrier</Button>}
      {acts.void && <Button size={size} variant="danger-outline" onClick={() => setOpen("void")}>Void bill</Button>}

      <Modal open={open === "transfer"} onClose={() => setOpen(null)} title={`Endorse bill ${n}`} description="Endorsing transfers the title: the new holder alone controls the goods and can endorse it again.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (toErr) return;
            void send({ address: ebl, abi: eblRegistryAbi, functionName: "safeTransferFrom", args: [address, to.trim() as Address, bill.tokenId], label: `Endorse bill ${n}`, successTitle: `Bill ${n} endorsed` }).then(done);
          }}
        >
          <Field label="New holder address" value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" error={touched || to ? toErr : undefined} data-autofocus spellCheck={false} autoComplete="off" />
          <p className="text-sm text-slate">A safe transfer: a contract address must accept ERC-721 tokens, so a bill cannot be stranded.</p>
          <Button type="submit" loading={pending}>Endorse bill {n}</Button>
        </form>
      </Modal>

      <Modal open={open === "surrender"} onClose={() => setOpen(null)} title={`Surrender bill ${n}?`} description="At delivery the holder returns the bill to the carrier that issued it.">
        <p className="text-sm">The bill moves to the carrier and freezes as <b>surrendered</b>. It can never be endorsed again.</p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(null)} data-autofocus>Keep it</Button>
          <Button loading={pending} onClick={() => void send({ address: ebl, abi: eblRegistryAbi, functionName: "surrender", args: [bill.tokenId], label: `Surrender bill ${n}`, successTitle: `Bill ${n} surrendered to the carrier` }).then(done)}>Surrender bill {n}</Button>
        </div>
      </Modal>

      <Modal open={open === "void"} onClose={() => setOpen(null)} title={`Void bill ${n}?`} description="The issuer can void a live bill it holds, for example one returned for amendment.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const r = reason.trim();
            void send({ address: ebl, abi: eblRegistryAbi, functionName: "voidBill", args: [bill.tokenId, r ? keccak256(toBytes(r)) : zeroHash], label: `Void bill ${n}`, successTitle: `Bill ${n} voided` }).then(done);
          }}
        >
          <Field label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Returned for amendment of the port of discharge" hint="Only its keccak256 hash goes on chain." data-autofocus />
          <p className="text-sm">The bill freezes as <b>void</b> and can never move again. Issue a new bill for the amended document.</p>
          <Button type="submit" variant="danger" loading={pending}>Void bill {n}</Button>
        </form>
      </Modal>
    </div>
  );
}
