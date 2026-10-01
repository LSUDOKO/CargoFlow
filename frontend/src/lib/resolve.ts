export type Resolved = { kind: "id"; id: string } | { kind: "ref"; id: string } | { kind: "none" };

const ID = /^0x[0-9a-f]{64}$/;

/** Turns what someone typed into a search box into a shipment id: a 0x id, or an external reference. */
export function resolveShipmentQuery(q: string, list: { id: string; externalRef: string }[]): Resolved {
  const t = q.trim();
  if (!t) return { kind: "none" };
  const lower = t.toLowerCase();
  if (ID.test(lower)) return { kind: "id", id: lower };
  const hit = list.find((s) => s.externalRef.toLowerCase() === lower);
  return hit ? { kind: "ref", id: hit.id.toLowerCase() } : { kind: "none" };
}
