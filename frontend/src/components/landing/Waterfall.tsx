import { formatUSDG } from "@/lib/format";
import { waterfall } from "@/lib/waterfall";

/** The hero settlement as a single stacked bar of the 100,000 USDG invoice. */
export function Waterfall({ committed = "40000000000", invoice = "100000000000", feeBps = 300 }: { committed?: string; invoice?: string; feeBps?: number }) {
  const w = waterfall(committed, invoice, feeBps);
  const total = Number(BigInt(invoice));
  const pct = (v: bigint) => (Number(v) / total) * 100;
  const parts = [
    { label: "Financier principal", value: w.principal, cls: "bg-ink text-paper" },
    { label: "Financier fee", value: w.fee, cls: "bg-alert text-ink" },
    { label: "Exporter residual", value: w.residual, cls: "bg-signal text-ink" },
  ];
  return (
    <section aria-labelledby="wf-title" className="container-page mt-24 grid gap-10 md:mt-32 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
      <div>
        <h2 id="wf-title" className="h-section">
          One invoice, three payouts, no reconciliation
        </h2>
        <p className="lede mt-5 text-ink/75">
          In the reference run a financier commits {formatUSDG(committed)} USDG across five milestones at a {feeBps / 100}% fee.
          When the buyer pays the {formatUSDG(invoice)} USDG invoice, the vault splits it in the same transaction.
        </p>
        <dl className="mt-8 grid max-w-md grid-cols-2 gap-6">
          <div>
            <dt className="text-sm font-semibold text-slate">Exporter receives in total</dt>
            <dd className="mt-1 font-display text-4xl font-bold tracking-tight tabular">{formatUSDG(w.principal + w.residual)}<span className="ml-1.5 text-base font-semibold text-slate">USDG</span></dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-slate">Financier receives</dt>
            <dd className="mt-1 font-display text-4xl font-bold tracking-tight tabular">{formatUSDG(w.financier)}<span className="ml-1.5 text-base font-semibold text-slate">USDG</span></dd>
          </div>
        </dl>
      </div>
      <figure className="rounded-[var(--radius-card)] border border-line bg-white p-6 shadow-[var(--shadow-card)] md:p-8">
        <figcaption className="text-sm font-semibold text-slate">How the {formatUSDG(invoice)} USDG invoice is split</figcaption>
        <div className="mt-5 flex h-20 overflow-hidden rounded-[var(--radius-tile)]" role="img" aria-label={parts.map((p) => `${p.label} ${formatUSDG(p.value)} USDG`).join(", ")}>
          {parts.map((p) => (
            <div key={p.label} className={`flex items-end px-3 pb-2 text-xs font-bold ${p.cls}`} style={{ width: `${Math.max(pct(p.value), 2.2)}%` }}>
              {pct(p.value) > 8 && <span className="tabular">{Math.round(pct(p.value))}%</span>}
            </div>
          ))}
        </div>
        <ul className="mt-6 divide-y divide-line">
          {parts.map((p) => (
            <li key={p.label} className="flex items-center justify-between py-3">
              <span className="flex items-center gap-3">
                <span className={`h-3.5 w-3.5 rounded ${p.cls.split(" ")[0]}`} aria-hidden="true" />
                {p.label}
              </span>
              <span className="font-mono font-semibold tabular">{formatUSDG(p.value)} USDG</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-slate">
          The exporter already received the {formatUSDG(w.principal)} USDG in tranches during transit; the residual tops it up to the invoice net of financing.
        </p>
      </figure>
    </section>
  );
}
