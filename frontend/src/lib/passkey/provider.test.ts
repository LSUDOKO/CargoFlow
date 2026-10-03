import { describe, expect, it, vi } from "vitest";
import { BaseError, createWalletClient, custom, encodeFunctionData, erc20Abi, toHex, type Hex } from "viem";
import { createKernelProvider, isPasskeyCancel, isPaymasterRefusal, isPrefundError, PasskeyGasError, ProviderRpcError, type KernelDeps } from "./provider";

const ADDR = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const TOKEN = "0x7E955252E15c84f5768B83c41a71F9eba181802F" as const;
const HASH = `0x${"ab".repeat(32)}` as Hex;

function deps(over: Partial<KernelDeps> = {}) {
  const d = {
    address: ADDR,
    chainId: 46630,
    sendCalls: vi.fn(async () => HASH),
    signMessage: vi.fn(async () => "0xsig" as Hex),
    signTypedData: vi.fn(async () => "0xtyped" as Hex),
    rpc: vi.fn(async (method: string) => (method === "eth_blockNumber" ? "0x10" : null)),
    ...over,
  };
  return d;
}

describe("passkey provider routing", () => {
  it("answers accounts and chain id locally", async () => {
    const d = deps();
    const p = createKernelProvider(d);
    expect(await p.request({ method: "eth_accounts" })).toEqual([ADDR]);
    expect(await p.request({ method: "eth_requestAccounts" })).toEqual([ADDR]);
    expect(await p.request({ method: "eth_chainId" })).toBe("0xb626");
    expect(d.rpc).not.toHaveBeenCalled();
  });

  it("turns eth_sendTransaction into one user operation call", async () => {
    const d = deps();
    const p = createKernelProvider(d);
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [OTHER, 5n] });
    const hash = await p.request({ method: "eth_sendTransaction", params: [{ from: ADDR, to: TOKEN, data, value: "0x0" }] });
    expect(hash).toBe(HASH);
    expect(d.sendCalls).toHaveBeenCalledWith([{ to: TOKEN, data, value: 0n }]);
  });

  it("batches wallet_sendCalls into a single user operation and reports its status", async () => {
    const d = deps({ rpc: vi.fn(async () => ({ status: "0x1", logs: [], transactionHash: HASH })) });
    const p = createKernelProvider(d);
    const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [OTHER, 5n] });
    const out = (await p.request({ method: "wallet_sendCalls", params: [{ version: "2.0.0", from: ADDR, chainId: "0xb626", calls: [{ to: TOKEN, data: approve }, { to: OTHER, data: "0x1234", value: "0x5" }] }] })) as { id: Hex };
    expect(out.id).toBe(HASH);
    expect(d.sendCalls).toHaveBeenCalledWith([
      { to: TOKEN, data: approve, value: 0n },
      { to: OTHER, data: "0x1234", value: 5n },
    ]);
    const status = (await p.request({ method: "wallet_getCallsStatus", params: [HASH] })) as { status: number; atomic: boolean };
    expect(status).toMatchObject({ status: 200, atomic: true });
  });

  it("signs personal_sign through the account as raw bytes (viem hex-encodes the text)", async () => {
    const d = deps();
    const p = createKernelProvider(d);
    const msg = toHex("CargoFlow gas\naddress: 0x11\nissued: 1");
    expect(await p.request({ method: "personal_sign", params: [msg, ADDR] })).toBe("0xsig");
    expect(d.signMessage).toHaveBeenCalledWith({ raw: msg });
  });

  it("works through viem's wallet client: signMessage and sendTransaction reach the account", async () => {
    const d = deps();
    const wallet = createWalletClient({ account: ADDR, transport: custom(createKernelProvider(d)) });
    await wallet.signMessage({ message: "hello" });
    expect(d.signMessage).toHaveBeenCalledWith({ raw: toHex("hello") });
    await wallet.sendTransaction({ chain: null, to: OTHER, value: 7n });
    expect(d.sendCalls).toHaveBeenCalledWith([{ to: OTHER, data: "0x", value: 7n }]);
  });

  it("parses typed data and refuses to sign for another address", async () => {
    const d = deps();
    const p = createKernelProvider(d);
    const typed = { domain: { name: "x" }, types: {}, primaryType: "Mail", message: {} };
    expect(await p.request({ method: "eth_signTypedData_v4", params: [ADDR, JSON.stringify(typed)] })).toBe("0xtyped");
    expect(d.signTypedData).toHaveBeenCalledWith(typed);
    await expect(p.request({ method: "personal_sign", params: ["0x00", OTHER] })).rejects.toMatchObject({ code: 4100 });
  });

  it("maps a dismissed passkey prompt to a user rejection (4001)", async () => {
    const cancelled = Object.assign(new Error("The operation either timed out or was not allowed."), { name: "NotAllowedError" });
    const p = createKernelProvider(deps({ signMessage: vi.fn(async () => Promise.reject(cancelled)) }));
    await expect(p.request({ method: "personal_sign", params: ["0x00", ADDR] })).rejects.toMatchObject({ code: 4001 });
  });

  it("lets the gas error through unchanged, and refuses other chains and unsupported methods", async () => {
    const p = createKernelProvider(deps({ sendCalls: vi.fn(async () => Promise.reject(new PasskeyGasError())) }));
    await expect(p.request({ method: "eth_sendTransaction", params: [{ to: OTHER }] })).rejects.toBeInstanceOf(PasskeyGasError);
    await expect(p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x7a69" }] })).rejects.toMatchObject({ code: 4902 });
    expect(await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xb626" }] })).toBeNull();
    await expect(p.request({ method: "eth_sendRawTransaction", params: ["0x"] })).rejects.toBeInstanceOf(ProviderRpcError);
    await expect(p.request({ method: "eth_sendTransaction", params: [{ data: "0x60" }] })).rejects.toMatchObject({ code: -32602 });
  });

  it("passes reads to the chain RPC", async () => {
    const d = deps();
    const p = createKernelProvider(d);
    expect(await p.request({ method: "eth_blockNumber" })).toBe("0x10");
    expect(d.rpc).toHaveBeenCalledWith("eth_blockNumber", undefined);
  });
});

describe("passkey error classification", () => {
  it("recognises paymaster refusals, missing prefund and cancellations", () => {
    expect(isPaymasterRefusal(new BaseError("zd_sponsorUserOperation failed", { details: "No gas policy found for project" }))).toBe(true);
    expect(isPaymasterRefusal(new Error("AA21 didn't pay prefund"))).toBe(false);
    expect(isPrefundError(new Error("UserOperation reverted: AA21 didn't pay prefund"))).toBe(true);
    expect(isPasskeyCancel(Object.assign(new Error("x"), { name: "NotAllowedError" }))).toBe(true);
    expect(isPasskeyCancel(new Error("execution reverted"))).toBe(false);
  });
});
