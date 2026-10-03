import { describe, expect, it } from "vitest";
import { controllerAbi, coverPoolAbi, deviceRegistryAbi, eblRegistryAbi } from "./abis";
import { chainRejectedText, decodeRevert, txGuard } from "./errors";

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

describe("contracts v2 errors", () => {
  it("explain the new controller and cover pool errors in words", () => {
    expect(decodeRevert({ shortMessage: "reverted.\n\nError: OutsideMilestonePlace()" })).toMatch(/not yet within.*nothing failed/i);
    expect(decodeRevert({ data: { errorName: "EvidenceBelowPolicy" } })).toMatch(/humidity or shock/i);
    expect(decodeRevert({ data: { errorName: "InvalidMilestonePlace" } })).toMatch(/1 to 1,000 km/);
    // every CoverPool error has its own sentence rather than the generic fallback
    const names = coverPoolAbi.filter((x) => x.type === "error").map((x) => (x as { name: string }).name);
    for (const n of names) expect(decodeRevert({ data: { errorName: n } }), n).not.toMatch(/refused the transaction/);
  });
  it("reword the backend's 409 chain_rejected messages", () => {
    expect(chainRejectedText("the contract rejected the action: OutsideMilestonePlace: the cargo is not yet within the milestone's place; the milestone waits for evidence from there")).toMatch(/^The cargo is not yet within this milestone's place/);
    expect(chainRejectedText("the contract rejected the action: SomethingNew: the vault is busy")).toBe("The vault is busy.");
    expect(chainRejectedText("the contract rejected the action: SomethingNew")).toBe("The contract refused the action (SomethingNew).");
    expect(chainRejectedText("rate limited")).toBe("rate limited");
  });
});

describe("contracts v3 errors", () => {
  it("explain every v3 error, including ones with arguments, in words", () => {
    const v3 = ["EnforcedPause", "CancelNotAllowed", "TitleBindingDisabled", "TitleAlreadyBound", "InvalidTitle", "TitleNotTransferable", "NotHolder", "NotIssuer", "DocumentAlreadyIssued", "InvalidTrigger", "NotParametric", "TriggerNotMet", "AttestationRequired"];
    for (const n of v3) expect(decodeRevert({ data: { errorName: n } }), n).not.toMatch(/refused the transaction/);
    for (const abi of [controllerAbi, coverPoolAbi, deviceRegistryAbi, eblRegistryAbi]) {
      for (const n of abi.filter((x) => x.type === "error").map((x) => (x as { name: string }).name)) expect(decodeRevert({ data: { errorName: n } }), n).not.toMatch(/refused the transaction/);
    }
    expect(decodeRevert({ shortMessage: "reverted.\n\nError: TitleNotTransferable(uint8 status)\n (2)" })).toMatch(/surrendered or void/);
    expect(decodeRevert({ shortMessage: "reverted.\n\nError: EnforcedPause()" })).toMatch(/guardian.*still work/);
    expect(chainRejectedText("the contract rejected the action: TitleNotTransferable(2): the bill is frozen")).toMatch(/surrendered or void/);
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
  it("matches the contract's Roles.CARRIER_ROLE", async () => {
    const { CARRIER_ROLE } = await import("./roles");
    const { keccak256, toBytes } = await import("viem");
    expect(CARRIER_ROLE).toBe(keccak256(toBytes("CARRIER_ROLE")));
  });
  it("matches the contract's Roles.DISPUTE_ROLE", async () => {
    const { DISPUTE_ROLE } = await import("./roles");
    expect(DISPUTE_ROLE).toBe("0xc785f0e55c16138ca0f8448186fa6229be092a3a83db3c5d63c9286723c5a2c4");
  });
});
