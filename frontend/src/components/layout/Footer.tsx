import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { ROBINHOOD_EXPLORER } from "@/lib/explorer";

export function Footer() {
  return (
    <footer className="surface-ink mt-24 bg-ink text-paper">
      <div className="container-page grid gap-12 py-16 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div>
          <Logo tone="dark" />
          <p className="mt-4 max-w-sm text-paper/70">
            Working capital that releases only when the cargo&apos;s own evidence says it should.
          </p>
        </div>
        <FooterCol title="Product" links={[["/shipments", "Fleet"], ["/exporter", "For exporters"], ["/financier", "For financiers"], ["/buyer", "For buyers"]]} />
        <FooterCol title="Get started" links={[["/exporter", "Start a shipment"], ["/arbiter", "For arbiters"], ["/#how-it-works", "How it works"], ["/#faq", "Questions"]]} />
        <FooterCol
          title="Verify"
          links={[
            [ROBINHOOD_EXPLORER, "Robinhood testnet explorer"],
            ["https://github.com/LSUDOKO/CargoFlow", "Source code"],
            ["https://github.com/LSUDOKO/CargoFlow/blob/main/docs/runbooks/testnet.md", "Testnet run, transaction by transaction"],
          ]}
        />
      </div>
      <div className="border-t border-paper/10">
        <p className="container-page py-6 text-sm text-paper/55">
          Testnet prototype. Testnet USDG has no monetary value; contracts are unaudited. Not a regulated financial product.
        </p>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h2 className="font-display text-base font-semibold text-signal">{title}</h2>
      <ul className="mt-4 space-y-2.5">
        {links.map(([href, label]) => (
          <li key={href}>
            {href.startsWith("http") ? (
              <a href={href} target="_blank" rel="noreferrer" className="text-paper/80 hover:text-paper hover:underline">{label}</a>
            ) : (
              <Link href={href} className="text-paper/80 hover:text-paper hover:underline">{label}</Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
