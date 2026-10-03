// Evidence aggregates, computed exactly as the backend and the contracts do, so anyone can check what an epoch
// committed on chain from the readings they hold.
//
// - `aggregate` is backend/internal/telemetry.Aggregate: the epoch centroid (mean reading position, rounded to the
//   nearest microdegree with halves away from zero; longitudes straddling the antimeridian averaged on a 0..360
//   circle) and the humidity and shock maxima clamped into the contract's uint16 fields.
// - `placeDistanceM` is contracts/src/libraries/GeoDistance.sol's distanceM, bit for bit (and backend
//   geo.PlaceDistanceM): the distance FinancingController.placeCheck uses to decide whether a milestone's evidence
//   came from inside its place.
//
// About Merkle roots: an epoch's committed root is a Poseidon Merkle tree over its readings, and each leaf includes a
// per-reading salt derived from the operator's secret. Only the operator (or, in a future mode, a gateway that keeps
// its own salts) can recompute a committed root. This module does not pretend to recompute operator roots without
// those salts; verify roots and inclusion proofs only when the salts are supplied to you (../merkle.ts does exactly
// that, bit-exact with the backend).

export interface AggregatePoint {
  latitudeE6: number;
  longitudeE6: number;
  humidityX100: number;
  shockX100: number;
}

export interface Aggregates {
  latE6: number;
  lonE6: number;
  maxHumidityX100: number;
  maxShockX100: number;
}

const MAX_HUMIDITY_X100 = 10_000;
const MAX_UINT16 = 65_535;

/** Rounded division, halves away from zero; d > 0. */
function roundDiv(x: bigint, d: bigint): bigint {
  return x < 0n ? -((-x + d / 2n) / d) : (x + d / 2n) / d;
}

/** An epoch's committed aggregates from its readings (zeros for none). Accepts csv.Reading objects directly. */
export function aggregate(points: readonly AggregatePoint[]): Aggregates {
  if (points.length === 0) return { latE6: 0, lonE6: 0, maxHumidityX100: 0, maxShockX100: 0 };
  let minLon = points[0]!.longitudeE6;
  let maxLon = minLon;
  let hum = 0;
  let shock = 0;
  for (const p of points) {
    minLon = Math.min(minLon, p.longitudeE6);
    maxLon = Math.max(maxLon, p.longitudeE6);
    hum = Math.max(hum, p.humidityX100);
    shock = Math.max(shock, p.shockX100);
  }
  const wrap = maxLon - minLon > 180_000_000;
  let latSum = 0n;
  let lonSum = 0n;
  for (const p of points) {
    latSum += BigInt(p.latitudeE6);
    let lon = BigInt(p.longitudeE6);
    if (wrap && lon < 0n) lon += 360_000_000n;
    lonSum += lon;
  }
  const n = BigInt(points.length);
  let lon = roundDiv(lonSum, n);
  if (lon > 180_000_000n) lon -= 360_000_000n;
  return {
    latE6: Number(roundDiv(latSum, n)),
    lonE6: Number(lon),
    maxHumidityX100: Math.min(hum, MAX_HUMIDITY_X100),
    maxShockX100: Math.min(shock, MAX_UINT16),
  };
}

const UM_PER_DEG = 111_195_080_234n; // R * pi / 180 in micrometres per degree, R = 6,371,008.8 m
const E6 = 1_000_000n;
const COS_SCALE = 1_000_000_000n;
// round(cos(d deg) * 1e9) for d = 0..90: the contract's COS_TABLE
const COS_HEX =
  "3b9aca003b98770f3b917e6b3b85e09f3b759e923b60b98a3b4733273b290d683b064aa53adeed953ab2f9493a82712f3a4d59113a13b51139d589ae3992dbc2394bb08039000d7438aff884385b77f03802924d37a54e8a3743b3ef36ddca15367398f2360528cb3592823e351bae3c34a0b6093421a33b339e7fbc331755c5328c2fe031fd18e8316a1c0530d344ac30389ea22f9a35f62ef817022e524e692da8e91b2cfbf44c2c4b7d792b9792662ae041182a2597dd2967a54228a6781827e21f6e271aaa952650291a2582aac724b23fa323def7ef2308e424223014f421549b472076883b1f95ed201eb2db7b1dcd65001ce59b941bfb914b1b0f58641a21034b1930a496183e4f03174a157816540b01155c42ce1462d02f1367c69a126b39a2116d3cf9106de46c0f6d43e50e6b6f680d687b0e0c647b0b0b5f83a30a59a93209530021084b9ced0743941f063afa4f0531e41f0428663a031e955402148629010a4d7600000000";
const COS: bigint[] = Array.from({ length: 91 }, (_, i) => BigInt(`0x${COS_HEX.slice(i * 8, i * 8 + 8)}`));

function cosE9(absLatE6: bigint): bigint {
  if (absLatE6 >= 90_000_000n) return 0n;
  const i = Number(absLatE6 / E6);
  const lo = COS[i]!;
  const hi = COS[i + 1]!;
  return lo - ((lo - hi) * (absLatE6 % E6)) / E6;
}

function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

const abs = (x: bigint) => (x < 0n ? -x : x);

/** Metres between two points (degrees x 1e6), exactly as GeoDistance.distanceM computes it on chain. */
export function placeDistanceM(aLatE6: number, aLonE6: number, bLatE6: number, bLonE6: number): number {
  const dLat = abs(BigInt(aLatE6) - BigInt(bLatE6));
  let dLon = abs(BigInt(aLonE6) - BigInt(bLonE6));
  if (dLon > 180_000_000n) dLon = 360_000_000n - dLon;
  const mid = abs(BigInt(aLatE6) + BigInt(bLatE6)) / 2n;
  const dy = (dLat * UM_PER_DEG) / E6;
  const dx = (dLon * UM_PER_DEG * cosE9(mid)) / (E6 * COS_SCALE);
  return Number(isqrt(dx * dx + dy * dy) / E6);
}

/**
 * Whether an epoch centroid satisfies a milestone's place condition (always true for radiusM 0, the v1 behaviour),
 * with the distance the controller would measure.
 */
export function placeCheck(
  centroid: { latE6: number; lonE6: number },
  place: { latE6?: number; lonE6?: number; radiusM?: number },
): { required: boolean; inside: boolean; distanceM: number } {
  const radius = place.radiusM ?? 0;
  if (radius === 0) return { required: false, inside: true, distanceM: 0 };
  const distanceM = placeDistanceM(centroid.latE6, centroid.lonE6, place.latE6 ?? 0, place.lonE6 ?? 0);
  return { required: true, inside: distanceM <= radius, distanceM };
}
