"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { useStats } from "@/lib/api/hooks";

/** Live platform counts, each drawn as a shipping container: the brand's container-rib motif. */
export function StatsStrip() {
  const { data, isPending, isError } = useStats();
  const s = data?.shipments ?? {};
  const active = (s.ACTIVE ?? 0) + (s.FINANCED ?? 0) + (s.PAUSED ?? 0);
  const items = [
    { value: data?.total, label: "shipments under watch" },
    { value: data ? active : undefined, label: "facilities in transit" },
    { value: data?.epochsCommitted, label: "evidence epochs committed on-chain" },
    { value: data?.proofsVerified, label: "recoveries proven with zero knowledge" },
  ];
  return (
    <section aria-label="Live platform numbers" className="container-page mt-12 md:mt-16">
      <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-tile)] border border-line bg-line md:grid-cols-4">
        {items.map((it) => (
          <li key={it.label} className="relative overflow-hidden bg-white px-5 py-5 md:px-6 md:py-6">
            <span aria-hidden="true" className="absolute inset-y-0 right-0 flex gap-2 pr-4">
              {[0, 1, 2, 3].map((i) => <span key={i} className="my-4 w-1 rounded-full bg-ink/5" />)}
            </span>
            {isPending ? (
              <Skeleton className="h-10 w-16 md:h-12" />
            ) : (
              <p className="relative font-display text-[2.5rem] leading-none font-bold tracking-tight tabular md:text-5xl">
                {isError || it.value === undefined ? "–" : it.value.toLocaleString()}
              </p>
            )}
            <p className="relative mt-2 max-w-[12rem] text-sm leading-snug text-slate">{it.label}</p>
          </li>
        ))}
      </ul>
      {isError && <p className="mt-3 text-sm text-slate">Live numbers are unavailable while the backend is offline.</p>}
    </section>
  );
}
