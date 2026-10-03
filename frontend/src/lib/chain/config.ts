import { createConfig, http, type CreateConnectorFn } from "wagmi";
import { injected, mock, walletConnect } from "wagmi/connectors";
import { defineChain, type Address, type EIP1193Provider } from "viem";
import { anvil } from "viem/chains";
import { ROBINHOOD_EXPLORER } from "@/lib/explorer";
import { passkeyConnector } from "@/lib/passkey/connector";
import { PASSKEYS_ENABLED } from "@/lib/passkey/env";

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Robinhood Explorer", url: ROBINHOOD_EXPLORER } },
  testnet: true,
});

/** The local development chain (anvil). Its RPC is configurable so tests can run on their own port. */
const localRpc = process.env.NEXT_PUBLIC_LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
export const localChain = defineChain({ ...anvil, rpcUrls: { default: { http: [localRpc] } } });

export const supportedChains = [robinhoodTestnet, localChain] as const;
export type SupportedChainId = (typeof supportedChains)[number]["id"];

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
const e2e = process.env.NEXT_PUBLIC_E2E === "1";

/** Anvil's public dev accounts 1-3 and 6 (the local arbiter), used only by the end-to-end tests (NEXT_PUBLIC_E2E=1). */
export const E2E_ACCOUNTS: { id: string; name: string; address: Address }[] = [
  { id: "e2e-exporter", name: "Test exporter", address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
  { id: "e2e-financier", name: "Test financier", address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" },
  { id: "e2e-buyer", name: "Test buyer", address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" },
  { id: "e2e-arbiter", name: "Test arbiter", address: "0x976EA74026E726554dB657fA54763abd0C3a0aa9" },
];

function e2eConnector(id: string, name: string, address: Address): CreateConnectorFn {
  const base = mock({ accounts: [address], features: { reconnect: true } });
  return (config) => {
    const c = base(config);
    // the mock signs messages through the RPC of whichever chain it is on, but the test accounts only exist on the
    // local node, so signature requests always go there
    const getProvider = async (p?: { chainId?: number }) => {
      const provider = (await c.getProvider(p)) as { request: (a: { method: string; params?: unknown }) => Promise<unknown> };
      const local = (await c.getProvider({ chainId: localChain.id })) as typeof provider;
      return { ...provider, request: (a: { method: string; params?: unknown }) => (/sign/i.test(a.method) ? local.request(a) : provider.request(a)) };
    };
    return { ...c, id, name, getProvider };
  };
}

const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true })];
if (projectId) {
  connectors.push(
    walletConnect({
      projectId,
      showQrModal: true,
      metadata: {
        name: "CargoFlow",
        description: "Evidence-gated working capital for physical trade",
        // the page's own origin, so WalletConnect's origin check matches on every deployment and dev port
        url: typeof window !== "undefined" ? window.location.origin : (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
        icons: [`${typeof window !== "undefined" ? window.location.origin : (process.env.NEXT_PUBLIC_SITE_URL ?? "")}/brand/mark.svg`],
      },
    }),
  );
}
if (e2e) for (const a of E2E_ACCOUNTS) connectors.push(e2eConnector(a.id, a.name, a.address));

/**
 * Email login (Privy embedded wallet). The connector is a plain EIP-1193 target whose provider is handed over at
 * runtime by components/wallet/privy/PrivyBridge once the person has logged in, so this module never imports Privy
 * and nothing about it exists when NEXT_PUBLIC_PRIVY_APP_ID is unset. It sits beside the other connectors (unlike
 * @privy-io/wagmi, whose config and sync replace every non-Privy connector), so `wagmiConfig` and every
 * `wagmi/actions` call site work unchanged with the embedded wallet.
 */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
export const EMBEDDED_CONNECTOR_ID = "cargoflow-email";
let embeddedProvider: EIP1193Provider | undefined;
/** Set (or clear) the embedded wallet's EIP-1193 provider; called only by the Privy bridge. */
export function setEmbeddedProvider(p: EIP1193Provider | undefined) {
  embeddedProvider = p;
}
if (PRIVY_APP_ID) {
  connectors.push(injected({ shimDisconnect: true, target: { id: EMBEDDED_CONNECTOR_ID, name: "Email wallet", provider: () => embeddedProvider } }));
}

/**
 * Passkey smart accounts (ZeroDev Kernel + WebAuthn), only when NEXT_PUBLIC_ZERODEV_PROJECT_ID is set. The connector
 * module is small; the ZeroDev SDK loads the first time someone uses a passkey.
 */
if (PASSKEYS_ENABLED) connectors.push(passkeyConnector());

const create = () =>
  createConfig({
    chains: supportedChains,
    connectors,
    transports: { [robinhoodTestnet.id]: http(), [localChain.id]: http(localRpc) },
    ssr: true,
  });

/**
 * One config per browser tab. Creating it sets up the WalletConnect connector, which initialises WalletConnect Core;
 * a second config (a hot reload re-evaluating this module) would initialise Core again. Keeping the instance on
 * globalThis makes the connector a true singleton. (After editing this file in dev, reload the page to apply it.)
 */
const g = globalThis as typeof globalThis & { __cargoflowWagmi?: ReturnType<typeof create> };
export const wagmiConfig = typeof window === "undefined" ? create() : (g.__cargoflowWagmi ??= create());

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
