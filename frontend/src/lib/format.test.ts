import { describe, expect, it } from "vitest";
import { formatBps, formatTempX100, formatUSDG, shortHash } from "./format";

describe("formatUSDG", () => {
  it("formats base units with grouping and trims trailing zeros", () => {
    expect(formatUSDG("40000000000")).toBe("40,000");
    expect(formatUSDG("49400000")).toBe("49.4");
    expect(formatUSDG(1n)).toBe("0.000001");
    expect(formatUSDG("0")).toBe("0");
    expect(formatUSDG("")).toBe("0");
  });
  it("compacts large values on request", () => {
    expect(formatUSDG("98800000000", { compact: true })).toBe("98.8K");
    expect(formatUSDG("1250000000000", { compact: true })).toBe("1.2M");
    expect(formatUSDG("999000000", { compact: true })).toBe("999");
  });
  it("never loses precision on huge values", () => {
    expect(formatUSDG("123456789012345678")).toBe("123,456,789,012.345678");
  });
  it("formats negatives", () => {
    expect(formatUSDG("-1500000")).toBe("-1.5");
  });
});

describe("small formatters", () => {
  it("formats bps, temperatures and hashes", () => {
    expect(formatBps(7800)).toBe("78.0%");
    expect(formatTempX100(1170)).toBe("11.7 °C");
    expect(formatTempX100(-450)).toBe("-4.5 °C");
    expect(shortHash("0x20e25734defd7372261a73ff6e78fff990047bb6545d7eebe768fcfca1a84487")).toBe("0x20e257…4487");
    expect(shortHash("0x1234")).toBe("0x1234");
  });
});
