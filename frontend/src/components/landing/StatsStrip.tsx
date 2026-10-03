"use client";

import Link from "next/link";
import { CountUp } from "@/components/story/CountUp";
import { Badge } from "@/components/ui/Pill";
import { Stat } from "@/components/ui/Stat";
import { useStats } from "@/lib/api/hooks";

/**
 * Live testnet numbers, straight from the CargoFlow API (GET /v1/stats, refreshed every 20 s). Each figure says what
 * it counts and where it can be checked, so a small testnet number reads as a fact rather than a weak boast. Figures count
 * up once as the strip scrolls into view.
 */
export function StatsStrip() {
  const { data, isPending, isError } = useStats();
  const s = data?.shipments ?? {};
  const active = (s.ACTIVE ?? 0) + (s.FINANCED ?? 0) + (s.PAUSED ?? 0);
  const settled = s.SETTLED ?? 0;
  const show = (v: number | undefined) => (isError || v === undefined ? "–" : <CountUp value={v} />);
  const items = [
    { label: "Shipments under watch", value: show(data?.total), unit: data?.total === 1 ? "shipment" : "shipments", hint: data ? `${settled.toLocaleString()} settled end to end` : "Registered in ShipmentRegistry" },
    { label: "Facilities in transit", value: show(data ? active : undefined), unit: data && active === 1 ? "facility" : "facilities", hint: "Financed, active or paused right now" },
    { label: "Evidence epochs committed", value: show(data?.epochsCommitted), unit: data?.epochsCommitted === 1 ? "root" : "roots", hint: "Poseidon Merkle roots in EvidenceRegistry" },
    { label: "Recoveries proven", value: show(data?.proofsVerified), unit: data?.proofsVerified === 1 ? "proof" : "proofs", hint: "Groth16, verified by the contract" },
  ];
  return (
    <section aria-labelledby="proof-title" className="container-page mt-16 md:mt-20">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="proof-title" className="font-display text-h3">Live on testnet</h2>
          {isError ? <Badge variant="warning" dot>Backend offline</Badge> : <Badge variant="success" dot pulse={!isPending}>Live</Badge>}
        </div>
        <p className="text-small text-text-muted">
          Source: the CargoFlow API, indexed from Robinhood Chain Testnet.{" "}
          <Link href="/deployments" className="font-semibold text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink">Check the contracts</Link>
        </p>
      </div>
      <ul aria-busy={isPending || undefined} className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border shadow-1 lg:grid-cols-4">
        {items.map((it) => (
          <li key={it.label} className="min-w-0 bg-surface p-4 md:p-6">
            <Stat tile={false} size="lg" label={it.label} value={it.value} unit={isError ? undefined : it.unit} hint={it.hint} loading={isPending} />
          </li>
        ))}
      </ul>
      {isError && <p className="mt-3 text-small text-text-muted">Live numbers are unavailable while the backend is offline.</p>}
    </section>
  );
}
