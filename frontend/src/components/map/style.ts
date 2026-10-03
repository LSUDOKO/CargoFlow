import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";

// CargoFlow's chart style over OpenFreeMap's OpenMapTiles vector tiles: dark navy sea, a slightly lighter land
// mass, faint borders and country names, nothing else. The shipment's own layers (route, corridor, track) carry
// the colour; the base map stays quiet underneath them.

export const MAP_COLORS = {
  water: "#0A1828",
  land: "#16304A",
  ice: "#1D3B57",
  border: "#2F5677",
  label: "#8FA8BE",
  labelHalo: "#0A1828",
  sea: "#3B6687",
  route: "#9FD8E6",
  corridor: "#4FC3B5",
  pass: "#00C46A",
  fail: "#FF5A5F",
  pending: "#9FB3C4",
  position: "#C6F432",
  paused: "#FFB020",
  ais: "#7CC7FF",
} as const;

export const TILEJSON_URL = "https://tiles.openfreemap.org/planet";

const name: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]];

export function cargoStyle(): StyleSpecification {
  const c = MAP_COLORS;
  return {
    version: 8,
    name: "CargoFlow chart",
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: { base: { type: "vector", url: TILEJSON_URL } },
    layers: [
      { id: "land", type: "background", paint: { "background-color": c.land } },
      {
        id: "ice",
        type: "fill",
        source: "base",
        "source-layer": "landcover",
        maxzoom: 8,
        filter: ["in", ["get", "subclass"], ["literal", ["glacier", "ice_shelf"]]],
        paint: { "fill-color": c.ice, "fill-opacity": 0.6 },
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
        minzoom: 6,
        filter: ["==", ["get", "class"], "river"],
        paint: { "line-color": c.water, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 12, 2] },
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
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 6, 1.1],
          "line-dasharray": ["case", ["==", ["get", "disputed"], 1], ["literal", [2, 2]], ["literal", [1, 0]]],
        },
      },
      {
        id: "sea-names",
        type: "symbol",
        source: "base",
        "source-layer": "water_name",
        filter: ["all", ["==", ["geometry-type"], "Point"], ["in", ["get", "class"], ["literal", ["ocean", "sea"]]]],
        layout: {
          "text-field": name,
          "text-font": ["Noto Sans Italic"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 1, 10, 6, 13],
          "text-letter-spacing": 0.08,
          "text-max-width": 8,
        },
        paint: { "text-color": c.sea },
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
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 2, 9.5, 6, 13],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.12,
          "text-max-width": 7,
        },
        paint: { "text-color": c.label, "text-halo-color": c.labelHalo, "text-halo-width": 1.2, "text-opacity": 0.85 },
      },
      {
        id: "city-names",
        type: "symbol",
        source: "base",
        "source-layer": "place",
        minzoom: 5,
        filter: ["all", ["==", ["get", "class"], "city"], ["<=", ["coalesce", ["get", "rank"], 99], 6]],
        layout: { "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": 11, "text-max-width": 7 },
        paint: { "text-color": c.label, "text-halo-color": c.labelHalo, "text-halo-width": 1, "text-opacity": 0.7 },
      },
    ],
  };
}
