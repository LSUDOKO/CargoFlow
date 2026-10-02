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

/**
 * Resolves what someone typed into a shipment id. A 0x id is used as is; anything else is looked up as an
 * external reference by `lookup` (the backend's `?ref=` filter), so references beyond the newest page resolve.
 */
export async function resolveShipment(q: string, lookup: (ref: string) => Promise<{ id: string }[]>): Promise<Resolved> {
  const t = q.trim();
  if (!t) return { kind: "none" };
  const lower = t.toLowerCase();
  if (ID.test(lower)) return { kind: "id", id: lower };
  const hits = await lookup(t);
  return hits[0] ? { kind: "ref", id: hits[0].id.toLowerCase() } : { kind: "none" };
}
