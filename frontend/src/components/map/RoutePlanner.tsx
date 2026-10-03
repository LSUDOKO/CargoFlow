"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef } from "react";
import { findPort } from "@/lib/geo/ports";
import { LANES, laneForPorts, routeFromLane, type PlannedRoute } from "@/lib/geo/lanes";
import { MAX_WAYPOINTS, planSeaRoute } from "@/lib/geo/searoute";
import { formatKm } from "@/lib/geo/route";
import { buildScene } from "@/lib/geo/scene";
import { PortCombobox } from "./PortCombobox";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center bg-[#D5E3EC] text-xs text-text-muted">Loading map…</div>,
});

const MAX_STOPS = 3;

type Props = {
  value: PlannedRoute;
  onChange: (r: PlannedRoute) => void;
  /** the policy's allowed deviation, for the corridor preview */
  deviationKm: number;
  error?: string | null;
};

/**
 * Origin, optional transshipment stops and destination, from the bundled port list; the sea route between them
 * is generated with searoute-js, simplified to at most 64 waypoints, and previewed with the policy corridor.
 */
export function RoutePlanner({ value, onChange, deviationKm, error }: Props) {
  const seq = useRef(0);
  const ports = value.ports;
  const origin = ports[0] ?? null;
  const dest = ports.length > 1 ? ports[ports.length - 1]! : null;
  const stops = ports.length > 2 ? ports.slice(1, -1) : [];

  // ports is [origin, ...stops, destination]; while an end is missing it holds "" in that place
  const update = (next: string[]) => {
    const ticket = ++seq.current;
    const complete = next.length >= 2 && next.every(Boolean);
    if (!complete) return onChange({ ports: next, points: [], distanceKm: 0, status: "incomplete" });
    const lane = laneForPorts(next);
    if (lane) return onChange(routeFromLane(lane));
    onChange({ ports: next, points: value.points, distanceKm: value.distanceKm, status: "planning" });
    planSeaRoute(next.map((c) => findPort(c)!))
      .then((r) => ticket === seq.current && onChange({ ports: next, points: r.points, distanceKm: r.distanceKm, status: "ready" }))
      .catch((e: unknown) => ticket === seq.current && onChange({ ports: next, points: [], distanceKm: 0, status: "error", error: e instanceof Error ? e.message : "The sea route could not be generated." }));
  };

  const ends = (o: string | null, d: string | null, s: string[]) => update([o ?? "", ...s, d ?? ""]);
  const scene = useMemo(() => buildScene({ route: value.points }), [value.points]);
  const activeLane = laneForPorts(ports)?.id;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-1.5 text-sm font-semibold" id="lane-picks">Quick picks</p>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby="lane-picks">
          {LANES.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={activeLane === l.id}
              onClick={() => {
                seq.current++;
                onChange(routeFromLane(l));
              }}
              className={`rounded-full border-2 px-3.5 py-1.5 text-sm font-semibold transition-colors ${activeLane === l.id ? "border-ink bg-ink text-paper" : "border-line bg-white hover:border-ink/40"}`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PortCombobox label="Origin port" value={origin || null} exclude={dest ? [dest] : []} onChange={(c) => ends(c, dest, stops)} />
        <PortCombobox label="Destination port" value={dest || null} exclude={origin ? [origin] : []} onChange={(c) => ends(origin, c, stops)} />
        {stops.map((s, i) => (
          <PortCombobox
            key={i}
            label={`Transshipment stop ${i + 1}`}
            value={s || null}
            onChange={(c) => ends(origin, dest, stops.map((x, j) => (j === i ? (c ?? "") : x)))}
            action={
              <button type="button" className="text-sm font-semibold text-text-muted underline hover:text-ink" onClick={() => ends(origin, dest, stops.filter((_, j) => j !== i))}>
                Remove stop {i + 1}
              </button>
            }
          />
        ))}
      </div>
      {stops.length < MAX_STOPS && (
        <button type="button" onClick={() => ends(origin, dest, [...stops, ""])} className="self-start text-sm font-semibold underline">
          + Add a transshipment stop
        </button>
      )}

      <div className="overflow-hidden rounded-tile border border-line bg-white">
        <div className="relative h-[220px] bg-[#D5E3EC] sm:h-[260px]">
          {value.points.length > 1 ? (
            <MapView scene={scene} corridorM={deviationKm * 1000} label="Preview of the planned sea route" variant="preview" fitKey={value.points.map((p) => `${p.latE6},${p.lonE6}`).join(";")} />
          ) : (
            <p className="grid h-full place-items-center px-6 text-center text-sm text-text-muted">Choose an origin and a destination to generate the sea route.</p>
          )}
          {value.status === "planning" && (
            <p role="status" className="absolute top-3 left-3 rounded-full bg-ink/90 px-3 py-1 text-xs font-semibold text-paper">Generating the sea route…</p>
          )}
        </div>
        <p className="border-t border-line px-4 py-2.5 text-xs font-medium text-text-muted" aria-live="polite">
          {value.status === "ready"
            ? `Sea route about ${formatKm(value.distanceKm)} (${Math.round(value.distanceKm / 1.852).toLocaleString("en-US")} nmi) · ${value.points.length} waypoints committed on chain (at most ${MAX_WAYPOINTS})${deviationKm > 0 ? ` · corridor ±${deviationKm} km` : ""}`
            : value.status === "error"
              ? value.error
              : value.status === "planning"
                ? "Generating the sea route…"
                : "Pick both ends of the route."}
        </p>
      </div>
      {error && <p className="-mt-2 text-sm font-medium text-danger-fg">{error}</p>}
    </div>
  );
}
