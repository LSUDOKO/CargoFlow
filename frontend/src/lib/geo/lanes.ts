// The wizard's quick-pick lanes, precomputed with planSeaRoute (searoute.ts) so the default needs no 600 kB
// download and is identical on every machine. lanes.test.ts recomputes them and fails if they drift.

import type { RoutePointE6 } from "./route";

export type Lane = { id: string; label: string; ports: string[]; distanceKm: number; points: RoutePointE6[] };

const pts = (flat: number[]): RoutePointE6[] => Array.from({ length: flat.length / 2 }, (_, i) => ({ latE6: flat[2 * i]!, lonE6: flat[2 * i + 1]! }));

export const LANES: Lane[] = [
  {
    id: "inns-sgsin",
    label: "Nhava Sheva (IN) → Singapore (SG)",
    ports: ["INNSA", "SGSIN"],
    distanceKm: 4726,
    // prettier-ignore
    points: pts([18950000, 72950000, 18991550, 72857052, 19000000, 72400000, 15300000, 73000000, 12400000, 74300000, 9700000, 75300000, 8000000, 77000000, 5800000, 80100000, 5900000, 81900000, 6466500, 90000100, 6700000, 94000000, 7000000, 97000000, 3200000, 100600000, 2000000, 102000000, 1100000, 103600000, 1264000, 103820000]),
  },
  {
    id: "aejea-nlrtm",
    label: "Jebel Ali (AE) → Rotterdam (NL)",
    ports: ["AEJEA", "NLRTM"],
    distanceKm: 11583,
    // prettier-ignore
    points: pts([25011000, 55061000, 25600000, 55200000, 26400000, 56400000, 25500000, 57100000, 24000000, 59000000, 22700000, 60400000, 20000000, 59000000, 16200000, 54200000, 14143600, 49558100, 12000000, 45000000, 12700000, 43300000, 15000000, 42000000, 16300000, 41200000, 20750000, 38900000, 23600000, 37000000, 27000000, 34500000, 27900000, 33750000, 29700000, 32600000, 30950000, 32166700, 31700000, 32100000, 33328000, 27629800, 34800000, 23000000, 36400000, 15200000, 37500000, 11000000, 37400000, 7500000, 37200000, 3100000, 36000000, -4700000, 35950000, -5750000, 36800000, -9250000, 38500000, -9600000, 40779800, -9984400, 43000000, -9500000, 43900000, -8500000, 48666700, -5500000, 49950000, -1300000, 50800000, 1300000, 51100000, 2100000, 51500000, 3400000, 52000000, 3900000, 51857320, 3996602, 51835844, 4047588, 51950000, 4140000]),
  },
  {
    id: "cnsha-uslax",
    label: "Shanghai (CN) → Los Angeles (US)",
    ports: ["CNSHA", "USLAX"],
    distanceKm: 10959,
    // prettier-ignore
    points: pts([31230000, 121490000, 31300000, 122900000, 31400000, 128900000, 31000000, 130900000, 32400000, 132400000, 33200000, 135100000, 35000000, 139300000, 34800000, 139900000, 35900000, 141300000, 38030100, 145529200, 40000000, 150000000, 40106700, 155000400, 40000000, 160000000, 40106700, 165000400, 40000000, 170000000, 40106700, 175000400, 40000000, 180000000, 40758000, -175111900, 41306600, -170128000, 41638400, -165077500, 41749000, -159993200, 41636700, -154909900, 41303700, -149862100, 40755500, -144882600, 40000000, -140000000, 38861400, -134958600, 37519300, -130089300, 35992100, -125402300, 34300000, -120900000, 34436100, -120884100, 34078600, -119267100, 33705600, -118486700, 33636400, -118464800, 33638400, -118295000, 33740000, -118260000]),
  },
];

export const findLane = (id: string) => LANES.find((l) => l.id === id);

/** A route the wizard is building: its ports (UN/LOCODEs, in order), the committed waypoints and its state. */
export type PlannedRoute = {
  ports: string[];
  points: RoutePointE6[];
  distanceKm: number;
  status: "ready" | "planning" | "error" | "incomplete";
  error?: string;
};

export const routeFromLane = (lane: Lane): PlannedRoute => ({ ports: lane.ports, points: lane.points, distanceKm: lane.distanceKm, status: "ready" });

/** The quick-pick lane with exactly these ports, if any. */
export const laneForPorts = (ports: string[]) => LANES.find((l) => l.ports.length === ports.length && l.ports.every((p, i) => p === ports[i]));
