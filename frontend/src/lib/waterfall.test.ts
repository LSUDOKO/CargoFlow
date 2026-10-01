import { describe, expect, it } from "vitest";
import { waterfall } from "./waterfall";

describe("waterfall", () => {
  it("splits the hero invoice exactly as the vault does", () => {
    expect(waterfall("40000000000", "100000000000", 300)).toEqual({
      principal: 40000000000n, fee: 1200000000n, undrawn: 0n, financier: 41200000000n, residual: 58800000000n,
    });
  });
  it("returns undrawn capital to the financier and charges the fee only on what was drawn", () => {
    const w = waterfall("16000000000", "100000000000", 300, "40000000000");
    expect(w.fee).toBe(480000000n);
    expect(w.undrawn).toBe(24000000000n);
    expect(w.financier).toBe(16000000000n + 480000000n + 24000000000n);
    expect(w.residual).toBe(100000000000n - 16000000000n - 480000000n);
  });
  it("matches the 1/2000 public testnet run", () => {
    const w = waterfall("20000000", "50000000", 300);
    expect(w.residual).toBe(29400000n);
    expect(w.fee).toBe(600000n);
  });
});
