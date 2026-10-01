"use client";

import { useHealth } from "@/lib/api/hooks";

/** Shown when the backend cannot be reached, with a retry. Pages keep rendering what they already have. */
export function OfflineBanner() {
  const { isError, refetch, isFetching } = useHealth();
  if (!isError) return null;
  return (
    <div role="alert" className="bg-alert text-ink">
      <div className="container-page flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm font-semibold">
        <span>The CargoFlow backend is not reachable. Live data is paused; on-chain state is unaffected.</span>
        <button type="button" onClick={() => refetch()} disabled={isFetching} className="rounded-full bg-ink px-4 py-1.5 text-paper disabled:opacity-60">
          {isFetching ? "Retrying…" : "Retry"}
        </button>
      </div>
    </div>
  );
}
