"use client";

import { useHealth } from "@/lib/api/hooks";
import { chainName, ROBINHOOD_TESTNET_ID } from "@/lib/explorer";
import { cx } from "@/components/ui/cx";

/**
 * Live backend and chain status: green when both answer, amber when degraded, red when unreachable.
 * While the first check is in flight it shows only a quiet dot, so the header does not flash a "Connecting" label.
 * `onDark` (the header) uses paper text at 80% on a paper/8 wash (≈ 10:1 on ink); the default is for light surfaces.
 * `short` shows "Testnet" instead of the chain's full name; the full name stays available to screen readers and on hover.
 */
export function HealthPill({ onDark, short }: { onDark?: boolean; short?: boolean }) {
  const { data, isError, isPending } = useHealth();
  const ok = data?.status === "ok";
  const shell = cx(
    "inline-flex h-8 items-center gap-2 rounded-full px-3 text-caption font-semibold whitespace-nowrap ring-1 ring-inset",
    onDark ? "bg-paper/8 text-paper/85 ring-paper/15" : "bg-surface text-ink ring-border",
  );
  if (isPending) {
    return (
      <span role="status" className={shell} title="Checking the network">
        <span className={cx("h-2 w-2 animate-pulse rounded-full", onDark ? "bg-paper/40" : "bg-ink/30")} aria-hidden="true" />
        <span className="sr-only">Checking the network</span>
      </span>
    );
  }
  const tone = isError ? "bg-danger" : ok ? "bg-success" : "bg-warning";
  const full = isError ? "Offline" : ok ? chainName(data?.chainId) : "Degraded";
  const label = short && ok && data?.chainId === ROBINHOOD_TESTNET_ID ? "Testnet" : full;
  const block = data?.headBlock !== undefined ? `Block ${data.headBlock.toLocaleString()}` : undefined;
  return (
    <span className={cx(shell, "animate-fade")} title={block ? `${full} · ${block}` : full}>
      <span className={cx("h-2 w-2 shrink-0 rounded-full", tone, ok && "animate-pulse-dot")} aria-hidden="true" />
      {label === full ? <span>{label}</span> : <><span aria-hidden="true">{label}</span><span className="sr-only">{full}</span></>}
    </span>
  );
}
