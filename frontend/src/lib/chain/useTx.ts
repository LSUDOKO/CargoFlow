"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import type { Abi, Address, Hash } from "viem";
import { useAccount } from "wagmi";
import { switchChain, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { useToast } from "@/components/ui/Toast";
import { explorerTx } from "@/lib/explorer";
import { wagmiConfig, type SupportedChainId } from "./config";
import { useContracts } from "./contracts";
import { decodeRevert, txGuard } from "./errors";

export type TxRequest = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; label: string; successTitle?: string };

/**
 * Sends one contract transaction from the connected wallet: refuses while another is pending or on the wrong
 * network, waits for the receipt, toasts the result with an explorer link and refreshes every query. It resolves
 * to the hash on success and undefined otherwise; it never throws.
 */
export function useTx() {
  const { chainId: walletChain, isConnected } = useAccount();
  const { chainId: appChain } = useContracts();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [hash, setHash] = useState<Hash>();
  const busy = useRef(false); // synchronous guard: a double click lands before React re-renders

  const send = useCallback(
    async (req: TxRequest): Promise<Hash | undefined> => {
      if (appChain === undefined || busy.current) {
        toast({ tone: "alert", title: appChain === undefined ? "The network configuration is still loading." : txGuard({ pending: true, walletChain, appChain })! });
        return undefined;
      }
      // claim the guard before anything is awaited: a second click during the network switch must not send twice
      busy.current = true;
      setPending(true);
      try {
        let reason = txGuard({ pending: false, walletChain: isConnected ? walletChain : undefined, appChain });
        if (reason && isConnected && walletChain !== appChain) {
          // ask the wallet to change network itself; only if it refuses does the person have to do it by hand
          try {
            await switchChain(wagmiConfig, { chainId: appChain as SupportedChainId });
            reason = null;
          } catch {
            /* keep the reason */
          }
        }
        if (reason) {
          toast({ tone: "alert", title: reason });
          return undefined;
        }
        const chainId = appChain as SupportedChainId;
        // the request is dynamic (any function of any CargoFlow ABI), so it is checked at the call sites instead
        const params = { address: req.address, abi: req.abi, functionName: req.functionName, args: req.args, chainId };
        const h = await writeContract(wagmiConfig, params as never);
        setHash(h);
        const receipt = await waitForTransactionReceipt(wagmiConfig, { hash: h, chainId });
        if (receipt.status !== "success") throw new Error("the transaction reverted");
        toast({ tone: "verified", title: req.successTitle ?? `${req.label} confirmed`, href: explorerTx(appChain, h) });
        await qc.invalidateQueries();
        return h;
      } catch (err) {
        toast({ tone: "danger", title: `${req.label} failed`, body: decodeRevert(err) });
        return undefined;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [appChain, isConnected, walletChain, qc, toast],
  );

  return { send, pending, hash };
}
