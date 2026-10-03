"use client";

// The MapLibre map itself. Loaded only in the browser (callers import it with next/dynamic and ssr: false), so
// nothing here runs during server rendering. It draws a Scene and reports when the base map cannot load, so the
// caller can fall back to the SVG sketch.

import maplibregl, { type GeoJSONSource, type IControl, type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";
import { useEffect, useRef, useState } from "react";
import type { Scene } from "@/lib/geo/scene";
import { bounds, corridorRuns, formatKm, type LonLat } from "@/lib/geo/route";
import { cargoStyle, MAP_COLORS as C } from "./style";

export type MapViewProps = {
  scene: Scene;
  /** the policy's allowed deviation in metres; draws the corridor when above zero */
  corridorM?: number;
  /** index into scene.track being replayed, or null for the live view */
  replayIndex?: number | null;
  paused?: boolean;
  /** accessible name of the map canvas */
  label: string;
  describedBy?: string;
  variant?: "full" | "preview";
  /** refits the view whenever this changes (the wizard passes the route's identity) */
  fitKey?: string;
  onFail?: (reason: string) => void;
  /** the element to show full screen (defaults to the map) */
  fullscreenTarget?: () => HTMLElement | null;
  className?: string;
};

type Feature = { type: "Feature"; properties: Record<string, unknown>; geometry: { type: "LineString"; coordinates: LonLat[] } | { type: "Point"; coordinates: LonLat } };
const fc = (features: Feature[]) => ({ type: "FeatureCollection" as const, features });
const line = (coordinates: LonLat[], properties: Record<string, unknown> = {}): Feature => ({ type: "Feature", properties, geometry: { type: "LineString", coordinates } });
const point = (coordinates: LonLat, properties: Record<string, unknown> = {}): Feature => ({ type: "Feature", properties, geometry: { type: "Point", coordinates } });

const SOURCES = ["corridor", "route", "vessel-track", "track-lines", "track-points", "link"] as const;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function sceneBounds(scene: Scene): [LonLat, LonLat] | null {
  const pts: LonLat[] = [...scene.route, ...scene.track.map((p) => [p.lon, p.lat] as LonLat)];
  if (scene.position) pts.push([scene.position.lon, scene.position.lat]);
  if (scene.vessel) pts.push([scene.vessel.lon, scene.vessel.lat]);
  return bounds(pts);
}

function fit(map: MlMap, scene: Scene, variant: "full" | "preview", animate: boolean) {
  const b = sceneBounds(scene);
  if (!b) return;
  const [[w, s], [e, n]] = b;
  // room for the port labels above or below the dots, and for the controls on the right
  const size = map.getContainer().getBoundingClientRect();
  const x = Math.max(12, Math.min(variant === "preview" ? 56 : 52, size.width / 5));
  const y = Math.max(12, Math.min(40, size.height / 6));
  map.fitBounds([[w, s], [e, n]], { padding: { top: y, bottom: y, left: x, right: x }, maxZoom: 6.5, duration: animate && !reducedMotion() ? 700 : 0 });
}

const ICON_FIT = '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2.2M8 12.3v2.2M1.5 8h2.2M12.3 8h2.2"/></svg>';
const ICON_FULL = '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>';
const ICON_EXIT = '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4"/></svg>';

/**
 * "Fit the route" and "full screen" in one button group, styled like the zoom buttons. Full screen takes the
 * caller's element (the whole figure, with its replay bar), not just the canvas.
 */
class ToolsControl implements IControl {
  private el?: HTMLDivElement;
  private off?: () => void;
  constructor(private onFit: () => void, private target?: () => HTMLElement | null) {}
  private button(label: string, icon: string, onClick: () => void) {
    const b = document.createElement("button");
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.className = "cf-tool";
    b.innerHTML = icon;
    b.addEventListener("click", onClick);
    return b;
  }
  onAdd(map: MlMap) {
    const el = document.createElement("div");
    el.className = "maplibregl-ctrl maplibregl-ctrl-group";
    el.appendChild(this.button("Fit the route in view", ICON_FIT, this.onFit));
    const target = this.target?.() ?? map.getContainer();
    if (typeof document !== "undefined" && document.fullscreenEnabled) {
      const fs = this.button("Show the map full screen", ICON_FULL, () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void target.requestFullscreen?.().catch(() => {});
      });
      const sync = () => {
        const on = document.fullscreenElement === target;
        fs.innerHTML = on ? ICON_EXIT : ICON_FULL;
        const label = on ? "Exit full screen" : "Show the map full screen";
        fs.title = label;
        fs.setAttribute("aria-label", label);
        if (on) map.cooperativeGestures.disable();
        else map.cooperativeGestures.enable();
        map.resize();
      };
      document.addEventListener("fullscreenchange", sync);
      this.off = () => document.removeEventListener("fullscreenchange", sync);
      el.appendChild(fs);
    }
    this.el = el;
    return el;
  }
  onRemove() {
    this.off?.();
    this.el?.remove();
  }
}

function addLayers(map: MlMap) {
  for (const id of SOURCES) map.addSource(id, { type: "geojson", data: fc([]) });
  // the corridor: a line exactly 2 x deviation metres wide on the ground (w0 is its width in pixels at zoom 0)
  map.addLayer({
    id: "corridor",
    type: "line",
    source: "corridor",
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: {
      "line-color": C.corridor,
      "line-opacity": 0.17,
      "line-width": ["interpolate", ["exponential", 2], ["zoom"], 0, ["get", "w0"], 24, ["*", ["get", "w0"], 16777216]],
    },
  });
  map.addLayer({ id: "route-glow", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": C.route, "line-width": 5, "line-opacity": 0.14, "line-blur": 2 } });
  map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": C.route, "line-width": 1.6, "line-dasharray": [2.2, 1.6], "line-opacity": 0.95 } });
  map.addLayer({ id: "vessel-track", type: "line", source: "vessel-track", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": C.ais, "line-width": 1.4, "line-opacity": 0.55, "line-dasharray": [0.5, 2] } });
  map.addLayer({
    id: "track-lines",
    type: "line",
    source: "track-lines",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": ["case", ["get", "pass"], C.pass, C.fail], "line-width": 3, "line-opacity": 0.95 },
  });
  map.addLayer({
    id: "track-points",
    type: "circle",
    source: "track-points",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 2.5, 6, 4.5],
      "circle-color": ["case", ["get", "pass"], C.pass, C.fail],
      "circle-stroke-color": C.water,
      "circle-stroke-width": 1.2,
    },
  });
  map.addLayer({ id: "link", type: "line", source: "link", layout: { "line-cap": "round" }, paint: { "line-color": ["case", ["get", "warn"], C.paused, C.ais], "line-width": 1.6, "line-dasharray": [2, 2] } });
  map.addLayer({
    id: "replay-ring",
    type: "circle",
    source: "track-points",
    filter: ["==", ["get", "i"], -1],
    paint: { "circle-radius": 10, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": C.position, "circle-stroke-width": 2.5 },
  });
}

function el(className: string, html = ""): HTMLDivElement {
  const d = document.createElement("div");
  d.className = className;
  d.innerHTML = html;
  return d;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export default function MapView({ scene, corridorM = 0, replayIndex = null, paused, label, describedBy, variant = "full", fitKey, onFail, fullscreenTarget, className }: MapViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const cleanup = useRef<(() => void) | null>(null);
  const latest = useRef({ scene, variant });
  const failRef = useRef(onFail);
  const fullscreenRef = useRef(fullscreenTarget);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    latest.current = { scene, variant };
    failRef.current = onFail;
    fullscreenRef.current = fullscreenTarget;
  });

  // create the map once
  useEffect(() => {
    const container = box.current;
    if (!container) return;
    let map: MlMap;
    let done = false;
    const fail = (reason: string) => {
      if (done) return;
      done = true;
      failRef.current?.(reason);
    };
    try {
      map = new maplibregl.Map({
        container,
        style: cargoStyle(),
        center: [70, 15],
        zoom: 1.2,
        minZoom: 0.6,
        maxZoom: 14,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        cooperativeGestures: true,
        fadeDuration: reducedMotion() ? 0 : 200,
      });
    } catch {
      fail("webgl");
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ToolsControl(() => fit(map, latest.current.scene, latest.current.variant, true), variant === "full" ? () => fullscreenRef.current?.() ?? null : undefined), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-right");

    const canvas = map.getCanvas();
    canvas.setAttribute("aria-label", label);
    if (describedBy) canvas.setAttribute("aria-describedby", describedBy);

    // the base map counts as failed when its tiles never arrive: errors from the tile source and no tile loaded
    let tiles = 0, baseErrors = 0, loaded = false;
    map.on("sourcedata", (e) => {
      if (e.sourceId === "base" && (e as { tile?: unknown }).tile) tiles++;
    });
    map.on("error", (e) => {
      const src = (e as { sourceId?: string }).sourceId;
      if (src === "base" || /openfreemap/.test(String(e.error?.message ?? ""))) baseErrors++;
      if (!loaded && baseErrors > 0 && tiles === 0) setTimeout(() => tiles === 0 && fail("tiles"), 2500);
    });
    const giveUp = setTimeout(() => {
      if (!loaded || tiles === 0) fail(loaded ? "tiles" : "timeout");
    }, 15_000);
    map.on("load", () => {
      loaded = true;
      addLayers(map);
      setReady(true);
      fit(map, latest.current.scene, latest.current.variant, false);
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);
    return () => {
      done = true;
      clearTimeout(giveUp);
      ro.disconnect();
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // the map is created once; label and variant are read at creation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.getCanvas().setAttribute("aria-label", label);
  }, [label]);

  // draw the scene
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const set = (id: (typeof SOURCES)[number], data: ReturnType<typeof fc>) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never);

    set("corridor", fc(corridorRuns(scene.route, corridorM).map((r) => line(r.coords, { w0: r.w0 }))));
    set("route", fc(scene.route.length > 1 ? [line(scene.route)] : []));
    const t = scene.track;
    set("track-lines", fc(t.slice(1).map((p, i) => line([[t[i]!.lon, t[i]!.lat], [p.lon, p.lat]], { pass: p.pass, i: i + 1 }))));
    set("track-points", fc(t.map((p, i) => point([p.lon, p.lat], { pass: p.pass, committed: p.committed, i }))));
    const v = scene.vessel, pos = scene.position;
    set("vessel-track", fc(v && v.track.length > 1 ? [line(v.track)] : []));
    const warn = v?.agrees === false;
    set("link", fc(v && pos ? [line([[v.lon, v.lat], [pos.lon, pos.lat]], { warn })] : []));

    // HTML markers: ports, the latest position, the vessel and the gap between it and the logger
    markers.current.forEach((m) => m.remove());
    const add = (node: HTMLElement, at: LonLat, ariaLabel: string) => {
      node.setAttribute("role", "img");
      node.setAttribute("aria-label", ariaLabel);
      markers.current.push(new maplibregl.Marker({ element: node }).setLngLat(at).addTo(map));
    };
    markers.current = [];
    const lats = scene.route.map((c) => c[1]);
    const midLat = lats.length ? (Math.min(...lats) + Math.max(...lats)) / 2 : 0;
    for (const p of scene.ports) {
      const below = p.role !== "stop" && p.lat < midLat;
      const node = el(`cf-port cf-port--${p.role}${below ? " cf-port--below" : ""}`, `<span class="cf-port__dot"></span><span class="cf-port__label">${esc(p.name)}</span>`);
      add(node, [p.lon, p.lat], `${p.role === "stop" ? "Stop" : p.role === "origin" ? "Origin" : "Destination"}: ${p.name}`);
    }
    if (pos) {
      const node = el("cf-pos", '<span class="cf-pos__ring"></span><span class="cf-pos__core"></span>');
      node.style.setProperty("--cf-pos", paused ? C.paused : C.position);
      add(node, [pos.lon, pos.lat], "Latest logger position");
    }
    if (v) {
      const rot = v.cogDeg ?? 0;
      // the tag sits on the side away from the logger, so the two markers do not cover each other
      const tagRight = pos ? v.lon >= pos.lon : false;
      const node = el(
        `cf-ais${tagRight ? " cf-ais--right" : ""}`,
        `<svg viewBox="-9 -9 18 18" aria-hidden="true"><g transform="rotate(${rot})"><path d="M0 -8 L6 7 L0 4 L-6 7 Z" fill="${C.ais}" stroke="#0B1B2B" stroke-width="1.6" stroke-linejoin="round"/></g></svg><span class="cf-ais__tag">AIS</span>`,
      );
      add(node, [v.lon, v.lat], `AIS position of ${v.name}`);
      if (pos && v.gapKm !== null) {
        const gap = el(`cf-gap${warn ? " cf-gap--warn" : ""}`, formatKm(v.gapKm));
        add(gap, [(v.lon + pos.lon) / 2, (v.lat + pos.lat) / 2], `${formatKm(v.gapKm)} between the AIS position and the logger`);
        // the distance label and the dashed link only make sense once the two positions are apart on screen
        const sync = () => {
          const a = map.project([v.lon, v.lat]), b = map.project([pos.lon, pos.lat]);
          const far = Math.hypot(a.x - b.x, a.y - b.y) > 90;
          gap.style.visibility = far ? "visible" : "hidden";
          if (map.getLayer("link")) map.setLayoutProperty("link", "visibility", far ? "visible" : "none");
        };
        sync();
        map.on("zoom", sync);
        cleanup.current = () => map.off("zoom", sync);
      }
    }
    return () => {
      cleanup.current?.();
      cleanup.current = null;
    };
  }, [scene, corridorM, ready, paused, variant]);

  // replay: dim the track after the replayed point and ring it
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const idx = replayIndex ?? -1;
    const live = replayIndex === null;
    map.setPaintProperty("track-lines", "line-opacity", live ? 0.95 : ["case", ["<=", ["get", "i"], idx], 0.95, 0.22]);
    map.setPaintProperty("track-points", "circle-opacity", live ? 1 : ["case", ["<=", ["get", "i"], idx], 1, 0.3]);
    map.setPaintProperty("track-points", "circle-stroke-opacity", live ? 1 : ["case", ["<=", ["get", "i"], idx], 1, 0.3]);
    map.setFilter("replay-ring", ["==", ["get", "i"], idx]);
    const p = replayIndex !== null ? scene.track[replayIndex] : undefined;
    if (p && !map.getBounds().contains([p.lon, p.lat])) {
      if (reducedMotion()) map.jumpTo({ center: [p.lon, p.lat] });
      else map.easeTo({ center: [p.lon, p.lat], duration: 500 });
    }
  }, [replayIndex, ready, scene.track]);

  // refit when the caller says the route changed
  useEffect(() => {
    const map = mapRef.current;
    if (map && ready && fitKey !== undefined) fit(map, latest.current.scene, latest.current.variant, true);
  }, [fitKey, ready]);

  return <div ref={box} className={`cf-map relative h-full w-full ${className ?? ""}`} />;
}
