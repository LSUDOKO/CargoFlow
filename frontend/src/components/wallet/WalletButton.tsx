"use client";

import { useEffect, useRef, useState } from "react";
import { useHydrated } from "@/lib/useHydrated";
import { useAccount, useDisconnect, useReadContract } from "wagmi";
import { Button } from "@/components/ui/Button";
import { usdgAbi } from "@/lib/chain/abis";
import { useContracts } from "@/lib/chain/contracts";
import { chainName } from "@/lib/explorer";
import { formatUSDG, shortHash } from "@/lib/format";
import { WalletModal } from "./WalletModal";

/**
 * `onDark` is the header placement: an outlined button, so the lime primary stays free for each page's own main action.
 * `compact` hides the balance next to the address once connected.
 */
export function WalletButton({ compact, onDark }: { compact?: boolean; onDark?: boolean }) {
  const { address, isConnected, chainId } = useAccount();
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
        <span className={`grid h-8 w-8 place-items-center rounded-full ${wrongChain ? "bg-alert" : "bg-signal"}`} aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-ink" />
        </span>
        <span className="font-mono">{shortHash(address, 4, 4)}</span>
        {!compact && balance !== undefined && <span className="hidden opacity-70 lg:inline">{formatUSDG(balance as bigint)} USDG</span>}
      </button>
      {menu && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-64 rounded-2xl border border-line bg-white p-2 shadow-[var(--shadow-lift)]">
          <div className="px-3 py-2 text-sm">
            <p className="font-semibold">{wrongChain ? "Wrong network" : chainName(chainId)}</p>
            <p className="font-mono text-xs break-all text-slate">{address}</p>
            {balance !== undefined && <p className="mt-1 text-slate">{formatUSDG(balance as bigint)} USDG</p>}
          </div>
          <button type="button" role="menuitem" onClick={() => navigator.clipboard?.writeText(address)} className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-ink/5">
            Copy address
          </button>
          <button type="button" role="menuitem" onClick={() => { disconnect(); setMenu(false); }} className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-danger hover:bg-danger/5">
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
