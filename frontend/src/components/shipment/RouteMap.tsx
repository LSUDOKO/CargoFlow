"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ReplayBar } from "@/components/map/ReplayBar";
import { RouteSketch } from "@/components/map/RouteSketch";
import { MAP_COLORS } from "@/components/map/style";
import type { TelemetrySummary } from "@/lib/api/schemas";
import { useShipment } from "@/lib/api/hooks";
import { emitReplay, useTrack, useVessel } from "@/lib/geo/api";
import { formatKm, formatLatLon } from "@/lib/geo/route";
import { buildScene, type Scene } from "@/lib/geo/scene";

// MapLibre needs the browser (WebGL, window): load it only on the client, after the page has rendered.
const MapView = dynamic(() => import("@/components/map/MapView"), { ssr: false, loading: () => <MapLoading /> });

type Point = { latE6: number; lonE6: number };

type Props = {
  route: Point[];
  position: TelemetrySummary["position"];
  status?: string;
  /** defaults to the [id] of the /track/[id] page */
  shipmentId?: string;
  /** defaults to the shipment's policy */
  maxRouteDeviationM?: number;
};

function MapLoading() {
  return (
    <div className="grid h-full w-full animate-pulse place-items-center bg-[#0A1828] text-xs font-medium text-paper/60" role="status">
      Loading map…
    </div>
  );
}

const when = (s: number) => new Date(s * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

/** A sentence-by-sentence description of what the map shows, for screen readers and the caption. */
function describe(scene: Scene, corridorM: number, trackState: "loading" | "missing" | "error" | "ready", status?: string): string {
  const s: string[] = [];
  const origin = scene.ports.find((p) => p.role === "origin")?.name;
  const dest = scene.ports.find((p) => p.role === "destination")?.name;
  const stops = scene.ports.filter((p) => p.role === "stop").map((p) => p.name);
  if (scene.route.length > 1) {
    s.push(
      `Planned route from ${origin ?? "the origin"} to ${dest ?? "the destination"}${stops.length ? ` via ${stops.join(", ")}` : ""}, about ${formatKm(scene.routeKm)} over ${scene.route.length} waypoints` +
        (corridorM > 0 ? `, with a corridor of ${formatKm(corridorM / 1000)} either side.` : "."),
    );
  }
  if (trackState === "missing") s.push("The logger track is not available yet.");
  else if (trackState === "error") s.push("The logger track could not be loaded.");
  else if (trackState === "ready") {
    const n = scene.track.length;
    const failed = scene.track.filter((p) => !p.pass).length;
    s.push(n === 0 ? "No logger fixes yet." : `${n} logger ${n === 1 ? "fix" : "fixes"}: ${n - failed} passed the policy, ${failed} failed.`);
  }
  if (scene.position) {
    const off = scene.offRouteM;
    s.push(
      `Latest position ${formatLatLon([scene.position.lon, scene.position.lat])} at ${when(scene.position.timestamp)}` +
        (off !== null ? `, ${formatKm(off / 1000)} from the planned route${corridorM > 0 ? (off <= corridorM ? ", inside the corridor" : ", outside the corridor") : ""}.` : "."),
    );
    if (status === "PAUSED") s.push("The facility is paused.");
  } else s.push("No position reported yet.");
  const v = scene.vessel;
  if (v) s.push(`AIS reports ${v.name} (MMSI ${v.mmsi})${v.gapKm !== null ? ` ${formatKm(v.gapKm)} from the logger` : ""}${v.agrees === false ? ", which disagrees with the logger" : ""}.`);
  return s.join(" ");
}

/** The planned route, the policy corridor, the logger's track and the AIS vessel on a live map, with a replay. */
export function RouteMap({ route, position, status, shipmentId, maxRouteDeviationM }: Props) {
  const params = useParams<{ id?: string }>();
  const id = shipmentId ?? (typeof params?.id === "string" ? params.id : undefined);
  const shipment = useShipment(id); // same cache entry as the dashboard's: no extra request
  const corridorM = maxRouteDeviationM ?? shipment.data?.shipment.policy.maxRouteDeviationM ?? 0;
  const track = useTrack(id);
  const vessel = useVessel(id);
  const summaryId = useId();
  const [failed, setFailed] = useState<string | null>(null);
  const [replay, setReplay] = useState<number | null>(null);
  const figure = useRef<HTMLElement>(null);
  const fullscreenTarget = useCallback(() => figure.current, []);

  // a new reading moves the position: fetch the track again so the newest epoch shows up with it
  const posTs = position?.timestamp;
  const { refetch } = track;
  const firstTs = useRef(posTs);
  useEffect(() => {
    if (posTs !== firstTs.current) void refetch();
  }, [posTs, refetch]);

  const scene = useMemo(() => buildScene({ route, track: track.data?.points, position, vessel: vessel.data }), [route, track.data, position, vessel.data]);
  const replayIdx = replay !== null && replay < scene.track.length ? replay : null;

  const onReplay = useCallback(
    (i: number | null) => {
      setReplay(i);
      const p = i === null ? undefined : scene.track[i];
      emitReplay(p ? { epochId: p.epochId, index: i!, sequence: p.sequence } : null);
    },
    [scene.track],
  );

  const trackState = !id ? "missing" : track.isPending ? "loading" : track.isError ? "error" : track.data === null ? "missing" : "ready";
  const summary = describe(scene, corridorM, trackState, status);
  const paused = status === "PAUSED";
  const off = scene.offRouteM;
  const label = `Map of the route${scene.ports[0] ? ` from ${scene.ports[0].name}` : ""}${scene.ports.at(-1) && scene.ports.length > 1 ? ` to ${scene.ports.at(-1)!.name}` : ""}`;

  return (
    <figure ref={figure} className="cf-figure overflow-hidden rounded-2xl bg-ink">
      <div className="cf-figure__map relative h-[260px] bg-[#0A1828] sm:h-[300px]">
        {failed ? (
          <div className="flex h-full flex-col">
            <RouteSketch route={route} position={position} paused={paused} className="min-h-0 w-full flex-1" />
            <p className="bg-ink px-3 py-1.5 text-[11px] text-paper/70">Map tiles are unavailable, so this is a sketch of the route.</p>
          </div>
        ) : (
          <MapView scene={scene} corridorM={corridorM} replayIndex={replayIdx} paused={paused} label={label} describedBy={summaryId} onFail={setFailed} fullscreenTarget={fullscreenTarget} />
        )}
      </div>
      {scene.track.length > 0 && <ReplayBar points={scene.track} index={replayIdx} onChange={onReplay} />}
      <figcaption className="border-t border-paper/10 px-3 py-2.5 text-paper">
        <p id={summaryId} className="sr-only">{summary}</p>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-medium">
          <span className="text-paper/75">
            {scene.route.length > 1 ? formatKm(scene.routeKm) : "Planned route"}
            {corridorM > 0 && ` · ±${formatKm(corridorM / 1000)} corridor`}
          </span>
          <span className="text-paper/75">{scene.position ? `Last fix ${when(scene.position.timestamp)}` : "Awaiting first reading"}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-paper/70" aria-hidden="true">
          {off !== null && corridorM > 0 && (
            <span className={`rounded-full px-2 py-0.5 font-semibold ${off <= corridorM ? "bg-verified/20 text-[#4BE39A]" : "bg-alert/20 text-[#FFD27A]"}`}>
              {off <= corridorM ? "Inside corridor" : `Off route by ${formatKm((off - corridorM) / 1000)}`}
            </span>
          )}
          <Legend swatch={<span className="block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: MAP_COLORS.route }} />}>Plan</Legend>
          {!failed && corridorM > 0 && <Legend swatch={<span className="block h-2 w-4 rounded-sm" style={{ background: MAP_COLORS.corridor, opacity: 0.45 }} />}>Corridor</Legend>}
          {!failed && scene.track.length > 0 && (
            <>
              <Legend swatch={<span className="block h-2 w-2 rounded-full" style={{ background: MAP_COLORS.pass }} />}>Pass</Legend>
              <Legend swatch={<span className="block h-2 w-2 rounded-full" style={{ background: MAP_COLORS.fail }} />}>Fail</Legend>
            </>
          )}
          {!failed && scene.vessel && <Legend swatch={<span className="block h-2 w-2 rotate-45" style={{ background: MAP_COLORS.ais }} />}>AIS</Legend>}
          {trackState === "missing" && <span>Track not available yet</span>}
          {trackState === "ready" && scene.track.length === 0 && <span>No logger fixes yet</span>}
        </div>
      </figcaption>
    </figure>
  );
}

function Legend({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {swatch}
      {children}
    </span>
  );
}
