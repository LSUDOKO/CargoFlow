"use client";

import { useState } from "react";
import { useHydrated } from "@/lib/useHydrated";
import { useAccount, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useContracts } from "@/lib/chain/contracts";
import { decodeRevert } from "@/lib/chain/errors";
import { chainName } from "@/lib/explorer";
import { WalletModal } from "./WalletModal";

/** Renders its children only when a wallet is connected to the network the deployment lives on. */
export function NetworkGuard({ children, purpose }: { children: React.ReactNode; purpose: string }) {
  const { isConnected, chainId } = useAccount();
  const { chainId: appChain } = useContracts();
  const { switchChain, isPending, error } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const mounted = useHydrated();
  if (isConnected && open) setOpen(false); // the picker closes once any wallet connects

  if (!mounted || !isConnected) {
    return (
      <Card className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold">Connect your wallet</h2>
          <p className="mt-1 text-slate">{purpose}</p>
        </div>
        <Button onClick={() => setOpen(true)}>Connect wallet</Button>
        <WalletModal open={open} onClose={() => setOpen(false)} />
      </Card>
    );
  }
  if (appChain !== undefined && chainId !== appChain) {
    return (
      <Card className="flex flex-col items-start gap-4 border-alert/50 bg-alert/8 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold">Switch to {chainName(appChain)}</h2>
          <p className="mt-1 text-slate">This deployment lives on {chainName(appChain)}; your wallet is on {chainName(chainId)}.</p>
          {error && <p className="mt-2 text-sm font-medium text-danger">{decodeRevert(error)}</p>}
        </div>
        <Button loading={isPending} onClick={() => switchChain({ chainId: appChain as 46630 | 31337 })}>
          Switch network
        </Button>
      </Card>
    );
  }
  return <>{children}</>;
}
