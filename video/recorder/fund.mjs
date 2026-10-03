// Top up a demo role with testnet USDG (and optionally ETH) from the deployer. Logs tx hashes only.
//   node fund.mjs <role> <usdg> [eth]
import fs from "node:fs";
import path from "node:path";
import { RECORDER, viem } from "./lib/deps.mjs";
import { USDG, address, erc20, publicClient, walletFor } from "./lib/chain.mjs";

const [role, usdg = "0", eth = "0"] = process.argv.slice(2);
const to = address(role);
if (!to) throw new Error(`unknown role ${role}`);
const w = walletFor("carrier");
const log = (e) => fs.appendFileSync(path.join(RECORDER, "txlog.jsonl"), JSON.stringify({ at: new Date().toISOString(), shot: "funding", ...e }) + "\n");
if (Number(usdg) > 0) {
  const hash = await w.writeContract({ address: USDG, abi: erc20, functionName: "transfer", args: [to, viem.parseUnits(usdg, 6)] });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`USDG ${usdg} -> ${role} ${to}: ${hash}`);
  log({ role: "carrier", what: `transfer ${usdg} USDG to ${role}`, hash });
}
if (Number(eth) > 0) {
  const hash = await w.sendTransaction({ to, value: viem.parseEther(eth) });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`ETH ${eth} -> ${role} ${to}: ${hash}`);
  log({ role: "carrier", what: `send ${eth} ETH to ${role}`, hash });
}
