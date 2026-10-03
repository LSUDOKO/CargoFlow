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
  const gas = useGasDrip(isConnected ? address : undefined);
  const wrongNetwork = appChain !== undefined && chainId !== appChain;
  const autoKey = onDark && isEmail && gas.low && !wrongNetwork ? address : null;
  const [autoShown, setAutoShown] = useState<string | null>(null);
  if (autoKey && autoShown !== autoKey) {
    setAutoShown(autoKey);
    setMenu(true);
  }

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
        <span className={`relative grid h-8 w-8 place-items-center rounded-full ${wrongChain ? "bg-alert" : "bg-signal"}`} aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-ink" />
          {gas.low && !wrongChain && <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-alert ring-2 ring-ink" />}
        </span>
        {gas.low && !wrongChain && <span className="sr-only">Low on gas.</span>}
        <span className="font-mono">{shortHash(address, 4, 4)}</span>
        {!compact && balance !== undefined && <span className="hidden opacity-70 lg:inline">{formatUSDG(balance as bigint)} USDG</span>}
      </button>
      {menu && (
        <div role="menu" className="surface-light absolute right-0 z-40 mt-2 w-72 rounded-2xl border border-line bg-white p-2 text-ink shadow-[var(--shadow-lift)]">
          <div className="px-3 py-2 text-sm">
            <p className="font-semibold">{wrongChain ? "Wrong network" : chainName(chainId)}{isEmail && <span className="ml-2 rounded-full bg-mist px-2 py-0.5 text-xs font-semibold text-slate">Email wallet</span>}</p>
            <p className="font-mono text-xs break-all text-slate">{address}</p>
            {balance !== undefined && <p className="mt-1 text-slate">{formatUSDG(balance as bigint)} USDG</p>}
          </div>
          {!wrongChain && <GasHelper address={address} />}
          <Link href={`/parties/${address.toLowerCase()}`} role="menuitem" onClick={() => setMenu(false)} className="block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-ink/5">
            Your track record
          </Link>
          <button type="button" role="menuitem" onClick={() => navigator.clipboard?.writeText(address)} className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-ink/5">
            Copy address
          </button>
          <button type="button" role="menuitem" onClick={() => { disconnect(); if (isEmail) void logoutEmail(); setMenu(false); }} className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-danger hover:bg-danger/5">
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
