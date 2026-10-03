"use client";

// Loaded with next/dynamic (ssr: false) only when NEXT_PUBLIC_PRIVY_APP_ID is set. It renders no app content: it
// mounts Privy beside the app, hands the embedded wallet's EIP-1193 provider to the "Email wallet" wagmi connector
// (lib/chain/config.ts) and connects it, so signing and transactions go through the same wagmiConfig, useTx and
// signMessage paths as every other wallet.

import { PrivyProvider, useLogin, usePrivy, useWallets } from "@privy-io/react-auth";
import { Component, useEffect, useRef } from "react";
import type { EIP1193Provider } from "viem";
import { connect } from "wagmi/actions";
import { EMBEDDED_CONNECTOR_ID, localChain, PRIVY_APP_ID, robinhoodTestnet, setEmbeddedProvider, wagmiConfig } from "@/lib/chain/config";
import { registerEmbedded, setEmbeddedState } from "../embedded";

/** A misconfigured app id (or Privy failing to start) turns email login off; it never takes the app down with it. */
class Contain extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    registerEmbedded(null);
    setEmbeddedState({ enabled: false, busy: false, error: null });
    console.error("Email login is unavailable:", err instanceof Error ? err.message : err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function PrivyBridge() {
  return (
    <Contain>
      <PrivyProvider
        appId={PRIVY_APP_ID}
        config={{
          loginMethods: ["email"],
          embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
          // both CargoFlow networks as custom chains; the app switches between them through the connector
          supportedChains: [robinhoodTestnet, localChain],
          defaultChain: robinhoodTestnet,
          appearance: { theme: "light", accentColor: "#0B1B2B", landingHeader: "Continue with email", walletChainType: "ethereum-only" },
        }}
      >
        <EmbeddedWalletSync />
      </PrivyProvider>
    </Contain>
  );
}

const connector = () => wagmiConfig.connectors.find((c) => c.id === EMBEDDED_CONNECTOR_ID);

async function connectEmbedded() {
  const c = connector();
  if (!c || wagmiConfig.state.status === "connected") return;
  await connect(wagmiConfig, { connector: c });
}

function EmbeddedWalletSync() {
  const { ready, authenticated, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const wanted = useRef(false); // the person pressed "Continue with email" in this tab
  const { login } = useLogin({
    onComplete: () => {
      wanted.current = true;
    },
    onError: (code) => {
      wanted.current = false;
      setEmbeddedState({ busy: false, error: code === "exited_auth_flow" ? null : "The email login did not finish. Try again." });
    },
  });

  // hand the UI the real login and logout once Privy is ready
  useEffect(() => {
    if (!ready) return;
    registerEmbedded({
      login: () => {
        wanted.current = true;
        if (authenticated && embedded) void connectEmbedded().finally(() => setEmbeddedState({ busy: false }));
        else if (!authenticated) login({ loginMethods: ["email"] });
      },
      logout: async () => {
        wanted.current = false;
        setEmbeddedProvider(undefined);
        await logout();
      },
    });
    return () => registerEmbedded(null);
  }, [ready, authenticated, embedded, login, logout]);

  // give the connector the embedded wallet's provider, then connect it when asked to (or when it was the last wallet)
  const address = embedded?.address;
  useEffect(() => {
    if (!walletsReady) return;
    if (!embedded || !authenticated) {
      setEmbeddedProvider(undefined);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const provider = (await embedded.getEthereumProvider()) as EIP1193Provider;
        if (!live) return;
        setEmbeddedProvider(provider);
        const recent = await wagmiConfig.storage?.getItem("recentConnectorId");
        const disconnected = await wagmiConfig.storage?.getItem(`${EMBEDDED_CONNECTOR_ID}.disconnected`);
        if (wanted.current || (recent === EMBEDDED_CONNECTOR_ID && !disconnected)) await connectEmbedded();
        setEmbeddedState({ busy: false, error: null });
      } catch (e) {
        setEmbeddedState({ busy: false, error: e instanceof Error ? e.message.split("\n")[0]! : "The email wallet could not connect." });
      } finally {
        wanted.current = false;
      }
    })();
    return () => {
      live = false;
    };
    // the wallet object identity changes on every render; its address is what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, authenticated, walletsReady]);

  return null;
}
