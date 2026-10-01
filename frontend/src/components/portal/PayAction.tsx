"use client";

import type { Address } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { Button } from "@/components/ui/Button";
import { controllerAbi, usdgAbi } from "@/lib/chain/abis";
import { useContracts } from "@/lib/chain/contracts";
import { useTx } from "@/lib/chain/useTx";
import { formatUSDG } from "@/lib/format";
import { fundingNeeds } from "@/lib/portal";

type Props = {
  shipmentId: `0x${string}`;
  amount: bigint; // USDG base units the vault will pull
  action: "depositCapital" | "settle";
  label: string; // e.g. "Deposit 40,000 USDG"
  successTitle: string;
};

/**
 * A two-step payment into the escrow vault: approve exactly the amount, then call the controller, which pulls
 * it. Shows the shortfall and a faucet link when the wallet cannot pay.
 */
export function PayAction({ shipmentId, amount, action, label, successTitle }: Props) {
  const { address } = useAccount();
  const { contracts, chainId } = useContracts();
  const { send, pending } = useTx();
  const reads = useReadContracts({
    contracts: contracts && address
      ? [
          { address: contracts.usdg, abi: usdgAbi, functionName: "balanceOf", args: [address], chainId: chainId as 46630 | 31337 },
          { address: contracts.usdg, abi: usdgAbi, functionName: "allowance", args: [address, contracts.vault], chainId: chainId as 46630 | 31337 },
        ]
      : [],
    query: { enabled: !!contracts && !!address, refetchInterval: 10_000 },
  });
  const balance = reads.data?.[0]?.result as bigint | undefined;
  const allowance = reads.data?.[1]?.result as bigint | undefined;
  const needs = fundingNeeds(balance, allowance, amount);
  if (!contracts) return null;

  if (balance !== undefined && needs.shortfall > 0n) {
    return (
      <div className="rounded-2xl bg-alert/12 px-4 py-3 text-sm">
        <p className="font-semibold">This wallet needs {formatUSDG(needs.shortfall)} more USDG.</p>
        <p className="mt-1 text-ink/75">
          It holds {formatUSDG(balance)} of the {formatUSDG(amount)} required.{" "}
          {chainId === 46630 ? (
            <a href="https://faucet.paxos.com" target="_blank" rel="noreferrer" className="font-semibold underline">Get testnet USDG from the Paxos faucet</a>
          ) : (
            "On a local chain, mint test USDG from the demo page."
          )}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {needs.needsApproval && (
        <Button
          variant="secondary"
          loading={pending}
          disabled={balance === undefined}
          onClick={() =>
            send({ address: contracts.usdg, abi: usdgAbi, functionName: "approve", args: [contracts.vault as Address, amount], label: `Approve ${formatUSDG(amount)} USDG`, successTitle: "Vault approved" })
          }
        >
          1. Approve {formatUSDG(amount)} USDG
        </Button>
      )}
      <Button
        loading={pending}
        disabled={!needs.ready}
        onClick={() => send({ address: contracts.controller, abi: controllerAbi, functionName: action, args: [shipmentId], label, successTitle })}
      >
        {needs.needsApproval ? `2. ${label}` : label}
      </Button>
    </div>
  );
}
