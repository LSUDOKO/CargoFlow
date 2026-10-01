import { createConfig, http, type CreateConnectorFn } from "wagmi";
import { injected, mock, walletConnect } from "wagmi/connectors";
import { defineChain, type Address } from "viem";
import { anvil } from "viem/chains";
import { ROBINHOOD_EXPLORER } from "@/lib/explorer";

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Robinhood Explorer", url: ROBINHOOD_EXPLORER } },
  testnet: true,
});

export const supportedChains = [robinhoodTestnet, anvil] as const;
export type SupportedChainId = (typeof supportedChains)[number]["id"];

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
const e2e = process.env.NEXT_PUBLIC_E2E === "1";

/** Anvil's public dev accounts 1-3, used only by the end-to-end tests (NEXT_PUBLIC_E2E=1). */
export const E2E_ACCOUNTS: { id: string; name: string; address: Address }[] = [
  { id: "e2e-exporter", name: "Test exporter", address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
  { id: "e2e-financier", name: "Test financier", address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" },
  { id: "e2e-buyer", name: "Test buyer", address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906" },
];

function e2eConnector(id: string, name: string, address: Address): CreateConnectorFn {
  const base = mock({ accounts: [address], features: { reconnect: true } });
  return (config) => ({ ...base(config), id, name });
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
        url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
        icons: [],
      },
    }),
  );
}
if (e2e) for (const a of E2E_ACCOUNTS) connectors.push(e2eConnector(a.id, a.name, a.address));

export const wagmiConfig = createConfig({
  chains: supportedChains,
  connectors,
  transports: { [robinhoodTestnet.id]: http(), [anvil.id]: http("http://127.0.0.1:8545") },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
