import Link from "next/link";

type Role = { href: string; who: string; title: string; body: string; cta: string; points?: string[] };

const lead: Role[] = [
  {
    href: "/exporter", who: "Exporters", title: "Get paid while the cargo is still at sea",
    body: "Register the shipment and its cold-chain policy, name your financier, and receive each tranche the moment its evidence is committed.",
    cta: "Start as an exporter", points: ["Gateway for your data logger", "Tranches per milestone", "Residual at settlement"],
  },
  {
    href: "/financier", who: "Financiers", title: "Lend against evidence, not paperwork",
    body: "Fund a facility from your own wallet. Escrow releases only on committed, in-policy evidence, and an excursion pauses it until a proof clears.",
    cta: "Fund a facility", points: ["Principal and fee first in the waterfall", "Optional default cover", "Portfolio view"],
  },
];

const rest: Role[] = [
  { href: "/buyer", who: "Buyers", title: "Confirm delivery and pay once", body: "One payment settles the financier and the exporter in a fixed order.", cta: "Open the buyer portal" },
  { href: "/arbiter", who: "Arbiters", title: "Resolve disputes and defaults", body: "Rule on a disputed shipment with the evidence and the full audit trail in front of you.", cta: "Open the arbiter portal" },
  { href: "/ebl", who: "Carriers", title: "Issue and endorse bills of lading", body: "Electronic bills of lading as ERC-721 titles, bound to the facility they finance.", cta: "Open the carrier portal" },
];

const Arrow = () => (
  <svg viewBox="0 0 16 16" className="h-4 w-4 transition-transform duration-(--duration-base) ease-standard group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);

/** One facility, five parties: two lead cards for the sides of the loan, then three compact rows for everyone else. */
export function Roles() {
  return (
    <section aria-labelledby="roles-title" className="container-page mt-24 md:mt-32">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Portals</p>
          <h2 id="roles-title" className="h-section mt-3 max-w-2xl">One facility, a portal for every party</h2>
        </div>
        <p className="lede max-w-md text-text-muted">Each party signs with its own wallet or passkey. Nobody, including CargoFlow, can move escrowed USDG anywhere else.</p>
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {lead.map((r) => (
          <Link key={r.href} href={r.href} className="group flex min-w-0 flex-col rounded-card border border-border bg-surface p-6 shadow-1 transition-[box-shadow,border-color] duration-(--duration-base) ease-standard hover:border-border-strong hover:shadow-2 md:p-8">
            <p className="eyebrow">{r.who}</p>
            <h3 className="mt-2 font-display text-h2">{r.title}</h3>
            <p className="mt-3 max-w-reading text-text-muted">{r.body}</p>
            <ul className="mt-5 flex flex-wrap gap-2">
              {r.points!.map((p) => (
                <li key={p} className="rounded-full bg-surface-sunken px-3 py-1 text-small text-ink/80">{p}</li>
              ))}
            </ul>
            <span className="mt-auto inline-flex items-center gap-2 pt-6 font-semibold">
              {r.cta}
              <Arrow />
            </span>
          </Link>
        ))}
      </div>
      <ul className="mt-4 grid overflow-hidden rounded-card border border-border bg-surface shadow-1 md:grid-cols-3">
        {rest.map((r, i) => (
          <li key={r.href} className={i > 0 ? "border-t border-border md:border-t-0 md:border-l" : undefined}>
            <Link href={r.href} className="group flex h-full flex-col p-5 transition-colors duration-(--duration-fast) hover:bg-paper md:p-6">
              <p className="eyebrow">{r.who}</p>
              <h3 className="mt-1.5 font-display text-h3">{r.title}</h3>
              <p className="mt-1.5 text-small text-text-muted">{r.body}</p>
              <span className="mt-auto inline-flex items-center gap-2 pt-4 text-small font-semibold">
                {r.cta}
                <Arrow />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
