"use client";

import { LinkButton } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import type { ShipmentView } from "@/lib/api/schemas";
import { useParty } from "@/lib/api/market";
import { formatUSDG } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import { waterfall } from "@/lib/waterfall";

// one colour per facility state, ordered along the facility's life
const ORDER = ["CREATED", "FINANCED", "ACTIVE", "PAUSED", "DISPUTED", "DELIVERED", "SETTLED", "DEFAULTED"] as const;
const SWATCH: Record<string, string> = {
  CREATED: "bg-ink/15",
  FINANCED: "bg-signal",
  ACTIVE: "bg-verified",
  PAUSED: "bg-alert",
  DISPUTED: "bg-[#c97a00]",
  DELIVERED: "bg-ink-3",
  SETTLED: "bg-ink",
  DEFAULTED: "bg-danger",
};

/** Portfolio figures from the facilities this wallet funds, computed with bigint only. */
export function portfolio(views: ShipmentView[]) {
  const fs = views.filter((v) => v.facility).map((v) => ({ f: v.facility!, invoice: v.shipment.invoiceValue }));
  const sum = (xs: bigint[]) => xs.reduce((s, x) => s + x, 0n);
  const byStatus = new Map<string, bigint>();
  for (const { f } of fs) byStatus.set(f.status, (byStatus.get(f.status) ?? 0n) + BigInt(f.committed));
  return {
    facilities: fs.length,
    committed: sum(fs.map(({ f }) => BigInt(f.committed))),
    drawn: sum(fs.map(({ f }) => BigInt(f.drawn))),
    // capital actually sitting in escrow: funded facilities that have not closed (settled or defaulted)
    inEscrow: sum(fs.filter(({ f }) => f.funded && !f.closed).map(({ f }) => BigInt(f.remaining))),
    feesEarned: sum(fs.filter(({ f }) => f.status === "SETTLED").map(({ f, invoice }) => waterfall(f.drawn, invoice, f.feeBps).fee)),
    settled: fs.filter(({ f }) => f.status === "SETTLED").length,
    defaulted: fs.filter(({ f }) => f.status === "DEFAULTED").length,
    pausedEver: fs.filter(({ f }) => f.pauseCount > 0).length,
    byStatus: [...ORDER, ...[...byStatus.keys()].filter((k) => !(ORDER as readonly string[]).includes(k))]
      .filter((s) => (byStatus.get(s) ?? 0n) > 0n)
      .map((s) => ({ status: s, amount: byStatus.get(s)! })),
  };
}

export function Portfolio({ views, address }: { views: ShipmentView[]; address: string | undefined }) {
  const p = portfolio(views);
  const { data: party } = useParty(address);
  // the backend's figure covers facilities beyond the 200 shipments listed here; prefer it when it is served
  const fees = party && party.financier.facilities >= p.facilities ? BigInt(party.financier.feesEarned) : p.feesEarned;
  const pauseRate = p.facilities ? Math.round((p.pausedEver / p.facilities) * 100) : 0;
  const total = p.byStatus.reduce((s, x) => s + x.amount, 0n);

  return (
    <section aria-labelledby="portfolio" className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-card)] md:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="portfolio" className="font-display text-2xl font-semibold">Your portfolio</h2>
          <p className="mt-0.5 text-sm text-slate">Every facility that names this wallet as its financier.</p>
        </div>
        <LinkButton href="/market" variant="secondary" size="sm">Find shipments to fund</LinkButton>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        {[
          ["Facilities", String(p.facilities), `${p.settled} settled · ${p.defaulted} defaulted`],
          ["Committed", `${formatUSDG(p.committed, { compact: true })} USDG`, "across every facility"],
          ["Drawn by exporters", `${formatUSDG(p.drawn, { compact: true })} USDG`, "released on evidence"],
          ["Still in escrow", `${formatUSDG(p.inEscrow, { compact: true })} USDG`, "funded, not yet released"],
        ].map(([k, v, sub]) => (
          <div key={k}>
            <dt className="text-sm font-semibold text-slate">{k}</dt>
            <dd className="mt-1 font-display text-2xl font-bold whitespace-nowrap tabular md:text-3xl">{v}</dd>
            <dd className="mt-0.5 text-xs text-slate">{sub}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 grid gap-4 border-t border-line pt-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
        <div className="rounded-2xl bg-verified/8 p-4">
          <p className="text-sm font-semibold text-slate">Fees earned</p>
          <p className="mt-1 font-display text-2xl font-bold text-[#00733e] tabular">{formatUSDG(fees, { compact: true })} USDG</p>
          <p className="text-xs text-slate">on settled facilities</p>
        </div>
        <div className={cx("rounded-2xl p-4", pauseRate > 25 ? "bg-alert/12" : "bg-mist")}>
          <p className="text-sm font-semibold text-slate">Pause rate</p>
          <p className="mt-1 font-display text-2xl font-bold tabular">{pauseRate}%</p>
          <p className="text-xs text-slate">{p.pausedEver} of {p.facilities} paused at least once</p>
        </div>
        <div className="rounded-2xl bg-mist p-4">
          <p className="text-sm font-semibold text-slate">Exposure by status</p>
          <div className="mt-3 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-white" role="img" aria-label={p.byStatus.map((x) => `${statusLabel(x.status)} ${formatUSDG(x.amount, { compact: true })} USDG`).join(", ") || "No exposure"}>
            {p.byStatus.map((x) => (
              <span key={x.status} className={cx("h-full first:rounded-l-full last:rounded-r-full", SWATCH[x.status] ?? "bg-slate")} style={{ width: `${total ? Number((x.amount * 1000n) / total) / 10 : 0}%` }} />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs" aria-hidden="true">
            {p.byStatus.map((x) => (
              <li key={x.status} className="inline-flex items-center gap-1.5">
                <span className={cx("h-2.5 w-2.5 rounded-sm", SWATCH[x.status] ?? "bg-slate")} />
                <span className="font-semibold">{statusLabel(x.status)}</span>
                <span className="font-mono text-slate">{formatUSDG(x.amount, { compact: true })}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
