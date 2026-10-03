import { keccak256, toBytes, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { billActions, bindableReason, documentMatches, EBL_STATUS_LABEL, eblStatus, hashFile, isToOrder, parseTokenId, validateIssue } from "./ebl";

const CARRIER = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
const EXP = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BUYER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const CTRL = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const DOC = keccak256(toBytes("bill"));

describe("eblStatus", () => {
  it("maps the chain's enum numbers and the backend's words", () => {
    expect([0, 1, 2, 3].map((n) => eblStatus(n))).toEqual(["NONE", "ISSUED", "SURRENDERED", "VOID"]);
    expect(eblStatus(2n)).toBe("SURRENDERED");
    expect(eblStatus("1")).toBe("ISSUED");
    expect(eblStatus("issued")).toBe("ISSUED");
    expect(eblStatus("VOIDED")).toBe("VOID");
    expect(eblStatus("nonsense")).toBe("NONE");
    expect(eblStatus(9)).toBe("NONE");
    expect(eblStatus(undefined)).toBe("NONE");
    expect(EBL_STATUS_LABEL.ISSUED).toBe("Live");
  });
});

describe("billActions", () => {
  const bill = { status: "ISSUED" as const, holder: EXP, issuer: CARRIER };
  it("lets the holder of a live bill endorse or surrender it", () => {
    expect(billActions(bill, EXP.toLowerCase(), CTRL)).toEqual({ transfer: true, surrender: true, void: false, escrowed: false });
    expect(billActions(bill, BUYER, CTRL)).toEqual({ transfer: false, surrender: false, void: false, escrowed: false });
  });
  it("lets the issuer void a live bill it holds, not surrender it to itself", () => {
    expect(billActions({ ...bill, holder: CARRIER }, CARRIER, CTRL)).toEqual({ transfer: true, surrender: false, void: true, escrowed: false });
  });
  it("freezes surrendered, void and escrowed bills", () => {
    expect(billActions({ ...bill, status: "SURRENDERED", holder: CARRIER }, CARRIER, CTRL)).toEqual({ transfer: false, surrender: false, void: false, escrowed: false });
    expect(billActions({ ...bill, status: "VOID" }, EXP, CTRL).transfer).toBe(false);
    expect(billActions({ ...bill, holder: CTRL }, EXP, CTRL)).toEqual({ transfer: false, surrender: false, void: false, escrowed: true });
  });
});

describe("bindableReason", () => {
  const bill = { status: "ISSUED" as const, holder: EXP, consignee: BUYER };
  it("mirrors bindTitle: live, held by the exporter, consigned to the buyer or to order", () => {
    expect(bindableReason(bill, EXP, BUYER)).toBeNull();
    expect(bindableReason({ ...bill, consignee: zeroAddress }, EXP, BUYER)).toBeNull();
    expect(bindableReason({ ...bill, consignee: CARRIER }, EXP, BUYER)).toMatch(/consignee/);
    expect(bindableReason({ ...bill, holder: BUYER }, EXP, BUYER)).toMatch(/hold/);
    expect(bindableReason({ ...bill, status: "SURRENDERED" }, EXP, BUYER)).toMatch(/live/);
  });
});

describe("validateIssue", () => {
  it("returns issue() arguments, with the zero address for a to-order bill", () => {
    expect(validateIssue({ documentHash: DOC, shipper: ` ${EXP} `, consignee: "", toOrder: true }).args).toEqual([DOC, EXP, zeroAddress]);
    expect(validateIssue({ documentHash: DOC, shipper: EXP, consignee: BUYER, toOrder: false }).args).toEqual([DOC, EXP, BUYER]);
  });
  it("names every problem", () => {
    expect(Object.keys(validateIssue({ documentHash: "", shipper: "nope", consignee: "", toOrder: false }).errors).sort()).toEqual(["consignee", "documentHash", "shipper"]);
    expect(validateIssue({ documentHash: `0x${"0".repeat(64)}`, shipper: zeroAddress, consignee: "", toOrder: true }).errors).toMatchObject({ documentHash: expect.any(String), shipper: expect.any(String) });
  });
});

describe("documents and numbers", () => {
  it("hashes a file's bytes with keccak256 and compares case-insensitively", async () => {
    // jsdom's Blob has no arrayBuffer(); browsers do, so a minimal stand-in is enough here
    const bytes = new TextEncoder().encode("bill");
    const h = await hashFile({ arrayBuffer: async () => bytes.buffer } as unknown as Blob);
    expect(h).toBe(DOC);
    expect(documentMatches(h.toUpperCase().replace("0X", "0x"), DOC)).toBe(true);
    expect(documentMatches(keccak256(toBytes("bill ")), DOC)).toBe(false);
  });
  it("parses bill numbers", () => {
    expect(parseTokenId("12")).toBe(12n);
    expect(parseTokenId(" #7 ")).toBe(7n);
    expect(parseTokenId("0")).toBeNull();
    expect(parseTokenId("-1")).toBeNull();
    expect(parseTokenId("abc")).toBeNull();
  });
  it("treats the zero consignee as to order", () => {
    expect(isToOrder(zeroAddress)).toBe(true);
    expect(isToOrder("")).toBe(true);
    expect(isToOrder(BUYER)).toBe(false);
  });
});
