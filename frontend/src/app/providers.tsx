"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { ToastProvider } from "@/components/ui/Toast";
import { PRIVY_APP_ID, wagmiConfig } from "@/lib/chain/config";

// Email login loads only when a Privy app id is configured at build time, and only in the browser: without the id
// the chunk is never requested, and the server render (Cloudflare Workers) never touches Privy either way.
const PrivyBridge = PRIVY_APP_ID ? dynamic(() => import("@/components/wallet/privy/PrivyBridge"), { ssr: false }) : null;

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: true } } }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          {children}
          {PrivyBridge && <PrivyBridge />}
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
