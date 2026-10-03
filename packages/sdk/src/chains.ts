import { defineChain } from "viem";

export const ROBINHOOD_TESTNET_ID = 46630;
export const ROBINHOOD_EXPLORER = "https://explorer.testnet.chain.robinhood.com";

/** Robinhood Chain Testnet, where CargoFlow is deployed. */
export const robinhoodTestnet = defineChain({
  id: ROBINHOOD_TESTNET_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Robinhood Explorer", url: ROBINHOOD_EXPLORER } },
  testnet: true,
});

/** The live CargoFlow API and web app. */
export const DEFAULT_API_URL = "https://cargoflow-api-75ul.onrender.com";
export const DEFAULT_APP_URL = "https://cargoflow.adoranto737.workers.dev";

/** Explorer links, or null on chains without a known explorer (a local anvil). */
export function explorerTx(chainId: number, hash: string): string | null {
  return chainId === ROBINHOOD_TESTNET_ID ? `${ROBINHOOD_EXPLORER}/tx/${hash}` : null;
}
export function explorerAddress(chainId: number, address: string): string | null {
  return chainId === ROBINHOOD_TESTNET_ID ? `${ROBINHOOD_EXPLORER}/address/${address}` : null;
}
