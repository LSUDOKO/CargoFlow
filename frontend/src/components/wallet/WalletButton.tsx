"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useHydrated } from "@/lib/useHydrated";
import { useAccount, useDisconnect, useReadContract } from "wagmi";
import { Button } from "@/components/ui/Button";
import { usdgAbi } from "@/lib/chain/abis";
import { EMBEDDED_CONNECTOR_ID } from "@/lib/chain/config";
import { useContracts } from "@/lib/chain/contracts";
import { chainName } from "@/lib/explorer";
import { formatUSDG, shortHash } from "@/lib/format";
import { PASSKEY_CONNECTOR_ID } from "@/lib/passkey/env";
import { usePasskeyState } from "@/lib/passkey/store";
import { logoutEmail } from "./embedded";
import { GasHelper, useGasDrip } from "./GasHelper";
import { WalletModal } from "./WalletModal";

/**
 * `onDark` is the header placement: an outlined button, so the lime primary stays free for each page's own main action.
 * `compact` hides the balance next to the address once connected.
 */
export function WalletButton({ compact, onDark }: { compact?: boolean; onDark?: boolean }) {
  const { address, isConnected, chainId, connector } = useAccount();
  const isEmail = connector?.id === EMBEDDED_CONNECTOR_ID;
  const isPasskey = connector?.id === PASSKEY_CONNECTOR_ID;
  const passkey = usePasskeyState();
  const { disconnect } = useDisconnect();
  const { contracts, chainId: appChain } = useContracts();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const mounted = useHydrated();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  const { data: balance } = useReadContract({
    address: contracts?.usdg,
    abi: usdgAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: appChain as 46630 | 31337 | undefined,
    query: { enabled: !!address && !!contracts && chainId === appChain, refetchInterval: 15_000 },
  });

  // a brand-new email wallet has no gas: open the menu once on its own so "Get testnet gas" is one click away
  const drip = useGasDrip(isConnected ? address : undefined);
  // a sponsored passkey account never needs its own gas
  const gas = isPasskey && passkey.sponsorship === "on" ? { ...drip, low: false } : drip;
  const wrongNetwork = appChain !== undefined && chainId !== appChain;
  const autoKey = onDark && (isEmail || (isPasskey && passkey.sponsorship === "off")) && gas.low && !wrongNetwork ? address : null;
  const [autoShown, setAutoShown] = useState<string | null>(null);
  if (autoKey && autoShown !== autoKey) {
    setAutoShown(autoKey);
    setMenu(true);
  }

  // a wallet connected (from any row, or the email flow finishing in the background): the picker is done
  if (isConnected && open) setOpen(false);

  if (!mounted || !isConnected || !address) {
    return (
      <>
        <Button variant={onDark ? "inverse" : "primary"} onClick={() => setOpen(true)}>Connect wallet</Button>
        <WalletModal open={open} onClose={() => setOpen(false)} />
      </>
    );
  }
  const wrongChain = appChain !== undefined && chainId !== appChain;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setMenu((m) => !m)}
        aria-expanded={menu}
        aria-haspopup="menu"
        className="inline-flex h-11 items-center gap-2.5 rounded-full border-2 border-current/25 pr-4 pl-1.5 text-sm font-semibold whitespace-nowrap transition-colors hover:border-current/50"
      >
        <span className={`relative grid h-8 w-8 place-items-center rounded-full ${wrongChain ? "bg-warning" : "bg-signal"}`} aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-ink" />
          {gas.low && !wrongChain && <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-warning ring-2 ring-ink" />}
        </span>
        {gas.low && !wrongChain && <span className="sr-only">Low on gas.</span>}
        {isPasskey && <span className="hidden rounded-full bg-current/10 px-2 py-0.5 text-xs font-semibold md:inline">Passkey account</span>}
        <span className="font-mono">{shortHash(address, 4, 4)}</span>
        {!compact && balance !== undefined && <span className="hidden opacity-70 lg:inline">{formatUSDG(balance as bigint)} USDG</span>}
      </button>
      {menu && (
        <div role="menu" className="surface-light absolute right-0 z-(--z-overlay) mt-2 w-72 rounded-tile border border-border bg-surface p-2 text-ink shadow-3">
          <div className="px-3 py-2 text-sm">
            <p className="font-semibold">{wrongChain ? "Wrong network" : chainName(chainId)}{isEmail && <span className="ml-2 rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-text-muted">Email wallet</span>}{isPasskey && <span className="ml-2 rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-text-muted">Passkey account</span>}</p>
            <p className="font-mono text-xs break-all text-text-muted">{address}</p>
            {balance !== undefined && <p className="mt-1 text-text-muted">{formatUSDG(balance as bigint)} USDG</p>}
          </div>
          {isPasskey && <PasskeyGasNote sponsorship={passkey.sponsorship} />}
          {!wrongChain && !(isPasskey && passkey.sponsorship === "on") && <GasHelper address={address} />}
          <Link href={`/parties/${address.toLowerCase()}`} role="menuitem" onClick={() => setMenu(false)} className="block w-full rounded-control px-3 py-2 text-left text-sm font-semibold hover:bg-ink/6">
            Your track record
          </Link>
          <button type="button" role="menuitem" onClick={() => navigator.clipboard?.writeText(address)} className="w-full rounded-control px-3 py-2 text-left text-sm font-semibold hover:bg-ink/6">
            Copy address
          </button>
          <button type="button" role="menuitem" onClick={() => { disconnect(); if (isEmail) void logoutEmail(); setMenu(false); }} className="w-full rounded-control px-3 py-2 text-left text-sm font-semibold text-danger-fg hover:bg-danger-bg">
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

/** Whether CargoFlow's paymaster pays this passkey account's gas. */
export function PasskeyGasNote({ sponsorship }: { sponsorship: ReturnType<typeof usePasskeyState>["sponsorship"] }) {
  if (sponsorship === "on") {
    return (
      <p className="mx-1 my-1 flex items-center gap-2 rounded-control bg-success-bg px-3 py-2 text-sm font-semibold text-success-fg" role="status">
        <span className="grid h-4 w-4 place-items-center rounded-full bg-success-solid text-micro text-white" aria-hidden="true">✓</span>
        Gas paid by CargoFlow
      </p>
    );
  }
  if (sponsorship === "off") {
    return (
      <p className="mx-1 my-1 rounded-control bg-warning-bg px-3 py-2 text-sm" role="status">
        <span className="font-semibold">Gas sponsorship isn&apos;t on; this account needs a little testnet ETH.</span>{" "}
        <span className="text-text-muted">Send some to the address above, or use “Get testnet gas” once the account is set up.</span>
      </p>
    );
  }
  return <p className="mx-1 my-1 px-3 py-1 text-xs text-text-muted" role="status">{sponsorship === "checking" ? "Checking gas sponsorship…" : "Gas sponsorship is checked before your first transaction."}</p>;
}
