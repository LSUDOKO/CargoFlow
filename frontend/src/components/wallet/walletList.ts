import type { ReactNode } from "react";
import type { Connector } from "wagmi";

export type WalletOption = {
  key: string;
  connector: Connector;
  /** installed browser wallets, other ways to connect, or the local E2E test accounts */
  group: "installed" | "more" | "test";
  name: string;
  hint: string;
  icon: ReactNode;
  /** row title while connecting, e.g. "Opening MetaMask…" */
  verb: string;
  /** row hint while connecting */
  waiting: string;
  recent?: boolean;
};

/**
 * The wallet list as shown: one row per wallet, the most recently used first within its group.
 * - Wallets that announce themselves (EIP-6963) each get their own row; the generic "injected" connector is then
 *   redundant and hidden. It stays only when a legacy wallet exposes window.ethereum without announcing itself.
 * - Duplicate ids (a wallet announced twice) are dropped.
 */
export function orderWallets(options: WalletOption[], { recent, hasLegacyInjected }: { recent: string | null; hasLegacyInjected: boolean }) {
  const seen = new Set<string>();
  const announced = options.some((o) => o.connector.type === "injected" && o.connector.id !== "injected");
  const kept = options.filter((o) => {
    const id = o.connector.id;
    if (seen.has(id)) return false;
    seen.add(id);
    if (id === "injected") return !announced && hasLegacyInjected;
    return true;
  });
  return kept
    .map((o) => ({ ...o, recent: !!recent && o.connector.id === recent }))
    .sort((a, b) => Number(b.recent) - Number(a.recent)); // a stable sort keeps discovery order otherwise
}
