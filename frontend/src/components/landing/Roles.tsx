import Link from "next/link";
import { Character, type CharacterName } from "@/components/cast/Cast";
import type { Expression, HeldItem } from "@/components/cast/rig";
import { Carousel } from "@/components/story/Carousel";
import { LazyMount } from "@/components/story/Lazy";

type Role = { href: string; who: string; person: CharacterName; expression: Expression; prop: HeldItem; title: string; body: string; story: string; cta: string; points: string[] };

const roles: Role[] = [
  {
    href: "/exporter", who: "Exporters", person: "meera", expression: "happy", prop: "tablet", title: "Get paid while the cargo is still at sea",
    body: "Register the shipment and its cold-chain policy, name your financier, and receive each tranche the moment its evidence is committed.",
    story: "Meera draws 8,000 USDG at each of five milestones instead of waiting for the buyer.",
    cta: "Start as an exporter", points: ["Gateway for your data logger", "Tranches per milestone", "Residual at settlement"],
  },
  {
    href: "/financier", who: "Financiers", person: "daniel", expression: "confident", prop: "phone", title: "Lend against evidence, not paperwork",
    body: "Fund a facility from your own wallet. Escrow releases only on committed, in-policy evidence, and an excursion pauses it until a proof clears.",
    story: "Daniel's 40,000 USDG never leaves the vault unless the readings pass.",
    cta: "Fund a facility", points: ["Principal and fee first in the waterfall", "Optional default cover", "Portfolio view"],
  },
  {
    href: "/buyer", who: "Buyers", person: "weilin", expression: "happy", prop: "invoice", title: "Confirm delivery and pay once",
    body: "One payment settles the financier and the exporter in a fixed order, so there is nothing to reconcile afterwards.",
    story: "Wei Lin pays one invoice and both Daniel and Meera are settled in the same transaction.",
    cta: "Open the buyer portal", points: ["See who receives what before paying", "One transaction"],
  },
  {
    href: "/arbiter", who: "Arbiters", person: "arbiter", expression: "focused", prop: "folder", title: "Resolve disputes and defaults",
    body: "Rule on a disputed shipment with the evidence and the full audit trail in front of you.",
    story: "The Arbiter only steps in when the parties disagree, and every ruling carries a public reference.",
    cta: "Open the arbiter portal", points: ["Resume, lift a pause or declare a default", "Hashed, auditable decisions"],
  },
  {
    href: "/ebl", who: "Carriers", person: "carrier", expression: "confident", prop: "bol", title: "Issue and endorse bills of lading",
    body: "Electronic bills of lading as ERC-721 titles, bound to the facility they finance.",
    story: "The Carrier issues the bill; whoever holds it controls the goods, and it can be locked to the loan.",
    cta: "Open the carrier portal", points: ["Issue from the document's fingerprint", "Endorse and surrender"],
  },
];

const Arrow = () => (
  <svg viewBox="0 0 16 16" className="h-4 w-4 transition-transform duration-(--duration-base) ease-standard group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);

/** One facility, five parties: a sliding row of portals, each introduced by the person who uses it. */
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
      <Carousel label="Portals for every party" itemLabel="portal" className="mt-8">
        {roles.map((r, i) => (
          <li
            key={r.href}
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${roles.length}: ${r.who}`}
            className="w-[86%] shrink-0 snap-start sm:w-[62%] lg:w-[44%] xl:w-[40%]"
          >
            <Link
              href={r.href}
              className="group grid h-full min-w-0 grid-rows-[auto_1fr] overflow-hidden rounded-card border border-border bg-surface shadow-1 transition-[box-shadow,border-color] duration-(--duration-base) ease-standard hover:border-border-strong hover:shadow-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:grid-rows-1"
            >
              <div className="relative flex h-40 items-end justify-center overflow-hidden bg-mist sm:h-full sm:pb-4">
                <LazyMount className="relative flex h-full items-end justify-center">
                  <Character who={r.person} crop="waist" expression={r.expression} prop={r.prop} size={170} className="translate-y-2 sm:hidden" />
                  <Character who={r.person} expression={r.expression} prop={r.prop} look="right" className="hidden h-80 w-auto sm:block" />
                </LazyMount>
              </div>
              <div className="flex min-w-0 flex-col p-5 md:p-6">
                <p className="eyebrow">{r.who}</p>
                <h3 className="mt-2 font-display text-h2">{r.title}</h3>
                <p className="mt-2 text-text-muted">{r.body}</p>
                <p className="mt-3 border-l-2 border-signal-2 pl-3 text-small text-ink">{r.story}</p>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {r.points.map((p) => (
                    <li key={p} className="rounded-full bg-surface-sunken px-3 py-1 text-small text-ink/80">{p}</li>
                  ))}
                </ul>
                <span className="mt-auto inline-flex items-center gap-2 pt-5 font-semibold">
                  {r.cta}
                  <Arrow />
                </span>
              </div>
            </Link>
          </li>
        ))}
      </Carousel>
    </section>
  );
}
