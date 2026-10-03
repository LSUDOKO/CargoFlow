"use client";

import { useState } from "react";
import { formatEther, type Address } from "viem";
import { useBalance } from "wagmi";
import { signMessage } from "wagmi/actions";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError } from "@/lib/api/client";
import { gasMessage, nowSec, postGas, useConfigExtras } from "@/lib/api/market";
import { wagmiConfig, type SupportedChainId } from "@/lib/chain/config";
import { useContracts } from "@/lib/chain/contracts";
import { signatureError } from "@/lib/chain/errors";
import { explorerTx } from "@/lib/explorer";

/** Below this a wallet cannot reliably pay for a CargoFlow transaction on the app chain: 0.00003 ETH. */
export const LOW_GAS_WEI = 30_000_000_000_000n;

type State = { kind: "idle" } | { kind: "busy"; step: "sign" | "send" } | { kind: "done"; tx: string | null; wei: string | null } | { kind: "error"; message: string };

function gasError(err: unknown): string {
  if (!(err instanceof ApiError)) return "The gas request failed.";
  if (err.status === 503 || err.code === "gas_unavailable") return "The gas drip is not set up on this backend.";
  if (err.status === 429) return err.message ? `${err.message[0]!.toUpperCase()}${err.message.slice(1)}.` : "Gas was already sent to this address today.";
  if (err.code === "replayed") return "That signature was already used. Try again.";
  if (err.status === 409) return "This wallet already has enough gas for CargoFlow transactions.";
  return err.message;
}

/**
 * The wallet menu's "Get testnet gas" item: shown only when the backend offers a gas drip (/v1/config.gasDrip) and
 * the wallet's ETH balance on the app chain is under 0.00003 ETH. Signing the request costs nothing; the backend
 * sends a small amount from its drip wallet once per address per day.
 */
/** Whether the backend offers a gas drip and this wallet is low on the app chain's native currency. */
export function useGasDrip(address: Address | undefined) {
  const { data: cfg } = useConfigExtras();
  const { chainId: appChain } = useContracts();
  const enabled = !!cfg?.gasDrip;
  const balance = useBalance({
    address,
    chainId: appChain as SupportedChainId | undefined,
    query: { enabled: enabled && !!address && appChain !== undefined, refetchInterval: 30_000 },
  });
  return { enabled, low: enabled && balance.data !== undefined && balance.data.value < LOW_GAS_WEI, balance, appChain };
}

export function GasHelper({ address }: { address: Address }) {
  const { enabled, low, balance, appChain } = useGasDrip(address);
  const [state, setState] = useState<State>({ kind: "idle" });
  if (!enabled || (!low && state.kind !== "done")) return null;

  async function drip() {
    const issuedAt = nowSec();
    let signature: string;
    try {
      setState({ kind: "busy", step: "sign" });
      signature = await signMessage(wagmiConfig, { account: address, message: gasMessage(address, issuedAt) });
    } catch (err) {
      setState({ kind: "error", message: signatureError(err) });
      return;
    }
    try {
      setState({ kind: "busy", step: "send" });
      const out = await postGas({ address: address.toLowerCase(), issuedAt, signature });
      setState({ kind: "done", tx: out?.txHash ?? out?.hash ?? null, wei: out?.amountWei ?? null });
      setTimeout(() => void balance.refetch(), 6_000);
    } catch (err) {
      setState({ kind: "error", message: gasError(err) });
    }
  }

  const eth = balance.data ? Number(formatEther(balance.data.value)).toFixed(8).replace(/\.?0+$/, "") : null;
  const href = state.kind === "done" && state.tx ? explorerTx(appChain, state.tx) : null;
  return (
    <div className="mx-1 my-1 rounded-xl bg-alert/12 p-3 text-sm">
      {state.kind === "done" ? (
        <div role="status">
          <p className="font-semibold">{state.wei ? `${formatEther(BigInt(state.wei))} ETH is on its way` : "Testnet gas is on its way"}</p>
          <p className="mt-0.5 text-ink/75">It usually lands within a few seconds.</p>
          {href && (
            <a href={href} target="_blank" rel="noreferrer" className="mt-1 inline-block font-semibold underline underline-offset-2">
              View the transfer
            </a>
          )}
        </div>
      ) : (
        <>
          <p className="font-semibold">Low on gas</p>
          <p className="mt-0.5 text-ink/75">{eth ? `${eth} ETH. ` : ""}Transactions need a little ETH on this network.</p>
          <button
            type="button"
            role="menuitem"
            onClick={() => void drip()}
            disabled={state.kind === "busy"}
            className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-full bg-ink px-4 text-sm font-semibold text-paper transition-colors hover:bg-ink-2 disabled:opacity-60"
          >
            {state.kind === "busy" && <Spinner />}
            {state.kind === "busy" ? (state.step === "sign" ? "Waiting for your signature…" : "Requesting…") : "Get testnet gas"}
          </button>
          {state.kind === "error" && <p role="alert" className="mt-2 font-medium text-[#a1191e]">{state.message}</p>}
        </>
      )}
    </div>
  );
}
