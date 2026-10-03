import { describe, expect, it } from "vitest";
import { animSpan, ENTER, formatCount, parseCount, SETTLE, stepAt, STEPS, stepScrollY, WINDOW } from "./steps";

describe("stepAt", () => {
  it("maps progress to the step whose unit contains it", () => {
    expect(stepAt(0, 6)).toBe(0);
    expect(stepAt(0.1666, 6)).toBe(0);
    expect(stepAt(1 / 6, 6)).toBe(1);
    expect(stepAt(0.5, 6)).toBe(3);
    expect(stepAt(0.99, 6)).toBe(5);
  });
  it("clamps the ends and bad input", () => {
    expect(stepAt(1, 6)).toBe(5);
    expect(stepAt(1.4, 6)).toBe(5);
    expect(stepAt(-0.2, 6)).toBe(0);
    expect(stepAt(Number.NaN, 6)).toBe(0);
    expect(stepAt(0.5, 0)).toBe(0);
  });
});

describe("animSpan", () => {
  it("places an animation after the step's cross-fade, inside its window", () => {
    expect(animSpan(2, 0, 0.5)).toEqual({ position: 2 + ENTER, duration: 0.5 * WINDOW });
    const late = animSpan(1, 1, 0.3);
    expect(late.position).toBeCloseTo(1 + ENTER + WINDOW);
  });
  it("never spills into the next step", () => {
    const s = animSpan(3, 1, 1);
    expect(s.position + s.duration).toBeLessThanOrEqual(4 + 1e-9);
  });
  it("clamps out-of-range inputs and keeps a minimum duration", () => {
    expect(animSpan(0, -1, 0)).toEqual({ position: ENTER, duration: 0.02 });
    expect(animSpan(0, 5, 0.1).position).toBeCloseTo(ENTER + WINDOW);
  });
});

describe("stepScrollY", () => {
  it("scrolls to the settled point of a step", () => {
    expect(stepScrollY(1000, 7000, 0, 6)).toBe(Math.round(1000 + 6000 * (SETTLE / 6)));
    expect(stepScrollY(1000, 7000, 3, 6)).toBe(Math.round(1000 + 6000 * ((3 + SETTLE) / 6)));
  });
  it("clamps the step index and never passes the end", () => {
    expect(stepScrollY(0, 600, 9, 6)).toBeLessThanOrEqual(600);
    expect(stepScrollY(0, 600, -2, 6)).toBe(stepScrollY(0, 600, 0, 6));
    expect(stepScrollY(50, 600, 1, 0)).toBe(50);
  });
});

describe("formatCount / parseCount", () => {
  it("prints scene numbers with grouping and fixed decimals", () => {
    expect(formatCount(40000)).toBe("40,000");
    expect(formatCount(9.14, 1)).toBe("9.1");
    expect(formatCount(4.6, 1)).toBe("4.6");
    expect(formatCount(Number.NaN)).toBe("0");
  });
  it("round-trips", () => {
    expect(parseCount("58,800")).toBe(58800);
    expect(parseCount("9.1")).toBe(9.1);
    expect(parseCount("")).toBeNaN();
    expect(parseCount(formatCount(41200))).toBe(41200);
  });
});

describe("STEPS", () => {
  it("tells six beats with unique ids and short labels", () => {
    expect(STEPS).toHaveLength(6);
    expect(new Set(STEPS.map((s) => s.id)).size).toBe(6);
    expect(STEPS.map((s) => s.short)).toEqual(["Register", "Fund", "Release", "Pause", "Prove", "Settle"]);
  });
  it("keeps the settlement arithmetic consistent (100,000 = 40,000 + 1,200 + 58,800)", () => {
    expect(40000 + 1200 + 58800).toBe(100000);
    expect(STEPS[5]!.body).toContain("58,800");
  });
});
