// Place-based milestones (contracts v2). A milestone with a place releases only on evidence whose centroid lies
// within `radiusM` of (latE6, lonE6); radiusM 0 means "anywhere" (v1 behaviour). Evidence that passes the policy but
// comes from outside the place is not a failure: the milestone simply waits ("held"). Pure helpers for the wizard,
// the dashboard and the map.

import { nearestPort } from "./geo/ports";

type LatLon = { latE6: number; lonE6: number };
const EARTH_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres between two points in degrees x 1e6. */
export function haversineM(a: LatLon, b: LatLon): number {
  const la1 = rad(a.latE6 / 1e6), la2 = rad(b.latE6 / 1e6);
  const dLa = la2 - la1, dLo = rad((b.lonE6 - a.lonE6) / 1e6);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "1.3° N, 103.8° E" */
export function coordText(p: LatLon): string {
  const lat = p.latE6 / 1e6, lon = p.lonE6 / 1e6;
  return `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? "E" : "W"}`;
}

/** The decision the backend records for evidence that passed but came from outside the milestone's place. */
export const HELD = "HELD_NOT_AT_PLACE";

export const MIN_RADIUS_KM = 1;
export const MAX_RADIUS_KM = 1000;
/** The wizard's one-click option: the last tranche releases only near the port of discharge. */
export const DESTINATION_RADIUS_KM = 100;
export const PLACE_LABEL_MAX = 64;
// the backend's rule for place labels (service.cleanPlaceLabels): letters, digits, spaces and .,'()/-
const LABEL_RE = /^[\p{L}\p{N} .,'()/-]*$/u;

/** A place being edited in the wizard: a centre, a radius in km (text, as typed) and an optional display label. */
export type PlaceDraft = { lat: number; lon: number; radiusKm: string; label: string; source: string };
/** The on-chain part of a milestone's place (IFinancingController.MilestoneSpec). */
export type PlaceSpec = { latE6: number; lonE6: number; radiusM: number };
/** Anything that carries a place: a milestone from the API, a MilestoneSpec, a hold. */
export type Placed = { latE6: number; lonE6: number; radiusM: number; placeLabel?: string };

export const NO_PLACE: PlaceSpec = { latE6: 0, lonE6: 0, radiusM: 0 };

/** Longitude folded into [-180, 180). */
export const normLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Keeps only the characters a place label may hold, trimmed to the maximum length (for port names). */
export const cleanLabel = (s: string) => [...s.replace(/[^\p{L}\p{N} .,'()/-]/gu, " ").replace(/\s+/g, " ").trim()].slice(0, PLACE_LABEL_MAX).join("");

export function placeLabelError(label: string): string | null {
  const t = label.trim();
  if ([...t].length > PLACE_LABEL_MAX) return `Keep the name to ${PLACE_LABEL_MAX} characters.`;
  if (!LABEL_RE.test(t)) return "Use letters, digits, spaces and . , ' ( ) / - only.";
  return null;
}

export function radiusError(km: string): string | null {
  const t = km.trim();
  const v = t === "" ? NaN : Number(t);
  if (!Number.isFinite(v) || v < MIN_RADIUS_KM || v > MAX_RADIUS_KM) return `Use a radius from ${MIN_RADIUS_KM} to ${MAX_RADIUS_KM.toLocaleString("en-US")} km.`;
  if (Math.round(v * 1000) !== v * 1000) return "Use at most three decimals (whole metres).";
  return null;
}

/** Field-keyed errors for one place; empty when valid. */
export function placeErrors(p: PlaceDraft): { radius?: string; label?: string; centre?: string } {
  const e: { radius?: string; label?: string; centre?: string } = {};
  const r = radiusError(p.radiusKm);
  if (r) e.radius = r;
  const l = placeLabelError(p.label);
  if (l) e.label = l;
  if (!Number.isFinite(p.lat) || Math.abs(p.lat) > 90 || !Number.isFinite(p.lon) || Math.abs(p.lon) > 180) e.centre = "Pick a valid place on the map.";
  return e;
}

/** The on-chain place for a draft, or no place. */
export function toPlaceSpec(p: PlaceDraft | null | undefined): PlaceSpec {
  if (!p) return NO_PLACE;
  return { latE6: Math.round(p.lat * 1e6), lonE6: Math.round(normLon(p.lon) * 1e6), radiusM: Math.round(Number(p.radiusKm) * 1000) };
}

/** Labels by milestone index for the mirror request ("" for none), trailing empties dropped; [] when there are none. */
export function placeLabelsFor(places: (PlaceDraft | null | undefined)[], count: number): string[] {
  const out = Array.from({ length: count }, (_, i) => (places[i] ? places[i]!.label.trim() : ""));
  while (out.length && out.at(-1) === "") out.pop();
  return out;
}

/** "100 km", "2.5 km". */
export function radiusText(radiusM: number): string {
  const km = radiusM / 1000;
  return `${km >= 10 ? Math.round(km).toLocaleString("en-US") : Number(km.toFixed(1)).toLocaleString("en-US")} km`;
}

/** "412 km" (whole km from 10 km up), "3.4 km", "800 m". */
export function distanceText(m: number): string {
  if (m < 1000) return `${Math.max(0, Math.round(m))} m`;
  const km = m / 1000;
  return `${km >= 10 ? Math.round(km).toLocaleString("en-US") : km.toFixed(1)} km`;
}

/** A place's name: its label, else a known port at its centre, else its coordinates. */
export function placeName(p: Placed): string {
  if (p.placeLabel?.trim()) return p.placeLabel.trim();
  const lat = p.latE6 / 1e6, lon = p.lonE6 / 1e6;
  return nearestPort(lat, lon, 25)?.name ?? coordText(p);
}

export const hasPlace = (p: Partial<Placed> | null | undefined): p is Placed => !!p && (p.radiusM ?? 0) > 0;

/** "within 100 km of Singapore" */
export const placePhrase = (p: Placed) => `within ${radiusText(p.radiusM)} of ${placeName(p)}`;

/** Great-circle distance in metres from a position to a place's centre. */
export const distanceToPlaceM = (p: Placed, pos: { latE6: number; lonE6: number }) => haversineM(p, pos);

export type PlaceMilestoneState = "released" | "next" | "blocked" | "pending";
export type PlaceStatus = { text: string; tone: "done" | "held" | "inside" | "info" };

/**
 * One line about a milestone's place, for the journey strip and the timeline:
 * "Released inside 100 km of Singapore", "Waiting until within 100 km of Singapore, 412 km away", ...
 */
export function placeStatus(p: Placed | null | undefined, state: PlaceMilestoneState, distanceM: number | null): PlaceStatus | null {
  if (!hasPlace(p)) return null;
  const where = `${radiusText(p.radiusM)} of ${placeName(p)}`;
  if (state === "released") return { text: `Released inside ${where}`, tone: "done" };
  if (state === "next" && distanceM !== null) {
    return distanceM > p.radiusM
      ? { text: `Waiting until within ${where}, ${distanceText(distanceM)} away`, tone: "held" }
      : { text: `Inside ${where}: releases with the next passing evidence`, tone: "inside" };
  }
  if (state === "next") return { text: `Waiting until within ${where}`, tone: "held" };
  return { text: `Releases only within ${where}`, tone: "info" };
}

/**
 * How far the cargo is from the next milestone's place, best source first: the backend's hold (the controller's own
 * measure), a held latest epoch, then the latest logger position. null when the milestone has no place or nothing
 * is known.
 */
export function nextPlaceDistance(input: {
  milestone: Placed | null | undefined;
  index: number;
  hold?: { milestoneIndex: number; distanceM: number } | null;
  latest?: { milestoneIndex: number; decisionAction: string; heldDistanceM: number | null } | null;
  position?: { latE6: number; lonE6: number } | null;
}): number | null {
  const { milestone, index, hold, latest, position } = input;
  if (!hasPlace(milestone)) return null;
  if (hold && hold.milestoneIndex === index) return hold.distanceM;
  if (latest && latest.milestoneIndex === index && latest.decisionAction === HELD && latest.heldDistanceM !== null) return latest.heldDistanceM;
  if (position) return distanceToPlaceM(milestone, position);
  return null;
}

export const isHeld = (e: { decisionAction?: string; action?: string; held?: boolean } | null | undefined) =>
  !!e && (e.held === true || e.decisionAction === HELD || e.action === HELD);

const R = 6_371_008.8;

/**
 * A geodesic circle (a ring of points `radiusM` from the centre along great circles), closed, as [lon, lat]. The
 * longitudes stay continuous around the centre's longitude (no wrap at ±180), so the ring draws whole on a map whose
 * longitudes were unwrapped around the route.
 */
export function circleRing(lat: number, lon: number, radiusM: number, steps = 96): [number, number][] {
  const rad = Math.PI / 180;
  const f1 = lat * rad, l1 = lon * rad, d = radiusM / R;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const brg = (2 * Math.PI * i) / steps;
    const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(brg));
    const l2 = l1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
    let lo = l2 / rad;
    // keep within 180° of the centre so the ring never jumps across the antimeridian
    while (lo - lon > 180) lo -= 360;
    while (lo - lon < -180) lo += 360;
    ring.push([lo, f2 / rad]);
  }
  return ring;
}
