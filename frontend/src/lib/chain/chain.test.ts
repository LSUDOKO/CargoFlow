import { describe, expect, it } from "vitest";
import { decodeRevert, txGuard } from "./errors";

describe("decodeRevert", () => {
  it("turns contract custom errors into sentences", () => {
    expect(decodeRevert({ shortMessage: 'The contract function "evaluateAndReleaseMilestone" reverted.\n\nError: FacilityPaused()' })).toMatch(/paused/i);
    expect(decodeRevert({ data: { errorName: "NotFinancier" } })).toMatch(/financier/i);
    expect(decodeRevert({ cause: { data: { errorName: "ERC20InsufficientBalance" } } })).toMatch(/enough USDG/i);
    expect(decodeRevert({ shortMessage: "User rejected the request." })).toMatch(/cancelled/i);
    expect(decodeRevert(new Error("boom"))).toBe("Transaction failed: boom");
    expect(decodeRevert("weird")).toBe("Transaction failed.");
  });
});

describe("txGuard", () => {
  it("refuses a second send while one is pending, a missing wallet and a wrong chain", () => {
    expect(txGuard({ pending: true, walletChain: 46630, appChain: 46630 })).toBe("A transaction is already in progress.");
    expect(txGuard({ pending: false, walletChain: 1, appChain: 46630 })).toBe("Switch your wallet to Robinhood Chain Testnet.");
    expect(txGuard({ pending: false, walletChain: undefined, appChain: 46630 })).toBe("Connect a wallet first.");
    expect(txGuard({ pending: false, walletChain: 46630, appChain: 46630 })).toBeNull();
    expect(txGuard({ pending: false, walletChain: 31337, appChain: 31337 })).toBeNull();
  });
});

describe("arbiter role", () => {
  it("matches the contract's Roles.DISPUTE_ROLE", async () => {
    const { DISPUTE_ROLE } = await import("./roles");
    expect(DISPUTE_ROLE).toBe("0xc785f0e55c16138ca0f8448186fa6229be092a3a83db3c5d63c9286723c5a2c4");
  });
});
