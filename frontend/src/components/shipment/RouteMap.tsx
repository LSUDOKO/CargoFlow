import type { TelemetrySummary } from "@/lib/api/schemas";
import { projectRoute } from "@/lib/shipment";

type Point = { latE6: number; lonE6: number };
const places: Record<string, string> = { "18950000,72950000": "Nhava Sheva", "1264000,103820000": "Singapore" };

/** The planned route and the cargo's last reported position, on a stylised chart. */
export function RouteMap({ route, position, status }: { route: Point[]; position: TelemetrySummary["position"]; status?: string }) {
  const W = 520, H = 300;
  const all = position ? [...route, position] : route;
  const pts = projectRoute(all, { w: W, h: H });
  const routePts = pts.slice(0, route.length);
  const here = position ? pts[pts.length - 1] : undefined;
  const path = routePts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const done = routePts.length > 1 && here ? `M${routePts[0]!.x},${routePts[0]!.y} L${here.x},${here.y}` : "";
  const paused = status === "PAUSED";
  return (
    <figure className="overflow-hidden rounded-2xl bg-[#0E3A55]">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Route from ${route.length} waypoints${position ? ", with the latest reported position" : ""}`}>
        <defs>
          <pattern id="graticule" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="#ffffff" strokeOpacity="0.06" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#graticule)" />
        {path && <path d={path} fill="none" stroke="#9FC3D6" strokeWidth="3" strokeDasharray="2 9" strokeLinecap="round" />}
        {done && <path d={done} fill="none" stroke="#C6F432" strokeWidth="4" strokeLinecap="round" />}
        {routePts.map((p, i) => {
          const key = `${route[i]!.latE6},${route[i]!.lonE6}`;
          const name = places[key] ?? (i === 0 ? "Origin" : i === routePts.length - 1 ? "Destination" : "");
          return (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r="7" fill="#F7F9F4" stroke="#0B1B2B" strokeWidth="3" />
              {name && (
                <text
                  x={Math.min(Math.max(p.x, 60), W - 60)}
                  y={p.y < 40 ? p.y + 30 : p.y > H - 40 ? p.y - 18 : p.y + 28}
                  textAnchor="middle"
                  fill="#F7F9F4"
                  fontSize="15"
                  fontWeight="600"
                  fontFamily="var(--font-sans)"
                >
                  {name}
                </text>
              )}
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
      <figcaption className="flex items-center justify-between px-4 py-2.5 text-xs font-medium text-paper/70">
        <span>Planned route</span>
        <span>{position ? `Last fix ${new Date(position.timestamp * 1000).toLocaleTimeString()}` : "Awaiting first reading"}</span>
      </figcaption>
    </figure>
  );
}
