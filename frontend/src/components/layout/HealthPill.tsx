"use client";

import { useHealth } from "@/lib/api/hooks";
import { chainName } from "@/lib/explorer";

/** Live backend and chain status: green when both answer, amber when degraded, red when unreachable. */
export function HealthPill() {
  const { data, isError, isPending } = useHealth();
  const ok = data?.status === "ok";
  const tone = isPending ? "bg-slate" : isError ? "bg-danger" : ok ? "bg-verified" : "bg-alert";
  const text = isPending ? "Connecting" : isError ? "Offline" : ok ? chainName(data?.chainId) : "Degraded";
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-ink/5 px-3 py-1.5 text-xs font-semibold" title={data?.headBlock ? `Block ${data.headBlock.toLocaleString()}` : undefined}>
      <span className={`h-2 w-2 rounded-full ${tone} ${ok ? "animate-pulse-dot" : ""}`} aria-hidden="true" />
      <span>{text}</span>
      {ok && data?.headBlock !== undefined && <span className="hidden font-mono text-slate xl:inline">#{data.headBlock.toLocaleString()}</span>}
    </span>
  );
}
