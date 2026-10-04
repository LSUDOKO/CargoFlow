import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { GITHUB_URL } from "@/lib/developer";
import { ROBINHOOD_EXPLORER } from "@/lib/explorer";

type Group = { title: string; links: [href: string, label: string][] };

/** Four groups, every destination once. Two columns on phones and tablets, four from lg. */
const groups: Group[] = [
  {
    title: "Product",
    links: [["/shipments", "Fleet"], ["/market", "Financing market"], ["/market/new", "Request financing"], ["/#how-it-works", "How it works"], ["/#faq", "Questions"]],
  },
  {
    title: "Portals",
    links: [["/exporter", "Exporters"], ["/financier", "Financiers"], ["/buyer", "Buyers"], ["/arbiter", "Arbiters"], ["/ebl", "Carriers"]],
  },
  {
    title: "Developers",
    links: [["/docs", "API reference"], ["/developers", "SDKs, MCP and gateway"], ["/developers#mcp", "Use with Claude (MCP)"], ["/developers#python", "Python analytics"]],
  },
  {
    title: "Verify",
    links: [
      ["/deployments", "Contracts and services"],
      [ROBINHOOD_EXPLORER, "Testnet explorer"],
      [GITHUB_URL, "Source code"],
      [`${GITHUB_URL}/blob/main/docs/runbooks/testnet.md`, "Testnet run, step by step"],
    ],
  },
];

const linkClass = "rounded-chip text-small text-paper/75 transition-colors duration-(--duration-fast) hover:text-paper hover:underline hover:underline-offset-4";

export function Footer() {
  return (
    <footer className="surface-ink mt-24 bg-ink text-paper md:mt-32">
      <div className="container-page grid gap-10 py-12 md:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] lg:gap-16">
        <div className="max-w-xs">
          <Logo tone="dark" className="h-8 w-auto" />
          <p className="mt-4 text-small text-paper/70">Working capital that releases only when the cargo&apos;s own evidence says it should.</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
          {groups.map((g) => (
            <div key={g.title} className="min-w-0">
              <h2 className="eyebrow">{g.title}</h2>
              <ul className="mt-3 flex flex-col gap-2">
                {g.links.map(([href, label]) => (
                  <li key={href}>
                    {href.startsWith("http") ? (
                      <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
                        {label}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <Link href={href} className={linkClass}>{label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="border-t border-border-ink">
        <div className="container-page flex flex-col gap-2 py-5 text-caption text-paper/70 md:flex-row md:items-center md:justify-between md:gap-6">
          <p>Production build, live on Robinhood Chain Testnet. Ready for use; mainnet release is next.</p>
          <p className="shrink-0">© 2026 CargoFlow · Robinhood Chain Testnet</p>
        </div>
      </div>
    </footer>
  );
}
