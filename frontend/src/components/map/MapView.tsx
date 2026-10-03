"use client";

// The MapLibre map itself. Loaded only in the browser (callers import it with next/dynamic and ssr: false), so
// nothing here runs during server rendering. It draws a Scene (route, ports, track, vessel) plus, on the shipment
// page, a VoyageOverlay (temperature band, milestones, pause, heading), and reports when the base map cannot load
// so the caller can fall back to the SVG sketch.

import maplibregl, { type GeoJSONSource, type IControl, type LayerSpecification, type Map as MlMap, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";
import { useEffect, useRef, useState } from "react";
import type { Scene, SceneTrackPoint } from "@/lib/geo/scene";
import { bounds, corridorRuns, formatKm, nearLon, type LonLat } from "@/lib/geo/route";
import { circleRing } from "@/lib/places";
import { loadLaneLines } from "@/lib/geo/searoute";
import { compass, cumulativeKm, graticule, projectOnRoute, routeUntil, tempClass, type Band, type MilestoneMark } from "@/lib/geo/voyage";
import { aisPopup, esc, milestonePopup, pausePopup, portPopup, trackPopup } from "./popup";
import { baseLayers, cargoStyle, PALETTES, type MapTheme, type Palette } from "./style";

/** What the shipment page adds on top of the scene. */
export type VoyageOverlay = {
  band: Band | null;
  milestones: (MilestoneMark & { amount?: string; releaseTx?: string })[];
  pause: { at: LonLat; reason: string; resumed: boolean; epochId?: string; time?: number } | null;
  /** heading (degrees) and speed (knots) of the latest position, when two fixes allow it */
  heading: number | null;
  speedKn: number | null;
  /** km along the route already covered (draws the solid part of the route) */
  doneKm: number | null;
  /** commit transaction per epoch id, for the tooltip's explorer link */
  epochTx: Record<string, string>;
  chainId?: number;
  /** "Open in the Evidence tab" in a tooltip, for epochs without a transaction link */
  onOpenEpoch?: (epochId: string, index: number) => void;
};

/** A milestone's place (contracts v2): a geodesic circle with a label at its northern edge. */
export type MapPlace = {
  key: string;
  lat: number;
  lon: number;
  radiusM: number;
  /** the tag on the map, e.g. "M5 · 100 km" */
  tag: string;
  /** accessible name of the tag */
  title: string;
  state: "released" | "next" | "held" | "paused" | "pending" | "draft";
  /** tooltip HTML (escaped by the caller); the tag is a button when set */
  popup?: string;
};

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
  theme?: MapTheme;
  voyage?: VoyageOverlay;
  /** draw the shipping-lane network faintly underneath (loads about 600 kB on first use) */
  showLanes?: boolean;
  /** refits the view whenever this changes (the wizard passes the route's identity) */
  fitKey?: string;
  onFail?: (reason: string) => void;
  /** the element to show full screen (defaults to the map) */
  fullscreenTarget?: () => HTMLElement | null;
  /** milestone places to draw as circles */
  places?: MapPlace[];
  /** called with the clicked point while picking a place (the cursor becomes a crosshair) */
  onPick?: (at: LonLat) => void;
  className?: string;
};

type Geometry = { type: "LineString"; coordinates: LonLat[] } | { type: "MultiLineString"; coordinates: LonLat[][] } | { type: "Point"; coordinates: LonLat } | { type: "Polygon"; coordinates: LonLat[][] };
type Feature = { type: "Feature"; properties: Record<string, unknown>; geometry: Geometry };
const fc = (features: Feature[]) => ({ type: "FeatureCollection" as const, features });
const line = (coordinates: LonLat[], properties: Record<string, unknown> = {}): Feature => ({ type: "Feature", properties, geometry: { type: "LineString", coordinates } });
const point = (coordinates: LonLat, properties: Record<string, unknown> = {}): Feature => ({ type: "Feature", properties, geometry: { type: "Point", coordinates } });

const SOURCES = ["graticule", "lanes", "corridor", "places", "route", "route-done", "vessel-track", "track-lines", "track-points", "link"] as const;
type SourceId = (typeof SOURCES)[number];

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
  // room for the port labels, the progress card at the top and the legend at the bottom
  const size = map.getContainer().getBoundingClientRect();
  const x = Math.max(16, Math.min(variant === "preview" ? 56 : 80, size.width / (variant === "preview" ? 6 : 4.5)));
  const top = variant === "full" ? Math.max(28, Math.min(124, size.height / 3.2)) : Math.max(12, Math.min(40, size.height / 6));
  const bottom = variant === "full" ? Math.max(20, Math.min(40, size.height / 8)) : top;
  map.fitBounds([[w, s], [e, n]], { padding: { top, bottom, left: x, right: x + (variant === "full" ? 24 : 0) }, maxZoom: 6.5, duration: animate && !reducedMotion() ? 700 : 0 });
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

/** A chevron drawn once as an SDF icon, so its colour follows the theme through icon-color. */
function addArrowIcon(map: MlMap) {
  if (map.hasImage("cf-arrow")) return;
  const s = 24;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 3.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(8, 6);
  ctx.lineTo(15, 12);
  ctx.lineTo(8, 18);
  ctx.stroke();
  const img = ctx.getImageData(0, 0, s, s);
  map.addImage("cf-arrow", { width: s, height: s, data: new Uint8Array(img.data.buffer) }, { sdf: true, pixelRatio: 2 });
}

const tempColor = (p: Palette) => ["match", ["get", "cls"], "out", p.tempOut, "near", p.tempNear, p.tempIn] as unknown as string;

const placeColor = (p: Palette, part: "fill" | "line") =>
  ["match", ["get", "state"], "released", p.released, "paused", p.paused, "next", part === "fill" ? "#C6F432" : p.routeDone, "held", part === "fill" ? "#C6F432" : p.routeDone, p.route] as unknown as string;

/** The shipment layers for a palette. Opacity that the replay controls is left out, so a theme switch keeps it. */
function dataLayers(p: Palette): LayerSpecification[] {
  return [
    { id: "graticule", type: "line", source: "graticule", paint: { "line-color": p.graticule, "line-width": 0.5, "line-opacity": 0.35 } },
    { id: "lanes", type: "line", source: "lanes", layout: { "line-join": "round" }, paint: { "line-color": p.lanes, "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 6, 0.9], "line-opacity": 0.45, "line-dasharray": [3, 2] } },
    // the corridor: a line exactly 2 x deviation metres wide on the ground (w0 is its width in pixels at zoom 0)
    {
      id: "corridor",
      type: "line",
      source: "corridor",
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": p.corridor, "line-opacity": 0.14, "line-width": ["interpolate", ["exponential", 2], ["zoom"], 0, ["get", "w0"], 24, ["*", ["get", "w0"], 16777216]] },
    },
    // milestone places: a tinted disc with a solid edge (dashed while the milestone is still ahead)
    { id: "places-fill", type: "fill", source: "places", paint: { "fill-color": placeColor(p, "fill"), "fill-opacity": ["match", ["get", "state"], "next", 0.22, "held", 0.22, 0.12] as unknown as number } },
    { id: "places-line", type: "line", source: "places", filter: ["!", ["get", "dashed"]], paint: { "line-color": placeColor(p, "line"), "line-width": 1.8, "line-opacity": 0.9 } },
    { id: "places-line-dash", type: "line", source: "places", filter: ["get", "dashed"], paint: { "line-color": placeColor(p, "line"), "line-width": 1.5, "line-opacity": 0.85, "line-dasharray": [2, 1.6] } },
    { id: "route-casing", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": p.routeCasing, "line-width": 4.5, "line-opacity": 0.85 } },
    { id: "route", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": p.route, "line-width": 1.8, "line-dasharray": [2.4, 1.8] } },
    { id: "route-done", type: "line", source: "route-done", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": p.routeDone, "line-width": 2.4, "line-opacity": 0.9 } },
    {
      id: "route-arrows",
      type: "symbol",
      source: "route",
      layout: { "symbol-placement": "line", "symbol-spacing": 150, "icon-image": "cf-arrow", "icon-size": 0.85, "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true },
      paint: { "icon-color": p.route, "icon-halo-color": p.routeCasing, "icon-halo-width": 1.5 },
    },
    { id: "vessel-track", type: "line", source: "vessel-track", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": p.ais, "line-width": 1.6, "line-opacity": 0.7, "line-dasharray": [0.4, 1.8] } },
    { id: "track-casing", type: "line", source: "track-lines", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": p.pointStroke, "line-width": 5.5 } },
    { id: "track-lines", type: "line", source: "track-lines", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": tempColor(p), "line-width": 3 } },
    {
      id: "track-points",
      type: "circle",
      source: "track-points",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3, 6, 5],
        // committed epochs are filled; ones not yet on chain are hollow
        "circle-color": ["case", ["get", "committed"], tempColor(p), p.pointStroke],
        "circle-stroke-color": ["case", ["get", "committed"], p.pointStroke, tempColor(p)],
        "circle-stroke-width": ["case", ["get", "committed"], 1.5, 2],
      },
    },
    { id: "link", type: "line", source: "link", layout: { "line-cap": "round" }, paint: { "line-color": ["match", ["get", "state"], "warn", p.paused, "idle", p.linkIdle, p.ais] as unknown as string, "line-width": 1.6, "line-dasharray": [2, 2] } },
    { id: "hover-ring", type: "circle", source: "track-points", filter: ["==", ["get", "i"], -1], paint: { "circle-radius": 9, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": p.routeDone, "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.6 } },
    { id: "replay-ring", type: "circle", source: "track-points", filter: ["==", ["get", "i"], -1], paint: { "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": p.routeDone, "circle-stroke-width": 2.5 } },
  ];
}

function addLayers(map: MlMap, theme: MapTheme) {
  for (const id of SOURCES) map.addSource(id, { type: "geojson", data: fc([]) });
  addArrowIcon(map);
  for (const l of dataLayers(PALETTES[theme])) map.addLayer(l);
}

/** Switches theme in place: same layers, new paint, so the shipment layers and the view survive. */
function repaint(map: MlMap, theme: MapTheme) {
  for (const l of [...baseLayers(theme), ...dataLayers(PALETTES[theme])]) {
    if (!map.getLayer(l.id) || !("paint" in l) || !l.paint) continue;
    for (const [k, v] of Object.entries(l.paint)) map.setPaintProperty(l.id, k, v);
  }
}

function el(tag: "div" | "button", className: string, html = ""): HTMLElement {
  const d = document.createElement(tag);
  d.className = className;
  d.innerHTML = html;
  if (tag === "button") (d as HTMLButtonElement).type = "button";
  return d;
}

const kmLabel = (km: number) => `km ${Math.round(km).toLocaleString("en-US")}`;

export default function MapView({ scene, corridorM = 0, replayIndex = null, paused, label, describedBy, variant = "full", theme = "light", voyage, showLanes, fitKey, onFail, fullscreenTarget, places, onPick, className }: MapViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const cleanup = useRef<(() => void) | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const pinned = useRef(false);
  const showRef = useRef<((at: LonLat, html: string) => void) | null>(null);
  const latest = useRef({ scene, variant, voyage });
  const failRef = useRef(onFail);
  const fullscreenRef = useRef(fullscreenTarget);
  const themeAtStart = useRef(theme);
  const pickRef = useRef(onPick);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    latest.current = { scene, variant, voyage };
    failRef.current = onFail;
    fullscreenRef.current = fullscreenTarget;
    pickRef.current = onPick;
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
        style: cargoStyle(themeAtStart.current),
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
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    if (variant === "full") map.addControl(new maplibregl.ScaleControl({ unit: "nautical", maxWidth: 90 }), "bottom-left");

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

    // tooltips: hover shows one, a click or tap pins it (with a close button) so its link can be used
    const show = (at: LonLat, html: string, pin: boolean) => {
      popup.current?.remove();
      pinned.current = pin;
      const p = new maplibregl.Popup({ closeButton: pin, closeOnClick: true, maxWidth: "280px", offset: 12, className: "cf-popup", focusAfterOpen: pin })
        .setLngLat(at)
        .setHTML(html)
        .addTo(map);
      p.on("close", () => {
        if (popup.current === p) {
          popup.current = null;
          pinned.current = false;
        }
      });
      p.getElement()
        ?.querySelectorAll<HTMLButtonElement>("button[data-epoch]")
        .forEach((b) =>
          b.addEventListener("click", () => {
            const id = b.dataset.epoch!;
            const idx = latest.current.scene.track.findIndex((t) => t.epochId === id);
            latest.current.voyage?.onOpenEpoch?.(id, idx);
            p.remove();
          }),
        );
      popup.current = p;
    };
    const trackHtml = (i: number) => {
      const { scene: s, voyage: v } = latest.current;
      const t = s.track[i];
      if (!t) return null;
      const band = v?.band ?? null;
      const along = s.route.length > 1 ? projectOnRoute(s.route, [t.lon, t.lat])?.alongKm ?? null : null;
      return { at: [t.lon, t.lat] as LonLat, html: trackPopup(t, tempClass(t.minTempX100, t.maxTempX100, band), band, along, v?.epochTx[t.epochId], v?.chainId) };
    };
    const onTrack = (pin: boolean) => (e: MapLayerMouseEvent) => {
      const i = Number(e.features?.[0]?.properties?.i);
      if (!Number.isFinite(i)) return;
      if (!pin && pinned.current) return;
      const c = trackHtml(i);
      if (!c) return;
      map.setFilter("hover-ring", ["==", ["get", "i"], i]);
      show(c.at, c.html, pin);
    };
    showRef.current = (at: LonLat, html: string) => show(at, html, true);

    map.on("load", () => {
      loaded = true;
      // the compact attribution starts expanded on wide maps: fold it to its (i) button
      container.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show")?.classList.remove("maplibregl-compact-show");
      addLayers(map, themeAtStart.current);
      map.on("mousemove", "track-points", onTrack(false));
      map.on("click", "track-points", (e) => {
        e.preventDefault();
        onTrack(true)(e);
      });
      map.on("click", (e) => pickRef.current?.([e.lngLat.lng, e.lngLat.lat]));
      map.on("mouseenter", "track-points", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "track-points", () => {
        map.getCanvas().style.cursor = "";
        map.setFilter("hover-ring", ["==", ["get", "i"], -1]);
        if (!pinned.current) popup.current?.remove();
      });
      setReady(true);
      fit(map, latest.current.scene, latest.current.variant, false);
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);
    return () => {
      done = true;
      clearTimeout(giveUp);
      ro.disconnect();
      popup.current?.remove();
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // the map is created once; label, variant and the first theme are read at creation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.getCanvas().setAttribute("aria-label", label);
  }, [label]);

  // theme: repaint in place
  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) repaint(map, theme);
  }, [theme, ready]);

  // picking a place: a crosshair over the map
  const picking = !!onPick;
  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) map.getCanvas().style.cursor = picking ? "crosshair" : "";
  }, [picking, ready]);

  // the lane network, once, in the background
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !showLanes) return;
    let live = true;
    const idle = (cb: () => void) => (typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(cb, { timeout: 2500 }) : window.setTimeout(cb, 600));
    idle(() => {
      loadLaneLines()
        .then((lines) => {
          if (!live || !map.getSource("lanes")) return;
          (map.getSource("lanes") as GeoJSONSource).setData({ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: lines } } as never);
        })
        .catch(() => {
          /* context only: the map is complete without it */
        });
    });
    return () => {
      live = false;
    };
  }, [ready, showLanes]);

  // draw the scene
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const pal = PALETTES[theme];
    const set = (id: SourceId, data: unknown) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as never);
    const band = voyage?.band ?? null;
    const route = scene.route;
    const cum = cumulativeKm(route);
    const totalKm = cum.at(-1) ?? 0;

    if (variant === "full") {
      const b = sceneBounds(scene);
      set("graticule", fc(b ? graticule(10, b[0][0] - 90, b[1][0] + 90).map((l) => line(l)) : []));
    }
    set("corridor", fc(corridorRuns(route, corridorM).map((r) => line(r.coords, { w0: r.w0 }))));
    set("route", fc(route.length > 1 ? [line(route)] : []));
    const done = voyage?.doneKm != null ? routeUntil(route, voyage.doneKm, cum) : [];
    set("route-done", fc(done.length > 1 ? [line(done)] : []));
    const t = scene.track;
    const cls = (p: SceneTrackPoint) => tempClass(p.minTempX100, p.maxTempX100, band);
    set("track-lines", fc(t.slice(1).map((p, i) => line([[t[i]!.lon, t[i]!.lat], [p.lon, p.lat]], { cls: cls(p), i: i + 1 }))));
    set("track-points", fc(t.map((p, i) => point([p.lon, p.lat], { cls: cls(p), committed: p.committed, pass: p.pass, i }))));
    // milestone places on the same copy of the world as the route
    const lons = route.map((c) => c[0]);
    const ref = lons.length ? (Math.min(...lons) + Math.max(...lons)) / 2 : 0;
    const rings = (places ?? []).map((pl) => ({ pl, ring: circleRing(pl.lat, nearLon(pl.lon, ref), pl.radiusM) }));
    set("places", fc(rings.map(({ pl, ring }) => ({ type: "Feature", properties: { state: pl.state, dashed: pl.state === "pending" || pl.state === "draft" }, geometry: { type: "Polygon", coordinates: [ring] } }))));
    const v = scene.vessel, pos = scene.position;
    set("vessel-track", fc(v && v.track.length > 1 ? [line(v.track)] : []));
    const linkState = !v?.comparable ? "idle" : v.agrees === false ? "warn" : "ok";
    set("link", fc(v && pos ? [line([[v.lon, v.lat], [pos.lon, pos.lat]], { state: linkState })] : []));

    // HTML markers: ports, milestones, the pause, the latest position, the vessel and the gap
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    const showPopup = showRef.current;
    const add = (node: HTMLElement, at: LonLat, ariaLabel: string, html?: string, anchor: maplibregl.PositionAnchor = "center") => {
      if (html && showPopup) {
        node.setAttribute("aria-label", `${ariaLabel}. Show details`);
        node.addEventListener("click", (e) => {
          e.stopPropagation();
          showPopup(at, html);
        });
      } else {
        node.setAttribute("role", "img");
        node.setAttribute("aria-label", ariaLabel);
      }
      markers.current.push(new maplibregl.Marker({ element: node, anchor }).setLngLat(at).addTo(map));
    };
    const lats = route.map((c) => c[1]);
    const midLat = lats.length ? (Math.min(...lats) + Math.max(...lats)) / 2 : 0;
    const full = variant === "full";
    for (const p of scene.ports) {
      const below = p.role !== "stop" && p.lat < midLat;
      const along = route.length > 1 ? (projectOnRoute(route, [p.lon, p.lat], cum)?.alongKm ?? 0) : 0;
      const meta = full && p.role !== "origin" ? `<small>${p.role === "stop" ? kmLabel(along) : formatKm(totalKm)}</small>` : p.code && full ? `<small>${esc(p.code)}</small>` : "";
      const node = el(full ? "button" : "div", `cf-port cf-port--${p.role}${below ? " cf-port--below" : ""}`, `<span class="cf-port__dot"></span><span class="cf-port__label">${esc(p.name)}${meta}</span>`);
      const role = p.role === "stop" ? "Transshipment stop" : p.role === "origin" ? "Origin" : "Destination";
      add(node, [p.lon, p.lat], `${role}: ${p.name}`, full ? portPopup(p.name, p.code, p.role, along, totalKm) : undefined);
    }

    for (const { pl, ring } of rings) {
      const node = el(pl.popup ? "button" : "div", `cf-place cf-place--${pl.state}`, `<span class="cf-place__tag">${esc(pl.tag)}</span>`);
      add(node, ring[0]!, pl.title, pl.popup, "bottom");
    }

    if (voyage) {
      for (const m of voyage.milestones) {
        const glyph = m.state === "released" ? "✓" : m.state === "paused" ? "!" : String(m.index + 1);
        const node = el("button", `cf-ms cf-ms--${m.state}${m.planned ? " cf-ms--planned" : ""}`, `<span class="cf-ms__badge">${glyph}</span><span class="cf-ms__tag">M${m.index + 1}</span>`);
        const what = { released: "released", paused: "blocked, facility paused", next: "awaiting evidence", pending: "pending" }[m.state];
        add(node, m.at, `Milestone ${m.index + 1}, ${what}, ${kmLabel(m.alongKm)}`, milestonePopup(m, m.amount, m.releaseTx, m.epochId ? voyage.epochTx[m.epochId] : undefined, voyage.chainId));
      }
      const pz = voyage.pause;
      if (pz) {
        const node = el(
          "button",
          `cf-pause${pz.resumed ? " cf-pause--resumed" : ""}`,
          `<svg viewBox="0 0 16 20" aria-hidden="true"><path d="M3 19V2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3.6 2.6h9.2l-2.4 3.6 2.4 3.6H3.6z" fill="currentColor"/></svg><span class="cf-pause__tag">${pz.resumed ? "Paused · resumed" : "Paused"}</span>`,
        );
        add(node, pz.at, `Facility ${pz.resumed ? "was paused here and has resumed" : "paused here"}: ${pz.reason}`, pausePopup(pz.reason, pz.resumed, pz.time, pz.epochId, pz.epochId ? voyage.epochTx[pz.epochId] : undefined, voyage.chainId), "bottom-left");
      }
    }

    if (pos) {
      const heading = voyage?.heading ?? null;
      const speed = voyage?.speedKn ?? null;
      const tag = full && (heading !== null || speed !== null) ? `<span class="cf-pos__tag">${speed !== null ? `${speed.toFixed(1)} kn` : ""}${speed !== null && heading !== null ? " · " : ""}${heading !== null ? compass(heading) : ""}</span>` : "";
      const node = el(
        "div",
        `cf-pos${paused ? " cf-pos--paused" : ""}`,
        `<span class="cf-pos__ring"></span>${heading !== null ? `<svg class="cf-pos__heading" viewBox="-12 -12 24 24" aria-hidden="true"><g transform="rotate(${heading.toFixed(0)})"><path d="M0 -11 L4.5 -4 L-4.5 -4 Z"/></g></svg>` : ""}<span class="cf-pos__core"></span>${tag}`,
      );
      add(node, [pos.lon, pos.lat], `Latest logger position${speed !== null ? `, ${speed.toFixed(1)} knots` : ""}${heading !== null ? ` heading ${compass(heading)}` : ""}`);
    }
    if (v) {
      const rot = v.cogDeg ?? 0;
      // the tag sits on the side away from the logger (above or below), so the markers and the track stay clear
      const tagBelow = pos ? v.lat < pos.lat : false;
      const sog = v.sogKn !== null ? `, ${v.sogKn.toFixed(1)} knots` : "";
      const node = el(
        full ? "button" : "div",
        `cf-ais${tagBelow ? " cf-ais--below" : ""}`,
        `<svg viewBox="-10 -10 20 20" aria-hidden="true"><g transform="rotate(${rot})"><path d="M0 -9 L5 6 L0 3.5 L-5 6 Z" fill="${pal.ais}" stroke="${pal.pointStroke}" stroke-width="1.6" stroke-linejoin="round"/></g></svg><span class="cf-ais__tag">${esc(v.name)}</span>`,
      );
      add(node, [v.lon, v.lat], `AIS position of ${v.name}${sog}`, full ? aisPopup(v, linkState) : undefined);
      if (pos && v.gapKm !== null) {
        const gap = el("div", `cf-gap cf-gap--${linkState}`, `${formatKm(v.gapKm)}${linkState === "idle" ? " · not compared" : linkState === "warn" ? " · disagrees" : ""}`);
        add(gap, [(v.lon + pos.lon) / 2, (v.lat + pos.lat) / 2], `${formatKm(v.gapKm)} between the AIS position and the logger${linkState === "idle" ? ", not compared" : ""}`);
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

    // keep labels from piling up where the track is dense: the AIS name flips to the other side of its icon, or
    // hides, when it would cover a port, the pause flag or the position; milestone tags hide when they would collide
    const container = map.getContainer();
    const hit = (a: DOMRect, b: DOMRect) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
    const declutter = () => {
      const fixed = [...container.querySelectorAll<HTMLElement>(".cf-pos__tag, .cf-pos__core, .cf-port__label")].map((e) => e.getBoundingClientRect());
      const pause = container.querySelector<HTMLElement>(".cf-pause");
      const ptag = pause?.querySelector<HTMLElement>(".cf-pause__tag");
      if (pause && ptag) {
        // the side of the flag whose tag covers fewer markers (right on a tie)
        const others = [...fixed, ...[...container.querySelectorAll<HTMLElement>(".cf-ms__badge, .cf-ais svg")].map((e) => e.getBoundingClientRect())];
        // try right, left, then both raised above the flag; keep the first spot with the fewest clashes
        const spots = [[], ["cf-pause--left"], ["cf-pause--high"], ["cf-pause--left", "cf-pause--high"]];
        let best = spots[0]!, fewest = Infinity;
        for (const cls of spots) {
          pause.classList.remove("cf-pause--left", "cf-pause--high");
          pause.classList.add(...cls);
          const n = others.filter((b) => hit(ptag.getBoundingClientRect(), b)).length;
          if (n < fewest) {
            fewest = n;
            best = cls;
          }
          if (n === 0) break;
        }
        pause.classList.remove("cf-pause--left", "cf-pause--high");
        pause.classList.add(...best);
      }
      const blockers = [...fixed, ...[...container.querySelectorAll<HTMLElement>(".cf-pause__tag, .cf-pause svg")].map((e) => e.getBoundingClientRect())];
      const ais = container.querySelector<HTMLElement>(".cf-ais");
      const tag = ais?.querySelector<HTMLElement>(".cf-ais__tag");
      if (ais && tag) {
        tag.style.visibility = "";
        const clashes = () => blockers.some((b) => hit(tag.getBoundingClientRect(), b));
        if (clashes()) {
          ais.classList.toggle("cf-ais--below");
          if (clashes()) {
            ais.classList.toggle("cf-ais--below");
            tag.style.visibility = "hidden";
          }
        }
        blockers.push(tag.getBoundingClientRect());
      }
      container.querySelectorAll<HTMLElement>(".cf-ms__tag").forEach((t) => {
        t.style.visibility = "";
        const r = t.getBoundingClientRect();
        if (blockers.some((b) => hit(r, b))) t.style.visibility = "hidden";
        else blockers.push(r);
      });
    };
    const frame = requestAnimationFrame(declutter);
    map.on("moveend", declutter);
    const prev = cleanup.current;
    cleanup.current = () => {
      prev?.();
      cancelAnimationFrame(frame);
      map.off("moveend", declutter);
    };
    return () => {
      cleanup.current?.();
      cleanup.current = null;
    };
  }, [scene, corridorM, ready, paused, variant, voyage, theme, places]);

  // replay: dim the track after the replayed point and ring it
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const idx = replayIndex ?? -1;
    const live = replayIndex === null;
    const o = (on: number, off: number) => (live ? on : ["case", ["<=", ["get", "i"], idx], on, off]);
    map.setPaintProperty("track-lines", "line-opacity", o(0.95, 0.2));
    map.setPaintProperty("track-casing", "line-opacity", o(0.9, 0.2));
    map.setPaintProperty("track-points", "circle-opacity", o(1, 0.25));
    map.setPaintProperty("track-points", "circle-stroke-opacity", o(1, 0.25));
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

  // the theme goes in a data attribute: MapLibre adds its own classes to this element, which a className change would drop
  return <div ref={box} data-theme={theme} className={`cf-map relative h-full w-full ${className ?? ""}`} />;
}
