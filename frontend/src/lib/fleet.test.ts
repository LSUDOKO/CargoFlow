import { describe, expect, it } from "vitest";
import { filterFleet, tabCounts, type FleetRow } from "./fleet";

const row = (id: string, ref: string, status: string, drawn: string, created: string, extra: Partial<FleetRow> = {}): FleetRow => ({
  id, ref, status, drawn, committed: "40000000000", score: undefined, created, exporter: "0xaa", financier: "0xbb", buyer: "0xcc", ...extra,
});
const rows: FleetRow[] = [
  row("0x01", "CF-A", "ACTIVE", "8000000000", "2026-10-01T01:00:00Z", { score: 98 }),
  row("0x02", "CF-B", "PAUSED", "16000000000", "2026-10-01T02:00:00Z", { score: 48 }),
  row("0x03", "CF-C", "SETTLED", "40000000000", "2026-10-01T03:00:00Z", { score: 100, financier: "0xdd" }),
  row("0x04", "CF-D", "REGISTERED", "0", "2026-10-01T04:00:00Z"),
];
const base = { tab: "all" as const, q: "", sort: "created" as const, dir: "desc" as const };

describe("filterFleet", () => {
  it("puts each status in the right tab", () => {
    expect(filterFleet(rows, { ...base, tab: "active" }).map((r) => r.ref)).toEqual(["CF-D", "CF-A"]);
    expect(filterFleet(rows, { ...base, tab: "paused" }).map((r) => r.ref)).toEqual(["CF-B"]);
    expect(filterFleet(rows, { ...base, tab: "settled" }).map((r) => r.ref)).toEqual(["CF-C"]);
    expect(tabCounts(rows)).toEqual({ active: 2, paused: 1, settled: 1, all: 4 });
  });
  it("searches references and id prefixes", () => {
    expect(filterFleet(rows, { ...base, q: "cf-b" }).map((r) => r.ref)).toEqual(["CF-B"]);
    expect(filterFleet(rows, { ...base, q: "0x03" }).map((r) => r.ref)).toEqual(["CF-C"]);
  });
  it("sorts drawn amounts numerically, not as strings", () => {
    expect(filterFleet(rows, { ...base, sort: "drawn", dir: "desc" }).map((r) => r.ref)).toEqual(["CF-C", "CF-B", "CF-A", "CF-D"]);
  });
  it("sorts by score with unknown scores last", () => {
    expect(filterFleet(rows, { ...base, sort: "score", dir: "desc" }).map((r) => r.ref)).toEqual(["CF-C", "CF-A", "CF-B", "CF-D"]);
  });
  it("keeps only the wallet's own shipments when asked", () => {
    expect(filterFleet(rows, { ...base, mine: "0xDD" }).map((r) => r.ref)).toEqual(["CF-C"]);
  });
});
