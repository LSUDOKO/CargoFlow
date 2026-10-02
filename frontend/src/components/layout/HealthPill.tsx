"use client";

import { useHealth } from "@/lib/api/hooks";
import { chainName } from "@/lib/explorer";
import { cx } from "@/components/ui/cx";

/**
 * Live backend and chain status: green when both answer, amber when degraded, red when unreachable.
 * While the first check is in flight it shows only a quiet dot, so the header does not flash a "Connecting" label.
 */
export function HealthPill() {
  const { data, isError, isPending } = useHealth();
  const ok = data?.status === "ok";
  if (isPending) {
    return (
      <span role="status" className="inline-flex h-8 items-center px-2" title="Checking the network">
        <span className="h-2 w-2 animate-pulse rounded-full bg-current/30" aria-hidden="true" />
        <span className="sr-only">Checking the network</span>
      </span>
    );
  }
  const tone = isError ? "bg-danger" : ok ? "bg-verified" : "bg-alert";
  const text = isError ? "Offline" : ok ? chainName(data?.chainId) : "Degraded";
  return (
    <span
      className="inline-flex h-8 animate-fade items-center gap-2 rounded-full bg-current/10 px-3 text-xs font-semibold whitespace-nowrap"
      title={data?.headBlock ? `Block ${data.headBlock.toLocaleString()}` : undefined}
    >
      <span className={cx("h-2 w-2 shrink-0 rounded-full", tone, ok && "animate-pulse-dot")} aria-hidden="true" />
      <span>{text}</span>
      {ok && data?.headBlock !== undefined && <span className="hidden font-mono opacity-60 2xl:inline">#{data.headBlock.toLocaleString()}</span>}
    </span>
  );
}
