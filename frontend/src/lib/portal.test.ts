import { describe, expect, it } from "vitest";
import { fundingNeeds, settlementPreview } from "./portal";

describe("fundingNeeds", () => {
  it("reports the shortfall when the balance is too low", () => {
    expect(fundingNeeds(10n, 0n, 40n)).toEqual({ shortfall: 30n, needsApproval: true, ready: false });
  });
  it("asks for approval when the allowance is too low", () => {
    expect(fundingNeeds(40n, 39n, 40n)).toEqual({ shortfall: 0n, needsApproval: true, ready: false });
  });
  it("is ready only with enough balance and allowance", () => {
    expect(fundingNeeds(50n, 40n, 40n)).toEqual({ shortfall: 0n, needsApproval: false, ready: true });
  });
  it("treats unknown reads as not ready", () => {
    expect(fundingNeeds(undefined, undefined, 40n).ready).toBe(false);
  });
});

describe("settlementPreview", () => {
  it("previews the 1/2000 public testnet settlement from a facility view", () => {
    const p = settlementPreview({ committed: "20000000", drawn: "20000000", feeBps: 300 }, "50000000");
    expect(p).toEqual({ principal: 20000000n, fee: 600000n, undrawn: 0n, financier: 20600000n, residual: 29400000n });
  });
  it("returns undrawn capital to the financier when a facility settles early", () => {
    expect(settlementPreview({ committed: "40", drawn: "16", feeBps: 0 }, "100").undrawn).toBe(24n);
  });
});
