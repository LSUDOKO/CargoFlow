export type FleetRow = {
  id: string;
  ref: string;
  status: string; // facility status when a facility exists, otherwise the shipment status
  drawn: string;
  committed: string;
  score: number | undefined; // latest evidence score
  created: string;
  exporter: string;
  financier: string;
  buyer: string;
};

export type FleetTab = "active" | "paused" | "settled" | "all";
export type FleetSort = "created" | "score" | "drawn" | "status";
export type FleetFilter = { tab: FleetTab; q: string; sort: FleetSort; dir: "asc" | "desc"; mine?: string };

const tabOf = (status: string): Exclude<FleetTab, "all"> => {
  if (status === "PAUSED" || status === "DISPUTED") return "paused";
  // the "Settled" tab holds every closed facility: settled, delivered, defaulted and cancelled (contracts v3)
  if (status === "SETTLED" || status === "DELIVERED" || status === "DEFAULTED" || status === "CANCELLED") return "settled";
  return "active";
};

export function tabCounts(rows: FleetRow[]): Record<FleetTab, number> {
  const c = { active: 0, paused: 0, settled: 0, all: rows.length };
  for (const r of rows) c[tabOf(r.status)]++;
  return c;
}

/** Filters and sorts the fleet. Pure, so the table and its tests share one definition. */
export function filterFleet(rows: FleetRow[], f: FleetFilter): FleetRow[] {
  const q = f.q.trim().toLowerCase();
  const mine = f.mine?.toLowerCase();
  const out = rows.filter(
    (r) =>
      (f.tab === "all" || tabOf(r.status) === f.tab) &&
      (!q || r.ref.toLowerCase().includes(q) || r.id.toLowerCase().startsWith(q)) &&
      (!mine || [r.exporter, r.financier, r.buyer].some((a) => a.toLowerCase() === mine)),
  );
  const sign = f.dir === "asc" ? 1 : -1;
  const cmp = (a: FleetRow, b: FleetRow): number => {
    switch (f.sort) {
      case "drawn": {
        const x = BigInt(a.drawn || "0"), y = BigInt(b.drawn || "0");
        return x === y ? 0 : x < y ? -1 : 1;
      }
      case "score":
        if (a.score === undefined && b.score === undefined) return 0;
        if (a.score === undefined) return f.dir === "asc" ? 1 : -1; // unknown last either way
        if (b.score === undefined) return f.dir === "asc" ? -1 : 1;
        return a.score - b.score;
      case "status":
        return a.status.localeCompare(b.status);
      default:
        return a.created.localeCompare(b.created);
    }
  };
  return out.sort((a, b) => sign * cmp(a, b) || b.created.localeCompare(a.created));
}
