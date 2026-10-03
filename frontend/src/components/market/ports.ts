// Names for route endpoints: the nearest major container port within 200 km, else the coordinates themselves.

type Port = [name: string, country: string, lat: number, lon: number];

const PORTS: Port[] = [
  ["Nhava Sheva", "IN", 18.95, 72.95], ["Mundra", "IN", 22.74, 69.7], ["Chennai", "IN", 13.1, 80.3], ["Colombo", "LK", 6.95, 79.84],
  ["Singapore", "SG", 1.264, 103.82], ["Port Klang", "MY", 3.0, 101.39], ["Laem Chabang", "TH", 13.08, 100.88], ["Cat Lai", "VN", 10.76, 106.79],
  ["Manila", "PH", 14.6, 120.95], ["Tanjung Priok", "ID", -6.1, 106.88], ["Hong Kong", "HK", 22.3, 114.17], ["Shanghai", "CN", 31.23, 121.49],
  ["Ningbo", "CN", 29.87, 121.85], ["Busan", "KR", 35.1, 129.04], ["Tokyo", "JP", 35.62, 139.78], ["Jebel Ali", "AE", 25.011, 55.061],
  ["Salalah", "OM", 16.94, 54.0], ["Jeddah", "SA", 21.48, 39.17], ["Piraeus", "GR", 37.94, 23.62], ["Algeciras", "ES", 36.13, -5.44],
  ["Valencia", "ES", 39.44, -0.32], ["Rotterdam", "NL", 51.95, 4.14], ["Antwerp", "BE", 51.27, 4.35], ["Hamburg", "DE", 53.54, 9.97],
  ["Felixstowe", "GB", 51.96, 1.33], ["New York", "US", 40.68, -74.15], ["Savannah", "US", 32.08, -81.09], ["Los Angeles", "US", 33.74, -118.26],
  ["Vancouver", "CA", 49.29, -123.11], ["Manzanillo", "MX", 19.05, -104.31], ["Cartagena", "CO", 10.39, -75.53], ["Guayaquil", "EC", -2.28, -79.91],
  ["Callao", "PE", -12.05, -77.15], ["Santos", "BR", -23.96, -46.3], ["Durban", "ZA", -29.87, 31.03], ["Mombasa", "KE", -4.04, 39.66],
  ["Melbourne", "AU", -37.84, 144.92],
];

function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLon - aLon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const coord = (lat: number, lon: number) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;

/** "Singapore" with its country code, or "1.3°N 103.8°E" when no port is near. */
export function placeName(p: { latE6: number; lonE6: number }): { name: string; country: string | null } {
  const lat = p.latE6 / 1e6, lon = p.lonE6 / 1e6;
  let best: Port | null = null;
  let bestKm = 200;
  for (const port of PORTS) {
    const d = km(lat, lon, port[2], port[3]);
    if (d < bestKm) [best, bestKm] = [port, d];
  }
  return best ? { name: best[0], country: best[1] } : { name: coord(lat, lon), country: null };
}

/** Origin and destination of a route (sea routes carry many waypoints; only the ends are named), or null. */
export function routeEnds(route: { latE6: number; lonE6: number }[]) {
  if (route.length === 0) return null;
  return { from: placeName(route[0]!), to: placeName(route[route.length - 1]!) };
}
