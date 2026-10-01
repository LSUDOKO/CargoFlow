import { describe, expect, it } from "vitest";
import { resolveShipmentQuery } from "./resolve";

const id = "0x" + "ab".repeat(32);
const list = [{ id, externalRef: "CF-2026-SG01-1790857906019" }];

describe("resolveShipmentQuery", () => {
  it("accepts a shipment id directly, normalised to lowercase", () => {
    expect(resolveShipmentQuery(` ${id.toUpperCase().replace("0X", "0x")} `, [])).toEqual({ kind: "id", id });
  });
  it("matches an external reference case-insensitively", () => {
    expect(resolveShipmentQuery("cf-2026-sg01-1790857906019", list)).toEqual({ kind: "ref", id });
  });
  it("reports nothing for unknown or empty input", () => {
    expect(resolveShipmentQuery("CF-UNKNOWN", list)).toEqual({ kind: "none" });
    expect(resolveShipmentQuery("   ", list)).toEqual({ kind: "none" });
    expect(resolveShipmentQuery("0x1234", list)).toEqual({ kind: "none" });
  });
});
