"use client";

import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { Stat } from "@/components/ui/Stat";
import { cx } from "@/components/ui/cx";
import type { ShipmentView } from "@/lib/api/schemas";
import { useParty } from "@/lib/api/market";
import { formatUSDG } from "@/lib/format";
import { statusLabel } from "@/lib/status";
import { waterfall } from "@/lib/waterfall";

// one colour per facility state, ordered along the facility's life
const ORDER = ["CREATED", "FINANCED", "ACTIVE", "PAUSED", "DISPUTED", "DELIVERED", "SETTLED", "DEFAULTED", "CANCELLED"] as const;
const SWATCH: Record<string, string> = {
  CREATED: "bg-neutral-300",
  FINANCED: "bg-signal",
  ACTIVE: "bg-verified",
  PAUSED: "bg-alert",
  DISPUTED: "bg-warning-fg",
  DELIVERED: "bg-ink-3",
  SETTLED: "bg-ink",
  DEFAULTED: "bg-danger",
  CANCELLED: "bg-neutral-300",
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
    <Section title="Your portfolio" description="Every facility that names this wallet as its financier." actions={<LinkButton href="/market" variant="secondary" size="sm">Find shipments to fund</LinkButton>}>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Facilities" value={p.facilities} hint={`${p.settled} settled, ${p.defaulted} defaulted`} />
        <Stat label="Committed" value={formatUSDG(p.committed, { compact: true })} unit="USDG" hint={`${formatUSDG(p.drawn, { compact: true })} USDG drawn on evidence`} />
        <Stat label="Still in escrow" value={formatUSDG(p.inEscrow, { compact: true })} unit="USDG" hint="Funded, not yet released" />
        <Stat label="Fees earned" value={formatUSDG(fees, { compact: true })} unit="USDG" hint={`Pause rate ${pauseRate}%: ${p.pausedEver} of ${p.facilities} paused once`} />
      </div>
      {p.byStatus.length > 0 && (
        <Card padded="sm" className="mt-4">
          <p className="text-small font-medium text-text-muted">Exposure by status</p>
          <div className="mt-2 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={p.byStatus.map((x) => `${statusLabel(x.status)} ${formatUSDG(x.amount, { compact: true })} USDG`).join(", ")}>
            {p.byStatus.map((x) => (
              <span key={x.status} className={cx("h-full", SWATCH[x.status] ?? "bg-slate")} style={{ width: `${total ? Number((x.amount * 1000n) / total) / 10 : 0}%` }} />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-caption" aria-hidden="true">
            {p.byStatus.map((x) => (
              <li key={x.status} className="inline-flex items-center gap-1.5">
                <span className={cx("h-2.5 w-2.5 rounded-sm", SWATCH[x.status] ?? "bg-slate")} />
                <span className="font-semibold">{statusLabel(x.status)}</span>
                <span className="num text-text-muted">{formatUSDG(x.amount, { compact: true })} USDG</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Section>
  );
}
