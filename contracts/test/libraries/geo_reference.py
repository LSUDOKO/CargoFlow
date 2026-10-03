#!/usr/bin/env python3
"""Reference values for test/libraries/GeoDistance.t.sol.

Prints the cosine table embedded in src/libraries/GeoDistance.sol and the haversine reference vectors
(in millimetres) embedded in the test. The haversine uses float64 on a sphere of the IUGG mean radius,
the same formula as Go's reference implementation, and the same radius as the on-chain library.

    python3 contracts/test/libraries/geo_reference.py
"""
import math
import random

R = 6_371_008.8  # metres, IUGG mean Earth radius (also the library's radius)
UM_PER_DEG = round(R * math.pi / 180 * 1e6)
COS_E9 = [round(math.cos(math.radians(d)) * 1e9) for d in range(91)]


def haversine_mm(a_lat, a_lon, b_lat, b_lon):
    p1, p2 = math.radians(a_lat / 1e6), math.radians(b_lat / 1e6)
    dp = p2 - p1
    dl = math.radians((b_lon - a_lon) / 1e6)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return round(2 * R * math.asin(min(1.0, math.sqrt(h))) * 1000)


def destination(lat, lon, bearing, dist):
    p, l, t, dr = math.radians(lat), math.radians(lon), math.radians(bearing), dist / R
    p2 = math.asin(math.sin(p) * math.cos(dr) + math.cos(p) * math.sin(dr) * math.cos(t))
    l2 = l + math.atan2(
        math.sin(t) * math.sin(dr) * math.cos(p), math.cos(dr) - math.sin(p) * math.sin(p2)
    )
    return math.degrees(p2), (math.degrees(l2) + 540) % 360 - 180


NAMED = [
    # (label, aLatE6, aLonE6, bLatE6, bLonE6)
    ("zero distance (JNPT)", 18_950_000, 72_950_000, 18_950_000, 72_950_000),
    ("equator, 1 deg of longitude", 0, 0, 0, 1_000_000),
    ("meridian, 1 deg of latitude", 0, 30_000_000, 1_000_000, 30_000_000),
    ("equator crossing", -1_000_000, 30_000_000, 1_000_000, 31_000_000),
    ("antimeridian on the equator", 0, 179_500_000, 0, -179_500_000),
    ("antimeridian at 60N", 60_000_000, 179_800_000, 60_000_000, -179_800_000),
    ("antimeridian, Bering Sea", 52_000_000, 179_000_000, 53_000_000, -178_000_000),
    ("antimeridian at 60S", -60_000_000, -179_000_000, -60_500_000, 179_000_000),
    ("60N Oslo-Stockholm", 59_913_900, 10_752_200, 59_329_300, 18_068_600),
    ("60S, 5 deg of longitude", -60_000_000, 0, -60_000_000, 5_000_000),
    ("80N, 10 deg of longitude", 80_000_000, 0, 80_000_000, 10_000_000),
    ("80N to 79N diagonal", 80_000_000, 0, 79_000_000, 5_000_000),
    ("70S Weddell", -70_000_000, -60_000_000, -71_000_000, -62_000_000),
    ("JNPT berth to epoch centroid", 18_950_000, 72_950_000, 18_940_782, 72_966_092),
    ("Singapore approach", 1_264_000, 103_840_000, 1_300_000, 103_800_000),
    ("1 km due north", 10_000_000, 20_000_000, 10_008_993, 20_000_000),
    ("1,000 km along the equator", 0, 0, 0, 8_993_216),
]


def main():
    print("UM_PER_DEG =", UM_PER_DEG)
    print('COS_TABLE = hex"' + "".join("%08x" % c for c in COS_E9) + '"')
    print("\n// named vectors")
    for label, a, b, c, d in NAMED:
        print(f"_v({a}, {b}, {c}, {d}, {haversine_mm(a, b, c, d)}); // {label}")
    print("\n// random vectors (seed 2026), both points within +-80 deg, separations 1..1,000 km")
    rng = random.Random(2026)
    n = 0
    while n < 48:
        lat, lon = rng.uniform(-80, 80), rng.uniform(-180, 180)
        dist = rng.uniform(1_000, 1_000_000 if n % 2 else 500_000)
        lat2, lon2 = destination(lat, lon, rng.uniform(0, 360), dist)
        if abs(lat2) > 80:
            continue
        a, b, c, d = (round(x * 1e6) for x in (lat, lon, lat2, lon2))
        print(f"_v({a}, {b}, {c}, {d}, {haversine_mm(a, b, c, d)});")
        n += 1


if __name__ == "__main__":
    main()
