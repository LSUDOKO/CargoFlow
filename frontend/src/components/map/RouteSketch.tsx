import { nearestPort } from "@/lib/geo/ports";
import { projectRoute } from "@/lib/shipment";

type Point = { latE6: number; lonE6: number };

/**
 * The planned route and the latest position on a stylised chart, drawn without map tiles. The map falls back to
 * it when the tile server or WebGL is unavailable.
 */
export function RouteSketch({ route, position, paused, className }: { route: Point[]; position: Point | null; paused?: boolean; className?: string }) {
  const W = 520, H = 300;
  const all = position ? [...route, position] : route;
  const pts = projectRoute(all, { w: W, h: H });
  const routePts = pts.slice(0, route.length);
  const here = position ? pts[pts.length - 1] : undefined;
  const path = routePts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const ends = routePts.length > 0 ? [0, routePts.length - 1] : [];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`block bg-[#0E3A55] ${className ?? "h-auto w-full"}`} role="img" aria-label={`Sketch of the planned route through ${route.length} waypoints${position ? ", with the latest reported position" : ""}`}>
      <defs>
        <pattern id="cf-graticule" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="#ffffff" strokeOpacity="0.06" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#cf-graticule)" />
      {path && <path d={path} fill="none" stroke="#9FC3D6" strokeWidth="3" strokeDasharray="2 9" strokeLinecap="round" />}
      {ends.map((i, k) => {
        const p = routePts[i]!;
        const r = route[i]!;
        const name = nearestPort(r.latE6 / 1e6, r.lonE6 / 1e6)?.name ?? (k === 0 ? "Origin" : "Destination");
        return (
          <g key={`${i}-${k}`}>
            <circle cx={p.x} cy={p.y} r="7" fill="#F7F9F4" stroke="#0B1B2B" strokeWidth="3" />
            <text x={Math.min(Math.max(p.x, 60), W - 60)} y={p.y < 40 ? p.y + 30 : p.y > H - 40 ? p.y - 18 : p.y + 28} textAnchor="middle" fill="#F7F9F4" fontSize="15" fontWeight="600" fontFamily="var(--font-sans)">
              {name}
            </text>
          </g>
        );
      })}
      {here && (
        <g transform={`translate(${here.x},${here.y})`}>
          <circle r="16" fill={paused ? "#FFB020" : "#C6F432"} opacity="0.25" />
          <rect x="-9" y="-6" width="18" height="12" rx="2.5" fill={paused ? "#FFB020" : "#C6F432"} stroke="#0B1B2B" strokeWidth="2.5" />
        </g>
      )}
    </svg>
  );
}
