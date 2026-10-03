"use client";

import { useState } from "react";
import { useHydrated } from "@/lib/useHydrated";
import { useAccount, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Callout } from "@/components/ui/Banner";
import { useContracts } from "@/lib/chain/contracts";
import { decodeRevert } from "@/lib/chain/errors";
import { chainName } from "@/lib/explorer";
import { WalletModal } from "./WalletModal";

type Props = {
  children: React.ReactNode;
  /** One sentence: why this page needs the wallet. */
  purpose: string;
  /** Heading of the signed-out card. */
  title?: string;
  /** What a connected wallet can do on this page, shown beside the connect action (three short lines read best). */
  points?: string[];
  /** compact: a one-line callout for use inside another panel (no card, no list). */
  compact?: boolean;
};

function Check() {
  return (
    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-signal-soft text-signal-fg" aria-hidden="true">
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m3.8 8.4 2.7 2.7 5.7-6.2" /></svg>
    </span>
  );
}

/** Renders its children only when a wallet is connected to the network the deployment lives on. */
export function NetworkGuard({ children, purpose, title = "Connect your wallet", points, compact }: Props) {
  const { isConnected, chainId } = useAccount();
  const { chainId: appChain } = useContracts();
  const { switchChain, isPending, error } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const mounted = useHydrated();
  if (isConnected && open) setOpen(false); // the picker closes once any wallet connects

  if (!mounted || !isConnected) {
    const connect = (
      <>
        <Button onClick={() => setOpen(true)}>Connect wallet</Button>
        <WalletModal open={open} onClose={() => setOpen(false)} />
      </>
    );
    if (compact) {
      return (
        <Callout variant="neutral" title={title} action={connect}>
          {purpose}
        </Callout>
      );
    }
    return (
      <Card padded="lg" className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
        <div className="min-w-0">
          <h2 className="font-display text-h2">{title}</h2>
          <p className="mt-2 max-w-reading text-body text-text-muted">{purpose}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
            {connect}
            <p className="text-small text-text-muted">CargoFlow never holds your keys. Testnet only.</p>
          </div>
        </div>
        {points && points.length > 0 && (
          <div className="min-w-0 rounded-tile bg-surface-sunken p-5">
            <p className="eyebrow">What you can do here</p>
            <ul className="mt-3 flex flex-col gap-3">
              {points.map((p) => (
                <li key={p} className="flex gap-3 text-sm">
                  <Check />
                  <span className="min-w-0">{p}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    );
  }
  if (appChain !== undefined && chainId !== appChain) {
    return (
      <Callout
        variant="warning"
        title={`Switch to ${chainName(appChain)}`}
        action={
          <Button loading={isPending} onClick={() => switchChain({ chainId: appChain as 46630 | 31337 })}>
            Switch network
          </Button>
        }
      >
        This deployment lives on {chainName(appChain)}; your wallet is on {chainName(chainId)}.
        {error && <span className="mt-1 block font-medium text-danger-fg">{decodeRevert(error)}</span>}
      </Callout>
    );
  }
  return <>{children}</>;
}
