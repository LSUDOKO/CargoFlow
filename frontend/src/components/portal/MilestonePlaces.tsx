"use client";

import dynamic from "next/dynamic";
import { useId, useMemo, useState } from "react";
import type { MapPlace } from "@/components/map/MapView";
import { Field } from "@/components/ui/Field";
import { findPort, nearestPort } from "@/lib/geo/ports";
import type { PlannedRoute } from "@/lib/geo/lanes";
import { buildScene } from "@/lib/geo/scene";
import { cleanLabel, DESTINATION_RADIUS_KM, normLon, placeErrors, placePhrase, radiusText, toPlaceSpec, type PlaceDraft } from "@/lib/places";

const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center bg-info-bg text-xs text-text-muted">Loading map…</div>,
});

type Props = {
  count: number;
  route: PlannedRoute;
  places: (PlaceDraft | null)[];
  onChange: (places: (PlaceDraft | null)[]) => void;
  showErrors: boolean;
};

const MAP = "map";

/** Route ports as place choices: origin, stops and destination, in route order, each once. */
function routePorts(route: PlannedRoute) {
  const seen = new Set<string>();
  return route.ports
    .map((code, i) => ({ code, port: findPort(code), role: i === 0 ? "Origin" : i === route.ports.length - 1 ? "Destination" : "Stop" }))
    .filter((p) => p.port && !seen.has(p.code) && seen.add(p.code));
}

/** The draft for "the last tranche only at the destination", or null when the route has no destination port yet. */
export function destinationPlace(route: PlannedRoute): PlaceDraft | null {
  const code = route.ports.at(-1);
  const port = code ? findPort(code) : undefined;
  return port ? { lat: port.lat, lon: port.lon, radiusKm: String(DESTINATION_RADIUS_KM), label: cleanLabel(port.name), source: port.code } : null;
}

const isDestinationPlace = (p: PlaceDraft | null | undefined, route: PlannedRoute) => {
  const d = destinationPlace(route);
  return !!p && !!d && p.source === d.source && Number(p.radiusKm) === DESTINATION_RADIUS_KM;
};

/** The wizard's milestone places (contracts v2): none by default, a one-click destination rule, or a place per milestone. */
export function MilestonePlaces({ count, route, places, onChange, showErrors }: Props) {
  const [picking, setPicking] = useState<number | null>(null);
  const [open, setOpen] = useState(() => places.slice(0, count).some((p, i) => p && !(i === count - 1 && isDestinationPlace(p, route))));
  const switchId = useId();
  const n = Math.max(0, Math.min(8, Number.isInteger(count) ? count : 0));
  const last = n - 1;
  const dest = destinationPlace(route);
  const destOn = n > 0 && isDestinationPlace(places[last], route);
  const ports = routePorts(route);
  const set = (i: number, p: PlaceDraft | null) => {
    const next = Array.from({ length: Math.max(places.length, n) }, (_, j) => places[j] ?? null);
    next[i] = p;
    onChange(next);
  };

  const scene = useMemo(() => buildScene({ route: route.points }), [route.points]);
  const circles: MapPlace[] = places.slice(0, n).flatMap((p, i) => {
    if (!p || placeErrors(p).radius) return [];
    const spec = toPlaceSpec(p);
    return [{ key: `w${i}`, lat: p.lat, lon: p.lon, radiusM: spec.radiusM, tag: `M${i + 1} · ${radiusText(spec.radiusM)}`, title: `Milestone ${i + 1}: releases only ${placePhrase({ ...spec, placeLabel: p.label })}`, state: "draft" as const }];
  });

  const pick = (at: [number, number]) => {
    if (picking === null) return;
    const i = picking;
    const lat = Math.max(-90, Math.min(90, at[1]));
    const lon = normLon(at[0]);
    const prev = places[i];
    const near = nearestPort(lat, lon, 50);
    set(i, { lat, lon, radiusKm: prev?.radiusKm ?? "100", label: prev && prev.source === MAP && prev.label ? prev.label : near ? cleanLabel(near.name) : "", source: MAP });
    setPicking(null);
  };

  if (n === 0) return null;
  return (
    <div className="mt-6 flex flex-col gap-4 rounded-tile border border-border bg-neutral-25 p-4 md:p-5">
      <div>
        <h3 className="font-display text-h4">Where milestones release <span className="font-sans text-xs font-normal text-text-muted">Optional</span></h3>
        <p className="text-sm text-text-muted">By default a milestone releases on passing evidence wherever the cargo is. A place makes it wait until the evidence comes from within a radius of a port or point; evidence from elsewhere holds it, and nothing fails.</p>
      </div>

      {dest && (
        <div className="flex items-start gap-3">
          <button
            id={switchId}
            type="button"
            role="switch"
            aria-checked={destOn}
            onClick={() => set(last, destOn ? null : dest)}
            className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border-2 transition-colors ${destOn ? "border-ink bg-ink" : "border-border-strong bg-mist"}`}
          >
            <span aria-hidden="true" className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${destOn ? "left-[1.375rem] bg-signal" : "left-0.5 bg-white shadow"}`} />
          </button>
          <label htmlFor={switchId} className="cursor-pointer text-sm">
            <span className="block font-semibold">Release the last tranche only at the destination ({DESTINATION_RADIUS_KM} km)</span>
            <span className="block text-text-muted">Milestone {n} waits for evidence from within {DESTINATION_RADIUS_KM} km of {dest.label}.</span>
          </label>
        </div>
      )}

      <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="text-text-muted transition-transform group-open:rotate-90">›</span>
          Set a place for any milestone
        </summary>
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ol className="flex flex-col gap-3">
            {Array.from({ length: n }, (_, i) => {
              const p = places[i] ?? null;
              const errs = p ? placeErrors(p) : {};
              const choice = picking === i ? MAP : p ? p.source : "";
              return (
                <li key={i} className="rounded-tile bg-surface p-3 ring-1 ring-border ring-inset">
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={`place-${switchId}-${i}`} className="w-24 shrink-0 text-sm font-semibold">Milestone {i + 1}</label>
                    <select
                      id={`place-${switchId}-${i}`}
                      value={choice}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") {
                          set(i, null);
                          if (picking === i) setPicking(null);
                        } else if (v === MAP) setPicking(i);
                        else {
                          const port = findPort(v);
                          if (port) set(i, { lat: port.lat, lon: port.lon, radiusKm: p?.radiusKm ?? "100", label: cleanLabel(port.name), source: port.code });
                          if (picking === i) setPicking(null);
                        }
                      }}
                      className="h-10 min-w-0 flex-1 rounded-control border border-border-strong bg-surface px-3 text-sm font-medium shadow-1 focus:border-ink focus:ring-1 focus:ring-ink focus:outline-none"
                    >
                      <option value="">Anywhere (no place)</option>
                      {ports.map((pt) => (
                        <option key={pt.code} value={pt.code}>{pt.role}: {pt.port!.name}</option>
                      ))}
                      <option value={MAP}>{p?.source === MAP ? "The point picked on the map" : "A point I pick on the map"}</option>
                    </select>
                  </div>
                  {picking === i && (
                    <p role="status" className="mt-2 text-sm font-semibold">
                      Click the map to place milestone {i + 1}.{" "}
                      <button type="button" className="font-normal underline" onClick={() => setPicking(null)}>Cancel</button>
                    </p>
                  )}
                  {p && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                      <Field label="Radius" aria-label={`Milestone ${i + 1} radius`} value={p.radiusKm} onChange={(e) => set(i, { ...p, radiusKm: e.target.value })} inputMode="decimal" suffix="km" error={showErrors || p.radiusKm ? errs.radius : undefined} />
                      <Field label="Place name" aria-label={`Milestone ${i + 1} place name`} value={p.label} onChange={(e) => set(i, { ...p, label: e.target.value })} placeholder="e.g. Colombo" maxLength={64} hint={p.source === MAP ? `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}` : "Shown on the dashboard"} error={errs.label ?? errs.centre} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="flex min-h-[16rem] flex-col overflow-hidden rounded-tile border border-border bg-surface">
            <div className="relative min-h-0 flex-1 bg-info-bg">
              {/* the map mounts once the section is open: created inside a closed <details> it would fit a 0 x 0 box */}
              {!open ? null : route.points.length > 1 ? (
                <MapView
                  scene={scene}
                  label={picking !== null ? `Map: click to place milestone ${picking + 1}` : "Preview of the milestone places on the route"}
                  variant="preview"
                  places={circles}
                  onPick={picking !== null ? pick : undefined}
                  fitKey={route.points.map((q) => `${q.latE6},${q.lonE6}`).join(";")}
                />
              ) : (
                <p className="grid h-full place-items-center px-6 text-center text-sm text-text-muted">Choose the route first.</p>
              )}
              {picking !== null && <p className="pointer-events-none absolute top-3 left-3 rounded-full bg-ink/90 px-3 py-1 text-xs font-semibold text-paper">Click to place milestone {picking + 1}</p>}
            </div>
            <p className="border-t border-border px-3 py-2 text-caption text-text-muted" aria-live="polite">
              {circles.length ? circles.map((c) => c.title).join(" · ") : "No places: every milestone releases wherever its evidence passes."}
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}
