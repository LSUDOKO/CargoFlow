// Demo accounts and chain clients. Private keys are read from the repo .env at runtime, kept only in memory,
// and never logged, written or sent anywhere except as signatures. Only addresses leave this module.
import fs from "node:fs";
import path from "node:path";
import { REPO, viem, viemAccounts } from "./deps.mjs";

const { createPublicClient, createWalletClient, defineChain, http, parseAbi } = viem;

export const RPC = "https://rpc.testnet.chain.robinhood.com";
export const CHAIN_ID = 46630;
export const chain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
export const deployments = JSON.parse(fs.readFileSync(path.join(REPO, "contracts/deployments/robinhood-testnet.json"), "utf8"));
export const USDG = deployments.usdg;

function readEnv() {
  const out = {};
  for (const line of fs.readFileSync(path.join(REPO, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const ROLE_ENV = { exporter: "EXPORTER_KEY", financier: "FINANCIER_KEY", buyer: "BUYER_KEY", arbiter: "ARBITER_KEY", carrier: "private_key" };
export const ROLE_LABEL = { exporter: "Meera", financier: "Daniel", buyer: "Wei Lin", arbiter: "Arbiter", carrier: "Carrier" };

const accounts = (() => {
  const env = readEnv();
  const acc = {};
  for (const [role, name] of Object.entries(ROLE_ENV)) {
    let k = env[name];
    if (!k) continue;
    if (!k.startsWith("0x")) k = `0x${k}`;
    acc[role] = viemAccounts.privateKeyToAccount(k);
  }
  return acc;
})();

export const roles = Object.keys(accounts);
export const address = (role) => accounts[role]?.address;

export const publicClient = createPublicClient({ chain, transport: http(RPC, { retryCount: 3 }) });
const wallets = {};
export function walletFor(role) {
  if (!accounts[role]) throw new Error(`no key for role ${role}`);
  return (wallets[role] ??= createWalletClient({ account: accounts[role], chain, transport: http(RPC, { retryCount: 3 }) }));
}

export const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
]);
