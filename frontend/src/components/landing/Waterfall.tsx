import { formatUSDG } from "@/lib/format";
import { waterfall } from "@/lib/waterfall";

/** The reference settlement as one stacked bar of the 100,000 USDG invoice, with every segment labelled in the legend. */
export function Waterfall({ committed = "40000000000", invoice = "100000000000", feeBps = 300 }: { committed?: string; invoice?: string; feeBps?: number }) {
  const w = waterfall(committed, invoice, feeBps);
  const total = Number(BigInt(invoice));
  const pct = (v: bigint) => (Number(v) / total) * 100;
  const fmtPct = (v: bigint) => {
    const p = pct(v);
    return `${p < 10 ? p.toFixed(1).replace(/\.0$/, "") : Math.round(p)}%`;
  };
  const parts = [
    { label: "Financier principal", value: w.principal, swatch: "bg-ink", who: "Financier" },
    { label: "Financier fee", value: w.fee, swatch: "bg-warning", who: "Financier" },
    { label: "Exporter residual", value: w.residual, swatch: "bg-signal", who: "Exporter" },
  ];
  return (
    <section id="payout" aria-labelledby="wf-title" className="container-page mt-24 scroll-mt-24 md:mt-32">
      <div className="grid gap-10 lg:grid-cols-12 lg:items-center lg:gap-12">
        <div className="lg:col-span-5">
          <p className="eyebrow">Settlement</p>
          <h2 id="wf-title" className="h-section mt-3">One invoice, three payouts, no reconciliation</h2>
          <p className="lede mt-5 text-text-muted">
            In the reference run a financier commits {formatUSDG(committed)} USDG across five milestones at a {feeBps / 100}% fee.
            When the buyer pays the {formatUSDG(invoice)} USDG invoice, the vault splits it in the same transaction.
          </p>
          <dl className="mt-8 grid max-w-md grid-cols-2 gap-6 border-t border-border pt-6">
            <div>
              <dt className="text-small font-medium text-text-muted">Exporter receives in total</dt>
              <dd className="num mt-1.5 text-metric">
                {formatUSDG(w.principal + w.residual)}
                <span className="ml-1.5 text-small font-semibold tracking-normal text-text-muted">USDG</span>
              </dd>
            </div>
            <div>
              <dt className="text-small font-medium text-text-muted">Financier receives</dt>
              <dd className="num mt-1.5 text-metric">
                {formatUSDG(w.financier)}
                <span className="ml-1.5 text-small font-semibold tracking-normal text-text-muted">USDG</span>
              </dd>
            </div>
          </dl>
        </div>
        <figure className="rounded-card border border-border bg-surface p-5 shadow-2 md:p-8 lg:col-span-7">
          <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-display text-h3">How the invoice is split</span>
            <span className="num text-small text-text-muted">{formatUSDG(invoice)} USDG</span>
          </figcaption>
          <div className="mt-5 flex h-12 gap-0.5 overflow-hidden rounded-tile" role="img" aria-label={parts.map((p) => `${p.label} ${formatUSDG(p.value)} USDG, ${fmtPct(p.value)}`).join("; ")}>
            {parts.map((p) => (
              <div key={p.label} className={p.swatch} style={{ width: `${Math.max(pct(p.value), 1.5)}%` }} />
            ))}
          </div>
          <table className="mt-5 w-full text-left">
            <caption className="sr-only">Settlement of the {formatUSDG(invoice)} USDG invoice</caption>
            <thead className="sr-only">
              <tr><th scope="col">Payout</th><th scope="col">Share</th><th scope="col">Amount (USDG)</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {parts.map((p) => (
                <tr key={p.label}>
                  <th scope="row" className="py-3 font-normal">
                    <span className="flex items-center gap-3">
                      <span className={`h-3 w-3 shrink-0 rounded-sm ${p.swatch}`} aria-hidden="true" />
                      {p.label}
                    </span>
                  </th>
                  <td className="num py-3 text-right text-small text-text-muted">{fmtPct(p.value)}</td>
                  <td className="num w-36 py-3 text-right font-semibold">
                    {formatUSDG(p.value)}
                    <span className="ml-1 text-small font-medium text-text-muted">USDG</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 border-t border-border pt-4 text-small text-text-muted">
            The exporter already received the {formatUSDG(w.principal)} USDG in tranches during transit; the residual tops it up to the invoice net of financing.
          </p>
        </figure>
      </div>
    </section>
  );
}
