import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";

// CargoFlow's chart styles over OpenFreeMap's OpenMapTiles vector tiles. "light" (the default) is a paper chart:
// off-white land, soft blue-grey sea, a faint graticule, borders, sea and country names, major cities. "dark" is the
// older navy chart. Either way the base map stays quiet so the shipment's own layers carry the colour.
// The tiles carry no bathymetry, so the sea is one flat tint. Base-map labels use Noto Sans (the glyphs OpenFreeMap
// serves); everything CargoFlow draws in HTML (ports, milestones, tooltips) uses the app's Inter.

export type MapTheme = "light" | "dark";

export type Palette = {
  // base map
  water: string;
  land: string;
  landAlt: string;
  urban: string;
  ice: string;
  road: string;
  border: string;
  borderSub: string;
  label: string;
  labelStrong: string;
  labelHalo: string;
  sea: string;
  graticule: string;
  // shipment layers
  lanes: string;
  route: string;
  routeDone: string;
  routeCasing: string;
  corridor: string;
  tempIn: string;
  tempNear: string;
  tempOut: string;
  pointStroke: string;
  position: string;
  positionRing: string;
  paused: string;
  ais: string;
  linkIdle: string;
  released: string;
};

export const PALETTES: Record<MapTheme, Palette> = {
  light: {
    water: "#D5E3EC",
    land: "#F7F9F4",
    landAlt: "#EEF2E8",
    urban: "#ECEEE7",
    ice: "#FFFFFF",
    road: "#E2E5DD",
    border: "#A9B7B2",
    borderSub: "#D3DAD4",
    label: "#5B6B7B",
    labelStrong: "#2B3B4B",
    labelHalo: "#F7F9F4",
    sea: "#6A8BA3",
    graticule: "#9FB6C6",
    lanes: "#8FAABC",
    route: "#4A6680",
    routeDone: "#0B1B2B",
    routeCasing: "#FFFFFF",
    corridor: "#1E9C8F",
    tempIn: "#2563EB",
    tempNear: "#E08A00",
    tempOut: "#D92D20",
    pointStroke: "#FFFFFF",
    position: "#0B1B2B",
    positionRing: "#7FB800",
    paused: "#E08A00",
    ais: "#7C3AED",
    linkIdle: "#94A3B8",
    released: "#00A85A",
  },
  dark: {
    water: "#0A1828",
    land: "#16304A",
    landAlt: "#183450",
    urban: "#1A3753",
    ice: "#1D3B57",
    road: "#1F3D5A",
    border: "#2F5677",
    borderSub: "#25486A",
    label: "#8FA8BE",
    labelStrong: "#C9D8E5",
    labelHalo: "#0A1828",
    sea: "#3B6687",
    graticule: "#3B6687",
    lanes: "#3B6687",
    route: "#9FD8E6",
    routeDone: "#E6F4F8",
    routeCasing: "#0A1828",
    corridor: "#4FC3B5",
    tempIn: "#5AA9FF",
    tempNear: "#FFB020",
    tempOut: "#FF5A5F",
    pointStroke: "#0A1828",
    position: "#C6F432",
    positionRing: "#C6F432",
    paused: "#FFB020",
    ais: "#B79CFF",
    linkIdle: "#6B7F93",
    released: "#00C46A",
  },
};

/** The light palette, for callers that only need a swatch colour. */
export const MAP_COLORS = PALETTES.light;

export const TILEJSON_URL = "https://tiles.openfreemap.org/planet";

const name: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]];

/** The base map's layers for a theme. Ids are stable across themes, so a theme switch only repaints them. */
export function baseLayers(theme: MapTheme): LayerSpecification[] {
  const c = PALETTES[theme];
  return [
    { id: "land", type: "background", paint: { "background-color": c.land } },
    {
      id: "landcover",
      type: "fill",
      source: "base",
      "source-layer": "landcover",
      filter: ["in", ["get", "class"], ["literal", ["wood", "grass", "farmland", "sand"]]],
      paint: { "fill-color": c.landAlt, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 2, 0.5, 8, 0.8] },
    },
    {
      id: "ice",
      type: "fill",
      source: "base",
      "source-layer": "landcover",
      maxzoom: 8,
      filter: ["in", ["get", "subclass"], ["literal", ["glacier", "ice_shelf"]]],
      paint: { "fill-color": c.ice, "fill-opacity": 0.8 },
    },
    {
      id: "urban",
      type: "fill",
      source: "base",
      "source-layer": "landuse",
      minzoom: 5,
      filter: ["in", ["get", "class"], ["literal", ["residential", "industrial", "commercial"]]],
      paint: { "fill-color": c.urban, "fill-opacity": 0.9 },
    },
    {
      id: "harbour",
      type: "fill",
      source: "base",
      "source-layer": "landuse",
      minzoom: 7,
      filter: ["in", ["get", "class"], ["literal", ["industrial", "railway"]]],
      paint: { "fill-color": c.road, "fill-opacity": 0.6 },
    },
    {
      id: "water",
      type: "fill",
      source: "base",
      "source-layer": "water",
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: { "fill-color": c.water, "fill-antialias": false },
    },
    {
      id: "rivers",
      type: "line",
      source: "base",
      "source-layer": "waterway",
      minzoom: 5,
      filter: ["==", ["get", "class"], "river"],
      paint: { "line-color": c.water, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 12, 2] },
    },
    {
      id: "roads",
      type: "line",
      source: "base",
      "source-layer": "transportation",
      minzoom: 5,
      filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk"]]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": c.road, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 2] },
    },
    {
      id: "borders-sub",
      type: "line",
      source: "base",
      "source-layer": "boundary",
      minzoom: 4,
      filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": c.borderSub, "line-width": 0.6, "line-dasharray": [3, 2] },
    },
    {
      id: "borders",
      type: "line",
      source: "base",
      "source-layer": "boundary",
      filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
      layout: { "line-join": "round" },
      paint: {
        "line-color": c.border,
        "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.5, 6, 1.1],
        "line-dasharray": ["case", ["==", ["get", "disputed"], 1], ["literal", [2, 2]], ["literal", [1, 0]]],
      },
    },
    {
      id: "sea-names",
      type: "symbol",
      source: "base",
      "source-layer": "water_name",
      filter: ["all", ["==", ["geometry-type"], "Point"], ["in", ["get", "class"], ["literal", ["ocean", "sea", "bay", "strait"]]]],
      layout: {
        "text-field": name,
        "text-font": ["Noto Sans Italic"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 1, ["match", ["get", "class"], "ocean", 11, 9.5], 6, ["match", ["get", "class"], "ocean", 15, 12]],
        "text-letter-spacing": 0.14,
        "text-max-width": 7,
        "text-transform": ["match", ["get", "class"], "ocean", "uppercase", "none"],
      },
      paint: { "text-color": c.sea, "text-halo-color": c.water, "text-halo-width": 0.8 },
    },
    {
      id: "country-names",
      type: "symbol",
      source: "base",
      "source-layer": "place",
      minzoom: 1.5,
      maxzoom: 9,
      filter: ["==", ["get", "class"], "country"],
      layout: {
        "text-field": name,
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 2, 9, 6, 12.5],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.16,
        "text-max-width": 7,
      },
      paint: { "text-color": c.label, "text-halo-color": c.labelHalo, "text-halo-width": 1.4, "text-opacity": 0.75 },
    },
    {
      id: "city-names",
      type: "symbol",
      source: "base",
      "source-layer": "place",
      minzoom: 3,
      filter: ["all", ["==", ["get", "class"], "city"], ["<=", ["coalesce", ["get", "rank"], 99], ["step", ["zoom"], 3, 5, 6, 7, 10]]],
      layout: {
        "text-field": name,
        "text-font": ["case", ["==", ["get", "capital"], 2], ["literal", ["Noto Sans Bold"]], ["literal", ["Noto Sans Regular"]]],
        "text-size": ["interpolate", ["linear"], ["zoom"], 3, 10, 8, 13],
        "text-max-width": 7,
      },
      paint: { "text-color": c.labelStrong, "text-halo-color": c.labelHalo, "text-halo-width": 1.3, "text-opacity": 0.8 },
    },
  ];
}

export function cargoStyle(theme: MapTheme = "light"): StyleSpecification {
  return {
    version: 8,
    name: `CargoFlow chart (${theme})`,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: { base: { type: "vector", url: TILEJSON_URL } },
    layers: baseLayers(theme),
  };
}

const KEY = "cargoflow:map-theme";
let chosen: MapTheme | null = null; // this page's choice, for when storage is unavailable

/** The viewer's chosen map theme, light unless they picked dark. Storage can be unavailable: then light. */
export function readTheme(): MapTheme {
  if (chosen) return chosen;
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function saveTheme(t: MapTheme) {
  chosen = t;
  try {
    window.localStorage.setItem(KEY, t);
  } catch {
    /* private mode or blocked storage: the choice lasts for this page only */
  }
}
