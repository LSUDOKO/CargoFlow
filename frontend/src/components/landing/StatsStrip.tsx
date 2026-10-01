"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { useStats } from "@/lib/api/hooks";

/** Live platform counts, each drawn as a shipping container: the brand's container-rib motif. */
export function StatsStrip() {
  const { data, isPending, isError } = useStats();
  const s = data?.shipments ?? {};
  const active = (s.ACTIVE ?? 0) + (s.FINANCED ?? 0) + (s.PAUSED ?? 0);
  const items = [
    { value: data?.total, label: "shipments under watch", color: "bg-ink text-paper", rib: "bg-paper/10" },
    { value: data ? active : undefined, label: "facilities in transit", color: "bg-signal text-ink", rib: "bg-ink/10" },
    { value: data?.epochsCommitted, label: "evidence epochs committed on-chain", color: "bg-[#0E6E8C] text-paper", rib: "bg-paper/12" },
    { value: data?.proofsVerified, label: "recoveries proven with zero knowledge", color: "bg-alert text-ink", rib: "bg-ink/10" },
  ];
  return (
    <section aria-label="Live platform numbers" className="container-page mt-14 md:mt-20">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {items.map((it) => (
          <li key={it.label} className={`relative overflow-hidden rounded-2xl ${it.color} px-5 py-5 md:px-6 md:py-6`}>
            <span aria-hidden="true" className="absolute inset-y-0 right-0 flex gap-2.5 pr-4">
              {[0, 1, 2, 3].map((i) => <span key={i} className={`my-3 w-1.5 rounded-full ${it.rib}`} />)}
            </span>
            {isPending ? (
              <Skeleton className="h-11 w-20 bg-current/15" />
            ) : (
              <p className="relative font-display text-[2.6rem] leading-none font-bold tracking-tight tabular md:text-5xl">
                {isError || it.value === undefined ? "—" : it.value.toLocaleString()}
              </p>
            )}
            <p className="relative mt-2 max-w-[13rem] text-sm leading-snug font-medium opacity-85">{it.label}</p>
          </li>
        ))}
      </ul>
      {isError && <p className="mt-3 text-sm text-slate">Live numbers are unavailable while the backend is offline.</p>}
    </section>
  );
}
