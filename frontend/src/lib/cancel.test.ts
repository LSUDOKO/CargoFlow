import { describe, expect, it } from "vitest";
import { cancelState, countdownText, DEFAULT_CANCEL_TIMEOUT_SEC } from "./cancel";

const EXP = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const FIN = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const BUYER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const base = { exporter: EXP, financier: FIN, financedAt: 0, nowSec: 2_000_000 };

describe("cancelState", () => {
  it("lets the exporter or the financier cancel a CREATED facility at any time, with nothing to refund", () => {
    expect(cancelState({ ...base, status: "CREATED", address: EXP })).toEqual({ kind: "ready", refundsDeposit: false });
    expect(cancelState({ ...base, status: "CREATED", address: FIN.toLowerCase() })).toEqual({ kind: "ready", refundsDeposit: false });
  });
  it("hides it from anyone else and once transit started", () => {
    expect(cancelState({ ...base, status: "CREATED", address: BUYER })).toEqual({ kind: "hidden" });
    expect(cancelState({ ...base, status: "CREATED", address: undefined })).toEqual({ kind: "hidden" });
    for (const status of ["ACTIVE", "PAUSED", "DISPUTED", "DELIVERED", "SETTLED", "DEFAULTED", "CANCELLED", undefined]) {
      expect(cancelState({ ...base, status, address: EXP })).toEqual({ kind: "hidden" });
    }
  });
  it("makes a FINANCED facility wait CANCEL_TIMEOUT after the deposit", () => {
    const financedAt = 1_000_000;
    const timeoutSec = 14 * 86_400;
    expect(cancelState({ ...base, status: "FINANCED", address: FIN, financedAt, timeoutSec, nowSec: financedAt + 3_600 })).toEqual({ kind: "waiting", remainingSec: timeoutSec - 3_600, availableAt: financedAt + timeoutSec });
    expect(cancelState({ ...base, status: "FINANCED", address: EXP, financedAt: BigInt(financedAt), timeoutSec: BigInt(timeoutSec), nowSec: financedAt + timeoutSec })).toEqual({ kind: "ready", refundsDeposit: true });
  });
  it("falls back to the contract's 14 days and offers it when the deposit time is unknown", () => {
    expect(DEFAULT_CANCEL_TIMEOUT_SEC).toBe(1_209_600);
    expect(cancelState({ ...base, status: "FINANCED", address: EXP, financedAt: 100, nowSec: 100 })).toMatchObject({ kind: "waiting", remainingSec: 1_209_600 });
    expect(cancelState({ ...base, status: "FINANCED", address: EXP, financedAt: undefined })).toEqual({ kind: "ready", refundsDeposit: true });
  });
});

describe("countdownText", () => {
  it("reads in the largest two units", () => {
    expect(countdownText(30)).toBe("under a minute");
    expect(countdownText(42 * 60)).toBe("42 min");
    expect(countdownText(5 * 3600 + 12 * 60)).toBe("5 h 12 min");
    expect(countdownText(3 * 3600)).toBe("3 h");
    expect(countdownText(13 * 86_400 + 4 * 3600 + 59)).toBe("13 d 4 h");
    expect(countdownText(2 * 86_400)).toBe("2 d");
  });
});
