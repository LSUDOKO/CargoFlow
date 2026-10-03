// Print each demo role's address, ETH and USDG balance (no secrets).
import { viem } from "./lib/deps.mjs";
import { USDG, address, erc20, publicClient, roles } from "./lib/chain.mjs";

const extra = process.argv.slice(2);
for (const who of [...roles, ...extra]) {
  const a = address(who) ?? who;
  const [eth, usdg] = await Promise.all([
    publicClient.getBalance({ address: a }),
    publicClient.readContract({ address: USDG, abi: erc20, functionName: "balanceOf", args: [a] }),
  ]);
  console.log(`${who.padEnd(10)} ${a}  ETH ${viem.formatEther(eth).slice(0, 10).padEnd(10)}  USDG ${viem.formatUnits(usdg, 6)}`);
}
