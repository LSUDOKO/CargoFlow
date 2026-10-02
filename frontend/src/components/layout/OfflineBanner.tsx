"use client";

import { Button } from "@/components/ui/Button";
import { useHealth } from "@/lib/api/hooks";

/** Shown when the backend cannot be reached, with a retry. Pages keep rendering what they already have. */
export function OfflineBanner() {
  const { isError, refetch, isFetching } = useHealth();
  if (!isError) return null;
  return (
    <div role="alert" className="bg-alert text-ink">
      <div className="container-page flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm font-semibold">
        <span>The CargoFlow backend is not reachable. Live data is paused; on-chain state is unaffected.</span>
        <Button size="sm" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Retrying…" : "Retry"}
        </Button>
      </div>
    </div>
  );
}
