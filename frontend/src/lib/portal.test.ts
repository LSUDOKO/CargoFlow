import { describe, expect, it } from "vitest";
import { fundingNeeds } from "./portal";

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
