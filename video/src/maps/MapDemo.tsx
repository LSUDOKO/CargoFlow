import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { EASE_IN_OUT } from "../lib/anim";
import { Camera, Milestone, ProgressTimeline, RouteMap } from "./RouteMap";
import { PORTS, routeFractionNear, routeFractionWithinKm } from "./geo";

/** Camera keyframes → camera at frame (eased per segment; zoom interpolated in log space). */
export const cameraAt = (frame: number, keys: { f: number; cam: Camera }[]): Camera => {
  const fs = keys.map((k) => k.f);
  const opt = { easing: EASE_IN_OUT, extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  let i = 1;
  while (i < keys.length - 1 && frame > keys[i].f) i++;
  const seg = [fs[i - 1], fs[i]];
  const a = keys[i - 1].cam;
  const b = keys[i].cam;
  return {
    lon: interpolate(frame, seg, [a.lon, b.lon], opt),
    lat: interpolate(frame, seg, [a.lat, b.lat], opt),
    zoom: Math.exp(interpolate(frame, seg, [Math.log(a.zoom), Math.log(b.zoom)], opt)),
  };
};

export const MAP_MILESTONES: Milestone[] = [
  { label: "Departed Nhava Sheva", t: 0.004, sub: "tranche 1" },
  { label: "Off Kochi", ll: [75.4, 9.2], sub: "tranche 2" },
  { label: "Rounded Sri Lanka", ll: [82.6, 5.7], sub: "tranche 3" },
  { label: "Malacca Strait", ll: [98.8, 4.3], sub: "tranche 4" },
  { label: "Inside 100 km of Singapore", t: routeFractionWithinKm(PORTS.singapore.ll, 100), sub: "tranche 5", labelSide: "left" },
];

export const EXCURSION_T = routeFractionNear([79.0, 5.9]);

/** 10 s demo: wide → follow the ship → excursion off Sri Lanka → Malacca → zoom into Singapore. */
export const MapDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const timeline: ProgressTimeline = { frames: [24, 270], values: [0, 1] };
  // ease the voyage a little at both ends
  const progress = interpolate(frame, timeline.frames, timeline.values, { easing: EASE_IN_OUT, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  // keep milestone timing consistent with the eased progress by sampling it into a timeline
  const sampled: ProgressTimeline = {
    frames: Array.from({ length: 50 }, (_, i) => 24 + (i * (270 - 24)) / 49),
    values: Array.from({ length: 50 }, (_, i) => interpolate(i / 49, [0, 1], [0, 1], { easing: EASE_IN_OUT })),
  };
  const camera = cameraAt(frame, [
    { f: 0, cam: { lon: 87, lat: 10.5, zoom: 1 } },
    { f: 40, cam: { lon: 86, lat: 10.5, zoom: 1.05 } },
    { f: 100, cam: { lon: 78.5, lat: 9.5, zoom: 1.9 } },
    { f: 150, cam: { lon: 81.5, lat: 7.2, zoom: 2.3 } },
    { f: 215, cam: { lon: 94, lat: 5.5, zoom: 1.45 } },
    { f: 275, cam: { lon: 103.4, lat: 1.7, zoom: 4.2 } },
    { f: 300, cam: { lon: 103.5, lat: 1.6, zoom: 4.6 } },
  ]);
  const routeDraw = interpolate(frame, [0, 30], [0, 1], { easing: EASE_IN_OUT, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const temp = progress > EXCURSION_T && progress < EXCURSION_T + 0.05 ? "11.7 °C" : "4.8 °C";
  return (
    <AbsoluteFill>
      <RouteMap
        camera={camera}
        progress={progress}
        timeline={sampled}
        routeDraw={routeDraw}
        milestones={MAP_MILESTONES}
        excursion={{ t: EXCURSION_T, label: "11.7 °C · excursion" }}
        radius={{ center: PORTS.singapore.ll, km: 100, label: "100 km place radius" }}
        shipLabel={`CF VEGA · ${temp}`}
      />
    </AbsoluteFill>
  );
};
