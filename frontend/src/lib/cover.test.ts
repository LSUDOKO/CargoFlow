import { describe, expect, it } from "vitest";
import type { Cover, CoverOffer } from "./api/schemas";
import { claimSplit, coverActions, coverOpen, coverSummary, findTrigger, parametricSplit, premiumOf, validateOffer, validateParametric } from "./cover";

const FIN = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const INS = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const offer = (insurer = INS, amount = "20000000000", premiumBps = 200): CoverOffer => ({ insurer, amount, premiumBps, createdAt: "", parametric: null });
const cover = (status: string): Cover => ({ insurer: INS, financier: FIN, amount: "20000000000", premium: "400000000", status, financierPayout: "16000000000", insurerReturn: "4000000000", parametric: null });

describe("amounts", () => {
  it("rounds the premium down like the contract", () => {
    expect(premiumOf(20_000_000_000n, 200)).toBe(400_000_000n);
    expect(premiumOf("333", 2000)).toBe(66n);
    expect(premiumOf("1000", 0)).toBe(0n);
  });
  it("pays the financier min(cover, drawn) on a claim and returns the rest", () => {
    expect(claimSplit(20_000_000_000n, 16_000_000_000n)).toEqual({ payout: 16_000_000_000n, remainder: 4_000_000_000n });
    expect(claimSplit("20000000000", "40000000000")).toEqual({ payout: 20_000_000_000n, remainder: 0n });
    expect(claimSplit("20000000000", "0")).toEqual({ payout: 0n, remainder: 20_000_000_000n });
  });
});

describe("validateOffer", () => {
  const committed = "40000000000";
  it("accepts cover up to the commitment with a premium up to 20%", () => {
    expect(validateOffer({ amount: "40,000", premiumPct: "20" }, committed)).toEqual({ errors: {}, amount: 40_000_000_000n, premiumBps: 2000 });
    expect(validateOffer({ amount: "0.5", premiumPct: "1.25" }, committed)).toMatchObject({ amount: 500_000n, premiumBps: 125 });
  });
  it("names every problem", () => {
    expect(Object.keys(validateOffer({ amount: "40001", premiumPct: "20.5" }, committed).errors).sort()).toEqual(["amount", "premiumPct"]);
    expect(validateOffer({ amount: "0", premiumPct: "2" }, committed).errors.amount).toBeDefined();
    expect(validateOffer({ amount: "abc", premiumPct: "" }, committed).errors).toMatchObject({ amount: expect.any(String), premiumPct: expect.any(String) });
    expect(validateOffer({ amount: "10", premiumPct: "1.234" }, committed).errors.premiumPct).toBeDefined();
  });
});

describe("coverActions", () => {
  const base = { status: "FINANCED", financier: FIN, cover: null, offers: [offer()], address: INS };
  it("lets an insurer offer before transit, once, and never the financier", () => {
    expect(coverActions({ ...base, offers: [] }).offer).toBe(true);
    expect(coverActions(base)).toMatchObject({ offer: false, myOffer: offer() });
    expect(coverActions({ ...base, address: FIN }).offerBlocked).toMatch(/cannot insure/);
    expect(coverActions({ ...base, status: "ACTIVE", offers: [] }).offer).toBe(false);
    expect(coverActions({ ...base, address: undefined }).offer).toBe(false);
  });
  it("lets only the financier accept, only before transit and only while no cover is accepted", () => {
    expect(coverActions({ ...base, address: FIN.toLowerCase() }).accept).toBe(true);
    expect(coverActions({ ...base, address: FIN, status: "ACTIVE" }).accept).toBe(false);
    expect(coverActions({ ...base, address: FIN, cover: cover("ACTIVE") }).accept).toBe(false);
    expect(coverActions(base).accept).toBe(false);
  });
  it("lets anyone release after settlement and claim after default, once", () => {
    expect(coverActions({ ...base, status: "SETTLED", cover: cover("ACTIVE"), address: undefined })).toMatchObject({ release: true, claim: false });
    expect(coverActions({ ...base, status: "DEFAULTED", cover: cover("ACTIVE") })).toMatchObject({ release: false, claim: true });
    expect(coverActions({ ...base, status: "DEFAULTED", cover: cover("CLAIMED") }).claim).toBe(false);
    expect(coverActions({ ...base, status: "ACTIVE", cover: cover("ACTIVE") })).toMatchObject({ release: false, claim: false });
  });
  it("knows when cover is open", () => {
    expect(["CREATED", "FINANCED", "ACTIVE", undefined].map(coverOpen)).toEqual([true, true, false, false]);
  });
});

describe("coverSummary", () => {
  const short = (a: string) => a.slice(0, 6);
  it("says where the cover stands in one sentence", () => {
    expect(coverSummary(cover("ACTIVE"), 0, "ACTIVE", short)).toBe("Covered: 20,000 USDG escrowed by 0x15d3, who was paid a 400 USDG premium.");
    expect(coverSummary(cover("CLAIMED"), 0, "DEFAULTED", short)).toMatch(/paid the financier 16,000 USDG.*4,000 USDG went back/);
    expect(coverSummary(cover("RELEASED"), 0, "SETTLED", short)).toMatch(/went back to the insurer/);
    expect(coverSummary(null, 2, "FINANCED", short)).toBe("2 cover offers are waiting for the financier.");
    expect(coverSummary(null, 0, "CREATED", short)).toMatch(/Not covered yet/);
    expect(coverSummary(null, 0, "ACTIVE", short)).toBe("No default cover was taken out.");
  });
});

describe("parametric cover", () => {
  const ep = (ordinal: number, compliant: boolean) => ({ epochId: `0x${ordinal.toString(16).padStart(64, "0")}`, ordinal, compliant });
  it("finds N consecutive failing epochs after the floor, latest window first", () => {
    const list = [ep(1, false), ep(2, true), ep(3, false), ep(4, false), ep(5, false), ep(6, false)];
    const t = findTrigger(list, 3, 0);
    expect(t.met).toBe(true);
    expect(t.epochIds).toEqual([ep(4, false).epochId, ep(5, false).epochId, ep(6, false).epochId]);
    expect(t.streak).toBe(4);
  });
  it("ignores epochs at or below the floor (committed before acceptance)", () => {
    const list = [ep(1, false), ep(2, false), ep(3, false), ep(4, false)];
    expect(findTrigger(list, 3, 2)).toMatchObject({ met: false, streak: 2 });
    expect(findTrigger(list, 2, 2)).toMatchObject({ met: true, epochIds: [ep(3, false).epochId, ep(4, false).epochId] });
  });
  it("breaks a run on a compliant epoch or a gap in the ordinals, in any input order", () => {
    expect(findTrigger([ep(3, false), ep(1, false), ep(2, true)], 2, 0)).toMatchObject({ met: false, streak: 1 });
    expect(findTrigger([ep(1, false), ep(3, false), ep(4, false)], 3, 0).met).toBe(false);
    expect(findTrigger([ep(4, false), ep(1, false), ep(3, false), ep(2, false)], 4, 0).met).toBe(true);
    expect(findTrigger([ep(1, false), ep(2, false), ep(3, true)], 2, 0)).toMatchObject({ met: true, streak: 0 });
    expect(findTrigger([], 1, 0)).toEqual({ met: false, epochIds: [], streak: 0, needed: 1 });
    expect(findTrigger([ep(0, false)], 1, 0).met).toBe(false); // unknown ordinal
  });
  it("splits a trigger: financier min(cover, drawn), exporter min(salvage, rest), insurer the remainder", () => {
    expect(parametricSplit(20_000n, 12_000n, 5_000n)).toEqual({ financier: 12_000n, exporter: 5_000n, insurer: 3_000n });
    expect(parametricSplit("20000", "18000", "5000")).toEqual({ financier: 18_000n, exporter: 2_000n, insurer: 0n });
    expect(parametricSplit(20_000n, 30_000n, 5_000n)).toEqual({ financier: 20_000n, exporter: 0n, insurer: 0n });
    expect(parametricSplit(20_000n, 0n, 0n)).toEqual({ financier: 0n, exporter: 0n, insurer: 20_000n });
  });
  it("validates the terms: 1 to 32 batches, salvage at most the cover", () => {
    expect(validateParametric({ epochs: "3", salvage: "1,000" }, 20_000_000_000n)).toEqual({ errors: {}, epochs: 3, salvage: 1_000_000_000n });
    expect(validateParametric({ epochs: "32", salvage: "" }, undefined)).toEqual({ errors: {}, epochs: 32, salvage: 0n });
    expect(Object.keys(validateParametric({ epochs: "33", salvage: "20001" }, 20_000_000_000n).errors).sort()).toEqual(["epochs", "salvage"]);
    expect(validateParametric({ epochs: "1.5", salvage: "0" }, 1n).errors.epochs).toBeDefined();
    expect(validateParametric({ epochs: "0", salvage: "abc" }, 1n).errors).toMatchObject({ epochs: expect.any(String), salvage: expect.any(String) });
  });
  it("returns the cover to the insurer after a cancellation and words a trigger", () => {
    const acts = coverActions({ status: "CANCELLED", financier: FIN, cover: cover("ACTIVE"), offers: [], address: undefined });
    expect(acts.release).toBe(true);
    const trig = { ...cover("TRIGGERED"), parametric: { consecutiveFailedEpochs: 3, salvageToExporter: "5000000000", epochFloor: 2, exporterSalvage: "4000000000" } };
    expect(coverSummary(trig, 0, "PAUSED", (a) => a)).toContain("4,000 USDG salvage");
  });
});
