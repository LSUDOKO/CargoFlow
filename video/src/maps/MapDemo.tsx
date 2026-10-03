import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { P } from "../assets/palette";
import { EASE, EASE_IN_OUT } from "../lib/anim";
import { Camera, Milestone, Place, ProgressTimeline, RouteMap } from "./RouteMap";
import { PORTS, routeFractionNear, routeFractionWithinKm } from "./geo";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Camera keyframes → camera at frame (eased per segment; zoom interpolated in log space). */
export const cameraAt = (frame: number, keys: { f: number; cam: Camera }[]): Camera => {
  const opt = { easing: EASE_IN_OUT, ...clamp } as const;
  let i = 1;
  while (i < keys.length - 1 && frame > keys[i].f) i++;
  const seg = [keys[i - 1].f, keys[i].f];
  const a = keys[i - 1].cam;
  const b = keys[i].cam;
  return {
    lon: interpolate(frame, seg, [a.lon, b.lon], opt),
    lat: interpolate(frame, seg, [a.lat, b.lat], opt),
    zoom: Math.exp(interpolate(frame, seg, [Math.log(a.zoom), Math.log(b.zoom)], opt)),
  };
};

/** Story fractions along the lane (shared with scenes). */
export const T = {
  m1: 0.004,
  m2: routeFractionNear([75.4, 9.2]),
  m3: routeFractionNear([79.6, 6.9]),
  m4: routeFractionNear([98.8, 4.3]),
  m5: 0.999,
  /** First point 412 km (straight line) from Colombo: where M3 is "held". */
  hold412: routeFractionWithinKm(PORTS.colombo.ll, 412),
  /** Just past Sri Lanka's southern tip (illustrative excursion). */
  excursion: routeFractionNear([81.2, 5.65]),
};

export const MAP_MILESTONES: Milestone[] = [
  { label: "Departed Nhava Sheva", t: T.m1, labelSide: "left" },
  { label: "Off Kochi", t: T.m2, labelSide: "left" },
  { label: "", t: T.m3 },
  { label: "Malacca Strait", t: T.m4, labelSide: "left" },
  { label: "", t: T.m5 },
];

export const EXCURSION_T = T.excursion;

/**
 * 10 s map beat sheet, following SCRIPT-v2 S05a → S05f compressed:
 * coastlines + ports pop → lane draws with pips → lean into Colombo, M3 place ring grows →
 * position 412 km short: ring held (amber, dashed, distance chip) → rounds the southern tip,
 * excursion: segment red, dot amber (paused) → resume: M3 met (emerald) → Malacca → Singapore.
 */
export const MapDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const timeline: ProgressTimeline = {
    frames: [0, 100, 128, 160, 196, 232, 284],
    values: [0, 0, T.hold412, T.hold412, T.excursion + 0.025, T.excursion + 0.025, 1],
  };
  const progress = interpolate(frame, timeline.frames, timeline.values, { ...clamp, easing: EASE_IN_OUT });
  const camera = cameraAt(frame, [
    { f: 0, cam: { lon: 86, lat: 9.5, zoom: 1 } },
    { f: 70, cam: { lon: 86, lat: 9.5, zoom: 1 } },
    { f: 104, cam: { lon: 78.6, lat: 7.6, zoom: 2.6 } },
    { f: 160, cam: { lon: 78.9, lat: 7.3, zoom: 2.7 } },
    { f: 200, cam: { lon: 81.2, lat: 6.6, zoom: 2.9 } },
    { f: 236, cam: { lon: 85, lat: 7.5, zoom: 1.3 } },
    { f: 278, cam: { lon: 103.1, lat: 1.9, zoom: 3.4 } },
    { f: 300, cam: { lon: 103.2, lat: 1.8, zoom: 3.6 } },
  ]);
  const landIn = interpolate(frame, [0, 20], [0, 1], { ...clamp, easing: EASE });
  const portsIn = [10, 16, 22].map((f) => spring({ frame: frame - f, fps, config: { damping: 12, stiffness: 170 } }));
  const routeDraw = interpolate(frame, [20, 70], [0, 1], { ...clamp, easing: EASE_IN_OUT });
  const paused = frame >= 196 && frame < 232;
  const resumed = frame >= 232;
  const colomboGrow = spring({ frame: frame - 84, fps, config: { damping: 14, stiffness: 140 } });
  const held = frame >= 130 && !resumed;
  const places: Place[] = [
    {
      center: PORTS.colombo.ll,
      km: 50,
      grow: colomboGrow,
      state: resumed ? "met" : held && frame < 162 ? "held" : "active",
      label: "M3 · within 50 km of Colombo",
      distance: "412 km away",
    },
    { center: PORTS.singapore.ll, km: 100, grow: spring({ frame: frame - 262, fps, config: { damping: 14 } }), state: frame >= 280 ? "met" : "active" },
  ];
  const reached = (t: number, extra = true) => progress >= t - 0.0005 && extra;
  const milestones = MAP_MILESTONES.map((m, i) => ({
    ...m,
    reached: i === 2 ? resumed : reached(m.t ?? 0) && frame > 70,
  }));
  return (
    <AbsoluteFill style={{ background: P.white }}>
      <RouteMap
        camera={camera}
        progress={progress}
        routeDraw={routeDraw}
        landIn={landIn}
        portsIn={portsIn}
        milestones={milestones}
        places={places}
        colorStops={[
          { at: 0, color: P.verified },
          { at: T.excursion - 0.012, color: P.danger },
          { at: T.excursion + 0.025, color: P.verified },
        ]}
        excursion={frame >= 180 ? { t: T.excursion, label: "11.7 °C · probe-1" } : null}
        shipStatus={paused ? "paused" : "ok"}
        shipLabel={paused ? "PAUSED" : undefined}
      />
    </AbsoluteFill>
  );
};
