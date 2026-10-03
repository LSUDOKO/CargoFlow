"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { VoyageOverlay } from "@/components/map/MapView";
import { humanReason } from "@/components/map/popup";
import { ReplayBar } from "@/components/map/ReplayBar";
import { RouteSketch } from "@/components/map/RouteSketch";
import { MAP_COLORS, PALETTES, readTheme, saveTheme, type MapTheme } from "@/components/map/style";
import type { TelemetrySummary } from "@/lib/api/schemas";
import { useConfig, useEpochs, useShipment } from "@/lib/api/hooks";
import { formatUSDG } from "@/lib/format";
import { emitReplay, useTrack, useVessel } from "@/lib/geo/api";
import { formatKm, formatLatLon, type LonLat } from "@/lib/geo/route";
import { buildScene, type Scene } from "@/lib/geo/scene";
import { bearingDeg, compass, milestoneStatesFor, placeMilestones, speedKnots, tempClass, voyageProgress, type Band, type Progress, type TempClass } from "@/lib/geo/voyage";

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
    <div className="grid h-full w-full animate-pulse place-items-center bg-[#D5E3EC] text-xs font-medium text-slate" role="status">
      Loading map…
    </div>
  );
}

// the map theme, shared by every map on the page and kept in localStorage (see style.ts)
const themeListeners = new Set<() => void>();
const subscribeTheme = (cb: () => void) => {
  themeListeners.add(cb);
  return () => void themeListeners.delete(cb);
};
function useMapTheme(): [MapTheme, (t: MapTheme) => void] {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "light" as const);
  const set = useCallback((t: MapTheme) => {
    saveTheme(t);
    themeListeners.forEach((l) => l());
  }, []);
  return [theme, set];
}

const when = (s: number) => new Date(s * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const day = (s: number) => new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const DONE = ["DELIVERED", "SETTLED"];

type Facts = { progress: Progress | null; heading: number | null; speedKn: number | null; etaTs: number | null; classes: Record<TempClass, number> };

/** A sentence-by-sentence description of what the map shows, for screen readers. */
function describe(scene: Scene, corridorM: number, trackState: "loading" | "missing" | "error" | "ready", facts: Facts, voyage: VoyageOverlay, status?: string): string {
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
  if (facts.progress) {
    s.push(DONE.includes(status ?? "") ? "The cargo has been delivered." : `${Math.round(facts.progress.pct)}% of the route covered, ${formatKm(facts.progress.remainingKm)} to go${facts.etaTs ? `, estimated arrival ${day(facts.etaTs)}` : ""}.`);
  }
  if (trackState === "missing") s.push("The logger track is not available yet.");
  else if (trackState === "error") s.push("The logger track could not be loaded.");
  else if (trackState === "ready") {
    const n = scene.track.length;
    const failed = scene.track.filter((p) => !p.pass).length;
    s.push(n === 0 ? "No logger fixes yet." : `${n} logger ${n === 1 ? "batch" : "batches"}: ${n - failed} passed the policy, ${failed} failed.`);
    if (n && voyage.band) s.push(`Temperature: ${facts.classes.in} in band, ${facts.classes.near} near a limit, ${facts.classes.out} out of band.`);
  }
  for (const m of voyage.milestones) {
    const st = { released: "released", paused: "blocked while the facility is paused", next: "awaiting evidence", pending: "pending" }[m.state];
    s.push(`Milestone ${m.index + 1} ${st}${m.planned ? "" : ` at km ${Math.round(m.alongKm).toLocaleString("en-US")}`}.`);
  }
  if (voyage.pause) s.push(`The facility ${voyage.pause.resumed ? "was paused" : "is paused"} at ${formatLatLon(voyage.pause.at)}: ${voyage.pause.reason}${voyage.pause.resumed ? ", and has since resumed." : "."}`);
  if (scene.position) {
    const off = scene.offRouteM;
    s.push(
      `Latest position ${formatLatLon([scene.position.lon, scene.position.lat])} at ${when(scene.position.timestamp)}` +
        (facts.speedKn !== null ? `, ${facts.speedKn.toFixed(1)} knots` : "") +
        (facts.heading !== null ? ` heading ${compass(facts.heading)}` : "") +
        (off !== null ? `, ${formatKm(off / 1000)} from the planned route${corridorM > 0 ? (off <= corridorM ? ", inside the corridor" : ", outside the corridor") : ""}.` : "."),
    );
  } else s.push("No position reported yet.");
  const v = scene.vessel;
  if (v) s.push(`AIS reports ${v.name} (MMSI ${v.mmsi})${v.gapKm !== null ? ` ${formatKm(v.gapKm)} from the logger` : ""}${!v.comparable ? ", not compared with the logger" : v.agrees === false ? ", which disagrees with the logger" : ", which agrees with the logger"}.`);
  return s.join(" ");
}

/** Opens the dashboard's Evidence tab (its tab button has a stable id) and scrolls to it. */
function openEvidenceTab() {
  const tab = document.getElementById("tab-evidence");
  if (!tab) return;
  tab.click();
  tab.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

/**
 * The planned route, the policy corridor, the logger's track coloured by temperature against the agreed band,
 * where each milestone's evidence was taken, any pause, and the AIS vessel, on a live map with a replay.
 */
export function RouteMap({ route, position, status, shipmentId, maxRouteDeviationM }: Props) {
  const params = useParams<{ id?: string }>();
  const id = shipmentId ?? (typeof params?.id === "string" ? params.id : undefined);
  const shipment = useShipment(id); // same cache entries as the dashboard's: no extra requests
  const epochs = useEpochs(id);
  const { data: cfg } = useConfig();
  const view = shipment.data;
  const corridorM = maxRouteDeviationM ?? view?.shipment.policy.maxRouteDeviationM ?? 0;
  const track = useTrack(id);
  const vessel = useVessel(id);
  const summaryId = useId();
  const legendId = useId();
  const [failed, setFailed] = useState<string | null>(null);
  const [replay, setReplay] = useState<number | null>(null);
  const [legendOpen, setLegendOpen] = useState(false); // phones only
  const [theme, setTheme] = useMapTheme();
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

  const policy = view?.shipment.policy;
  const band: Band | null = useMemo(() => (policy && policy.maxTempX100 > policy.minTempX100 ? { minX100: policy.minTempX100, maxX100: policy.maxTempX100 } : null), [policy]);
  const facility = view?.facility ?? null;
  const milestones = view?.milestones;
  const epochList = epochs.data?.epochs;
  const chainId = cfg?.chainId;

  const facts: Facts = useMemo(() => {
    const pos = scene.position;
    const progress = voyageProgress(scene.route, pos ? [pos.lon, pos.lat] : null);
    // heading and speed from the last two epochs (each one's centroid at its end time)
    const fixes: { at: LonLat; t: number }[] = scene.track.map((p) => ({ at: [p.lon, p.lat], t: p.endTime }));
    let heading: number | null = null, speedKn: number | null = null;
    if (fixes.length >= 2) {
      const a = fixes.at(-2)!, b = fixes.at(-1)!;
      speedKn = speedKnots(a.at, a.t, b.at, b.t);
      if (speedKn !== null && speedKn > 40) speedKn = null; // centroids jumping (a gap in the data), not a speed
      heading = speedKn !== null && speedKn >= 0.5 ? bearingDeg(a.at, b.at) : null;
    }
    // a rough arrival estimate from the average speed so far; only while travelling and with enough history
    let etaTs: number | null = null;
    const first = scene.track[0];
    if (progress && pos && first && !DONE.includes(status ?? "") && progress.pct < 99 && scene.track.length >= 3) {
      const hours = (pos.timestamp - first.startTime) / 3600;
      const kmh = hours > 0 ? progress.doneKm / hours : 0;
      if (kmh > 5) etaTs = pos.timestamp + (progress.remainingKm / kmh) * 3600;
    }
    const classes = { in: 0, near: 0, out: 0 } as Record<TempClass, number>;
    for (const p of scene.track) classes[tempClass(p.minTempX100, p.maxTempX100, band)]++;
    return { progress, heading, speedKn, etaTs, classes };
  }, [scene, band, status]);

  const voyage: VoyageOverlay = useMemo(() => {
    const epochTx: Record<string, string> = {};
    for (const e of epochList ?? []) if (e.commitTx) epochTx[e.epochId] = e.commitTx;
    const states = milestoneStatesFor(facility, milestones?.length || 0);
    const marks = placeMilestones(scene.route, scene.track, states).map((m) => ({
      ...m,
      amount: milestones?.[m.index] ? formatUSDG(milestones[m.index]!.allocatedUsdg) : undefined,
      releaseTx: milestones?.[m.index]?.releaseTxHash,
    }));
    // the pause: where the epoch that paused the facility was taken
    let pause: VoyageOverlay["pause"] = null;
    const pausing = [...(epochList ?? [])].reverse().find((e) => e.decisionAction === "PAUSE_FACILITY");
    const isPaused = facility?.status === "PAUSED";
    if (pausing || isPaused || (facility?.pauseCount ?? 0) > 0) {
      const tp = pausing ? scene.track.find((t) => t.epochId === pausing.epochId) : [...scene.track].reverse().find((t) => !t.pass);
      const at: LonLat | null = tp ? [tp.lon, tp.lat] : isPaused && scene.position ? [scene.position.lon, scene.position.lat] : null;
      if (at) {
        const reason = humanReason(facility?.pauseReason || pausing?.reasons.join(", ") || "") || (tp && band ? `Temperature reached ${(tp.maxTempX100 / 100).toFixed(1)} °C, above the agreed ${(band.maxX100 / 100).toFixed(1)} °C` : "The evidence failed the policy");
        pause = { at, reason, resumed: !isPaused, epochId: pausing?.epochId ?? tp?.epochId, time: tp?.endTime };
      }
    }
    return {
      band,
      milestones: marks,
      pause,
      heading: facts.heading,
      speedKn: facts.speedKn,
      doneKm: facts.progress?.doneKm ?? null,
      epochTx,
      chainId,
      onOpenEpoch: (_epochId: string, index: number) => {
        if (index >= 0) onReplay(index);
        openEvidenceTab();
      },
    };
  }, [epochList, facility, milestones, scene, band, facts, chainId, onReplay]);

  const trackState = !id ? "missing" : track.isPending ? "loading" : track.isError ? "error" : track.data === null ? "missing" : "ready";
  const summary = describe(scene, corridorM, trackState, facts, voyage, status);
  const paused = status === "PAUSED";
  const off = scene.offRouteM;
  const origin = scene.ports.find((p) => p.role === "origin");
  const dest = scene.ports.find((p) => p.role === "destination");
  const label = `Map of the route${origin ? ` from ${origin.name}` : ""}${dest ? ` to ${dest.name}` : ""}`;
  const delivered = DONE.includes(status ?? "");
  const pal = PALETTES[theme];

  // the legend lists only what is on the map
  const legend: { key: string; swatch: React.ReactNode; text: string }[] = [];
  if (!failed) {
    const ln = (color: string, dashed: boolean, w = 2) => <span className="block w-5" style={{ borderTop: `${w}px ${dashed ? "dashed" : "solid"} ${color}` }} />;
    const dot = (color: string, hollow = false) => <span className="block h-2.5 w-2.5 rounded-full" style={hollow ? { border: `2px solid ${color}`, background: "#fff" } : { background: color, boxShadow: "0 0 0 1.5px #fff" }} />;
    if (scene.route.length > 1) legend.push({ key: "plan", swatch: ln(MAP_COLORS.route, true), text: "Planned route" });
    if (voyage.doneKm) legend.push({ key: "done", swatch: ln(MAP_COLORS.routeDone, false, 2.5), text: "Covered" });
    if (corridorM > 0) legend.push({ key: "corr", swatch: <span className="block h-2.5 w-5 rounded-sm" style={{ background: MAP_COLORS.corridor, opacity: 0.3 }} />, text: `±${formatKm(corridorM / 1000)} corridor` });
    legend.push({ key: "lanes", swatch: ln(MAP_COLORS.lanes, true, 1), text: "Shipping lanes" });
    if (scene.track.length) {
      if (band) {
        if (facts.classes.in) legend.push({ key: "in", swatch: dot(MAP_COLORS.tempIn), text: "In band" });
        if (facts.classes.near) legend.push({ key: "near", swatch: dot(MAP_COLORS.tempNear), text: "Near limit" });
        if (facts.classes.out) legend.push({ key: "out", swatch: dot(MAP_COLORS.tempOut), text: "Out of band" });
      } else legend.push({ key: "trk", swatch: dot(MAP_COLORS.tempIn), text: "Logger batch" });
      if (scene.track.some((p) => !p.committed)) legend.push({ key: "unc", swatch: dot(MAP_COLORS.tempIn, true), text: "Not yet on chain" });
    }
    const ms = new Set(voyage.milestones.map((m) => m.state));
    const badge = (bg: string, fg: string, g: string, border = "#fff") => <span className="grid h-4 w-4 place-items-center rounded-full text-[9px] font-extrabold" style={{ background: bg, color: fg, border: `1.5px solid ${border}` }}>{g}</span>;
    if (ms.has("released")) legend.push({ key: "msr", swatch: badge(MAP_COLORS.released, "#fff", "✓"), text: "Milestone released" });
    if (ms.has("paused")) legend.push({ key: "msp", swatch: badge(MAP_COLORS.paused, "#0B1B2B", "!"), text: "Milestone blocked" });
    if (ms.has("next") || ms.has("pending")) legend.push({ key: "msn", swatch: badge("#fff", "#5B6B7B", "#", "#94A3B8"), text: "Milestone pending" });
    if (voyage.pause) legend.push({ key: "pause", swatch: <svg width="12" height="14" viewBox="0 0 16 20" aria-hidden="true"><path d="M3 19V2" stroke={voyage.pause.resumed ? MAP_COLORS.linkIdle : MAP_COLORS.paused} strokeWidth="2" /><path d="M3.6 2.6h9.2l-2.4 3.6 2.4 3.6H3.6z" fill={voyage.pause.resumed ? MAP_COLORS.linkIdle : MAP_COLORS.paused} /></svg>, text: voyage.pause.resumed ? "Paused, resumed" : "Paused" });
    if (scene.position) legend.push({ key: "pos", swatch: <span className="block h-3 w-3 rounded-full border-2 border-signal" style={{ background: paused ? MAP_COLORS.paused : "#0B1B2B" }} />, text: "Logger now" });
    if (scene.vessel) {
      legend.push({ key: "ais", swatch: <svg width="12" height="12" viewBox="-10 -10 20 20" aria-hidden="true"><path d="M0 -9 L5 6 L0 3.5 L-5 6 Z" fill={MAP_COLORS.ais} /></svg>, text: "AIS vessel" });
      if (!scene.vessel.comparable) legend.push({ key: "nc", swatch: ln(MAP_COLORS.linkIdle, true, 1.5), text: "AIS not compared" });
    }
  }
  // phones: the legend is folded behind a button; wider screens always show it
  const toggleLegend = () => setLegendOpen((o) => !o);
  const legendVisible = legendOpen ? "flex" : "hidden";

  const p = facts.progress;
  return (
    <figure ref={figure} className="cf-figure overflow-hidden rounded-2xl border border-line bg-white">
      <div className="cf-figure__map relative h-[340px] sm:h-[440px]" style={{ background: pal.water }}>
        {failed ? (
          <div className="flex h-full flex-col">
            <RouteSketch route={route} position={position} paused={paused} className="min-h-0 w-full flex-1" />
            <p className="border-t border-line bg-white px-3 py-1.5 text-[11px] text-slate">Map tiles are unavailable, so this is a sketch of the route.</p>
          </div>
        ) : (
          <MapView scene={scene} corridorM={corridorM} replayIndex={replayIdx} paused={paused} label={label} describedBy={summaryId} onFail={setFailed} fullscreenTarget={fullscreenTarget} theme={theme} voyage={voyage} showLanes />
        )}

        {/* voyage card: where the cargo is along the route */}
        {scene.route.length > 1 && (
          <div className="pointer-events-none absolute top-2.5 left-2.5 z-10 w-[min(250px,calc(100%-62px))] rounded-xl border border-ink/10 bg-white/95 px-2.5 py-2 text-ink shadow-[0_4px_14px_-6px_rgb(11_27_43/0.3)] backdrop-blur-sm" aria-hidden="true">
            <div className="flex items-center justify-between gap-2 text-[11px] font-semibold">
              <span className="truncate">
                {origin?.code ?? origin?.name ?? "Origin"} <span className="font-normal text-slate">→</span> {dest?.code ?? dest?.name ?? "Destination"}
              </span>
              <span className={delivered ? "text-[#00733E]" : ""}>{delivered ? "Delivered" : p ? `${Math.round(p.pct)}%` : "Not started"}</span>
            </div>
            <div className="relative mt-1.5 h-1 overflow-hidden rounded-full bg-mist">
              <div className="absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: `${delivered ? 100 : (p?.pct ?? 0)}%` }} />
              {voyage.milestones.map((m) => (
                <span key={m.index} className="absolute top-0 h-full w-[2px] bg-white" style={{ left: `${Math.min(99.5, (100 * m.alongKm) / (scene.routeKm || 1))}%` }} />
              ))}
            </div>
            <p className="mt-1.5 truncate font-mono text-[10px] text-slate">
              {delivered ? formatKm(scene.routeKm) : p ? <><b className="font-semibold text-ink">{formatKm(p.remainingKm)}</b> to go of {formatKm(p.totalKm)}</> : `${formatKm(scene.routeKm)} · awaiting first fix`}
            </p>
            {!delivered && (facts.etaTs || facts.speedKn !== null) && (
              <p className="truncate font-mono text-[10px] text-slate">
                {[facts.speedKn !== null ? `${facts.speedKn.toFixed(1)} kn${facts.heading !== null ? ` ${compass(facts.heading)}` : ""}` : null, facts.etaTs ? `ETA ≈ ${day(facts.etaTs)}` : null].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        )}
      </div>
      {scene.track.length > 0 && <ReplayBar points={scene.track} index={replayIdx} onChange={onReplay} band={band} />}

      <figcaption className="border-t border-line px-3 py-2.5 text-ink">
        <p id={summaryId} className="sr-only">{summary}</p>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs font-medium">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate">
            <span>
              {scene.route.length > 1 ? formatKm(scene.routeKm) : "Planned route"}
              {scene.route.length > 1 && ` (${Math.round(scene.routeKm / 1.852).toLocaleString("en-US")} nmi)`}
            </span>
            <span>{scene.position ? `Last fix ${when(scene.position.timestamp)}` : "Awaiting first reading"}</span>
            {off !== null && corridorM > 0 && (
              <span className={`rounded-full px-2 py-0.5 font-semibold ${off <= corridorM ? "bg-verified/12 text-[#00733E]" : "bg-alert/20 text-[#8A5300]"}`}>
                {off <= corridorM ? "Inside corridor" : `Off route by ${formatKm((off - corridorM) / 1000)}`}
              </span>
            )}
            {trackState === "missing" && <span>Track not available yet</span>}
            {trackState === "error" && <span>Track could not be loaded</span>}
            {trackState === "ready" && scene.track.length === 0 && <span>No logger fixes yet</span>}
          </div>
          {!failed && legend.length > 0 && (
            <button type="button" onClick={toggleLegend} aria-expanded={legendOpen} aria-controls={legendId} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-[11px] font-semibold sm:hidden">
              Legend
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className={legendOpen ? "" : "rotate-180"}><path d="M2 6.5 5 3.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          )}
          {!failed && (
            <div role="group" aria-label="Map style" className="inline-flex rounded-full bg-mist p-0.5 text-[11px] font-semibold">
              {(["light", "dark"] as const).map((t) => (
                <button key={t} type="button" aria-pressed={theme === t} onClick={() => setTheme(t)} className={`rounded-full px-2.5 py-0.5 capitalize transition-colors ${theme === t ? "bg-ink text-paper" : "text-ink/70 hover:text-ink"}`}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        {legend.length > 0 && (
          <ul id={legendId} aria-label="Map legend" className={`${legendVisible} mt-2.5 flex-wrap gap-x-3.5 gap-y-1.5 border-t border-line pt-2.5 text-[11px] text-ink/75 sm:flex`}>
            {legend.map((l) => (
              <li key={l.key} className="flex items-center gap-1.5">
                <span className="grid w-5 shrink-0 place-items-center" aria-hidden="true">{l.swatch}</span>
                {l.text}
              </li>
            ))}
          </ul>
        )}
      </figcaption>
    </figure>
  );
}
