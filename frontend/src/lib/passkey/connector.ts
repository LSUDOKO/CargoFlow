"use client";

// A wagmi connector for passkey smart accounts. Every wagmi action (writeContract, signMessage, the useTx flows) works
// unchanged: the connector's EIP-1193 provider routes them to the Kernel account (see provider.ts). The ZeroDev SDK is
// loaded on first use, so the connector costs nothing for people who never pick a passkey.
import { createConnector } from "wagmi";
import { getAddress, type Address } from "viem";
import { PASSKEY_CHAIN_ID, PASSKEY_CONNECTOR_ID } from "./env";
import { createKernelProvider, ProviderRpcError, type KernelProvider } from "./provider";
import { loadPasskey, savePasskey, setPasskeyState } from "./store";

export function passkeyConnector() {
  let provider: KernelProvider | undefined;
  let address: Address | undefined;
  let opening: Promise<KernelProvider> | undefined;

  async function open(): Promise<KernelProvider> {
    if (provider) return provider;
    opening ??= (async () => {
      const stored = loadPasskey();
      if (!stored) throw new ProviderRpcError(4100, "No passkey account on this device yet. Create one or sign in with an existing passkey.");
      const { openSession } = await import("./kernel");
      const session = await openSession(stored);
      address = session.address;
      if (stored.address !== session.address) savePasskey({ ...stored, address: session.address });
      provider = createKernelProvider(session.deps);
      void session.checkSponsorship();
      return provider;
    })().finally(() => {
      opening = undefined;
    });
    return opening;
  }

  return createConnector<KernelProvider>((config) => ({
    id: PASSKEY_CONNECTOR_ID,
    name: "Passkey account",
    type: "passkey",
    async connect({ chainId, withCapabilities } = {}) {
      if (chainId !== undefined && chainId !== PASSKEY_CHAIN_ID) {
        throw new ProviderRpcError(4902, "Passkey accounts run on Robinhood Chain Testnet only.");
      }
      await open();
      const accounts = [getAddress(address!)];
      return {
        accounts: (withCapabilities ? accounts.map((a) => ({ address: a, capabilities: {} })) : accounts) as never,
        chainId: PASSKEY_CHAIN_ID,
      };
    },
    async disconnect() {
      provider = undefined;
      address = undefined;
      savePasskey(null);
      setPasskeyState({ sponsorship: "unknown", deployed: null });
    },
    async getAccounts() {
      await open();
      return [getAddress(address!)];
    },
    async getChainId() {
      return PASSKEY_CHAIN_ID;
    },
    async getProvider() {
      // wagmi asks for the provider before a session exists (e.g. on page load); a stub answers until then
      if (!provider && !loadPasskey()) return createKernelProvider({ address: "0x0000000000000000000000000000000000000000", chainId: PASSKEY_CHAIN_ID, sendCalls: noSession, signMessage: noSession, signTypedData: noSession, rpc: noSession });
      return open();
    },
    async isAuthorized() {
      if (!loadPasskey()) return false;
      try {
        await open();
        return !!address;
      } catch {
        return false;
      }
    },
    async switchChain({ chainId }) {
      const chain = config.chains.find((c) => c.id === chainId);
      if (!chain || chainId !== PASSKEY_CHAIN_ID) throw new ProviderRpcError(4902, "Passkey accounts run on Robinhood Chain Testnet only.");
      return chain;
    },
    onAccountsChanged(accounts) {
      if (accounts.length === 0) this.onDisconnect();
      else config.emitter.emit("change", { accounts: accounts.map((a) => getAddress(a)) });
    },
    onChainChanged(chain) {
      config.emitter.emit("change", { chainId: Number(chain) });
    },
    onDisconnect() {
      config.emitter.emit("disconnect");
    },
  }));
}

const noSession = async (): Promise<never> => {
  throw new ProviderRpcError(4100, "Connect the passkey account first.");
};
