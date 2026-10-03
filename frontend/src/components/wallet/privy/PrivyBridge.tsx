"use client";

// Loaded with next/dynamic (ssr: false) only when NEXT_PUBLIC_PRIVY_APP_ID is set. It renders no app content: it
// mounts Privy beside the app, runs the email + one-time-code login headlessly for the inline step in WalletModal,
// hands the embedded wallet's EIP-1193 provider to the "Email wallet" wagmi connector (lib/chain/config.ts) and
// connects it, so signing and transactions go through the same wagmiConfig, useTx and signMessage paths as every
// other wallet.

import { PrivyProvider, useCreateWallet, useLoginWithEmail, usePrivy, useWallets } from "@privy-io/react-auth";
import { Component, useEffect, useRef } from "react";
import type { EIP1193Provider } from "viem";
import { connect } from "wagmi/actions";
import { EMBEDDED_CONNECTOR_ID, localChain, PRIVY_APP_ID, robinhoodTestnet, setEmbeddedProvider, wagmiConfig } from "@/lib/chain/config";
import { registerEmbedded, setEmbeddedState, useEmbedded } from "../embedded";
import { emailError } from "../walletErrors";

/** How long wallet creation and connection may take after a correct code before the step offers a retry. */
const CONNECT_TIMEOUT_MS = 30_000;

/** A misconfigured app id (or Privy failing to start) turns email login off; it never takes the app down with it. */
class Contain extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    registerEmbedded(null);
    const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
    setEmbeddedState({ failure: `The sign-in service failed to start (${detail}).`, step: "idle" });
    console.error("Email login is unavailable:", detail);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function PrivyBridge() {
  const { attempt } = useEmbedded();
  return (
    <Contain key={attempt}>
      <PrivyProvider
        appId={PRIVY_APP_ID}
        config={{
          loginMethods: ["email"],
          embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
          // both CargoFlow networks as custom chains; the app switches between them through the connector
          supportedChains: [robinhoodTestnet, localChain],
          defaultChain: robinhoodTestnet,
          // Privy is only the email wallet here: wagmi owns browser wallets and WalletConnect. Without this Privy
          // starts its own WalletConnect core ("Init() was called 2 times") and Coinbase connectors on every page.
          externalWallets: { walletConnect: { enabled: false }, disableAllExternalWallets: true },
          appearance: { theme: "light", accentColor: "#0B1B2B", walletChainType: "ethereum-only" },
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
  const { ready, authenticated, logout, error: initError } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const wanted = useRef(false); // the person asked for the email wallet in this tab
  const embeddedRef = useRef(embedded);
  useEffect(() => {
    embeddedRef.current = embedded;
  });

  // Privy reports a failed initialisation only as a console warning and leaves `ready` false: surface it instead
  useEffect(() => {
    if (initError) setEmbeddedState({ failure: `The sign-in service could not start (${initError.message.split("\n")[0]}).` });
  }, [initError]);

  useEffect(() => {
    setEmbeddedState({ authenticated });
  }, [authenticated]);

  // the latest Privy functions, so the handlers registered once stay current
  const live = useRef({ sendCode, loginWithCode, logout });
  useEffect(() => {
    live.current = { sendCode, loginWithCode, logout };
  });

  useEffect(() => {
    if (!ready) return;
    registerEmbedded({
      sendCode: async (email) => {
        setEmbeddedState({ step: "sending", email, error: null });
        try {
          await live.current.sendCode({ email });
          setEmbeddedState({ step: "code" });
        } catch (e) {
          setEmbeddedState({ step: "idle", error: emailError(e, "send") });
        }
      },
      verify: async (code) => {
        setEmbeddedState({ step: "verifying", error: null });
        try {
          wanted.current = true;
          await live.current.loginWithCode({ code });
          // the wallet effect below may already have connected by the time the login promise settles
          if (wagmiConfig.state.status !== "connected") setEmbeddedState({ step: "connecting" });
        } catch (e) {
          wanted.current = false;
          setEmbeddedState({ step: "code", error: emailError(e, "verify") });
        }
      },
      resume: async () => {
        wanted.current = true;
        setEmbeddedState({ step: "connecting", error: null });
        if (embeddedRef.current) {
          try {
            await connectEmbedded();
            setEmbeddedState({ step: "idle" });
          } catch (e) {
            wanted.current = false;
            setEmbeddedState({ step: "idle", error: emailError(e, "wallet") });
          }
        }
        // otherwise the wallet effect below creates or connects it once Privy's wallets are ready
      },
      logout: async () => {
        wanted.current = false;
        setEmbeddedProvider(undefined);
        await live.current.logout();
        setEmbeddedState({ step: "idle", email: "", error: null });
      },
    });
    return () => registerEmbedded(null);
  }, [ready]);

  // a logged-in person without an embedded wallet (creation skipped or failed): create one when they ask for it
  const creating = useRef(false);
  useEffect(() => {
    if (!walletsReady || !authenticated || embedded || !wanted.current || creating.current) return;
    creating.current = true;
    createWallet()
      .catch((e: unknown) => {
        wanted.current = false;
        setEmbeddedState({ step: "idle", error: emailError(e, "wallet") });
      })
      .finally(() => {
        creating.current = false;
      });
  }, [walletsReady, authenticated, embedded, createWallet]);

  // give the connector the embedded wallet's provider, then connect it when asked to (or when it was the last wallet)
  const address = embedded?.address;
  useEffect(() => {
    if (!walletsReady) return;
    if (!embedded || !authenticated) {
      setEmbeddedProvider(undefined);
      return;
    }
    let current = true;
    void (async () => {
      try {
        const provider = (await embedded.getEthereumProvider()) as EIP1193Provider;
        if (!current) return;
        setEmbeddedProvider(provider);
        const recent = await wagmiConfig.storage?.getItem("recentConnectorId");
        const disconnected = await wagmiConfig.storage?.getItem(`${EMBEDDED_CONNECTOR_ID}.disconnected`);
        if (wanted.current || (recent === EMBEDDED_CONNECTOR_ID && !disconnected)) await connectEmbedded();
        setEmbeddedState({ step: "idle", error: null });
      } catch (e) {
        setEmbeddedState({ step: "idle", error: emailError(e, "wallet") });
      } finally {
        wanted.current = false;
      }
    })();
    return () => {
      current = false;
    };
    // the wallet object identity changes on every render; its address is what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, authenticated, walletsReady]);

  // never leave the person on "Setting up your wallet" forever
  const { step } = useEmbedded();
  useEffect(() => {
    if (step !== "connecting") return;
    const t = setTimeout(() => {
      wanted.current = false;
      const done = wagmiConfig.state.status === "connected";
      setEmbeddedState({ step: "idle", error: done ? null : "Setting up your email wallet is taking too long. Try again." });
    }, CONNECT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [step]);

  return null;
}
