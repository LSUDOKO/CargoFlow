import type { Metadata } from "next";
import Link from "next/link";
import { UseWithClaude } from "@/components/developers/UseWithClaude";
import { LinkButton } from "@/components/ui/Button";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { PageHeader, SectionHeader } from "@/components/ui/Section";
import { GITHUB_URL } from "@/lib/developer";

export const metadata: Metadata = {
  title: "Developers",
  description: "Build on CargoFlow: the TypeScript SDK, the MCP server for Claude and Cursor, the evidence gateway agent and the Python analytics SDK.",
};

const TOOLS = [
  {
    id: "sdk",
    name: "@cargoflow/sdk",
    kind: "TypeScript · Node 18+, browsers, Workers",
    blurb: "A typed client for every public endpoint, every wallet message byte-identical to the backend, ABIs and unsigned transaction builders, gateway signing, the CSV parser and document fingerprints.",
    install: "pnpm add @cargoflow/sdk viem",
    example: `import { createClient } from "@cargoflow/sdk";

const cf = createClient(); // the live API
const { shipments } = await cf.shipments.list({ status: ["PAUSED", "DISPUTED"] });
const why = await cf.shipments.explanation(shipments[0].id);`,
    readme: `${GITHUB_URL}/tree/main/packages/sdk`,
  },
  {
    id: "gateway",
    name: "@cargoflow/gateway",
    kind: "CLI · Linux, macOS, Windows, Raspberry Pi",
    blurb: "Runs next to your temperature loggers: parses their exports (generic CSV or vendor presets), de-duplicates, signs each batch with the gateway's own key and delivers it, with a durable offline queue.",
    install: "npm install -g @cargoflow/gateway",
    example: `cargoflow-gateway init --key ~/Downloads/cargoflow-gateway-<ref>-<id>.json
cargoflow-gateway send trip-0411.csv         # one shot
cargoflow-gateway watch ~/logger-exports     # keep running`,
    readme: `${GITHUB_URL}/tree/main/packages/gateway`,
  },
  {
    id: "python",
    name: "cargoflow (Python)",
    kind: "Python 3.10+ · pandas or polars",
    blurb: "Analytics-first: typed models of the read API, tidy data frames, exposure, excursion and conflict statistics, and a seeded Monte Carlo of default and recovery. Read-only.",
    install: `pip install cargoflow                 # pandas
pip install "cargoflow[polars]"       # + polars frames`,
    example: `from cargoflow import CargoFlow
from cargoflow import analytics as cfa

cf = CargoFlow()
pf = cf.portfolio()
cfa.exposure(pf)
cfa.simulate_default_recovery(pf, n_sims=20_000, seed=2026).summary()`,
    readme: `${GITHUB_URL}/tree/main/packages/python`,
  },
];

const SURFACES = [
  { name: "REST API", what: "OpenAPI 3.1, public reads, signed writes", href: "/docs" },
  { name: "@cargoflow/mcp", what: "Claude, Cursor and other assistants", href: "#claude" },
  { name: "@cargoflow/sdk", what: "Typed TypeScript client", href: "#sdk" },
  { name: "@cargoflow/gateway", what: "Edge agent for data loggers", href: "#gateway" },
  { name: "cargoflow (Python)", what: "Analytics and Monte Carlo", href: "#python" },
];

export default function DevelopersPage() {
  return (
    <div className="container-page py-(--space-page-y)">
      <PageHeader
        eyebrow="Developers"
        title="Build on CargoFlow"
        description="Everything the website does is open: a REST API with an OpenAPI spec, TypeScript and Python SDKs, an edge agent for data loggers and an MCP server so assistants can read shipments and prepare transactions for your wallet."
        actions={
          <>
            <LinkButton href="/docs" variant="ink">API reference</LinkButton>
            <LinkButton href="/deployments" variant="secondary">Contracts and services</LinkButton>
            <LinkButton href={GITHUB_URL} external variant="ghost">
              Source on GitHub<span className="sr-only"> (opens in a new tab)</span>
            </LinkButton>
          </>
        }
      />

      <nav aria-label="Developer surfaces" className="scroll-x -mx-(--gutter) px-(--gutter)">
        <ul className="flex min-w-max gap-2 md:grid md:min-w-0 md:grid-cols-5">
          {SURFACES.map((s) => (
            <li key={s.name} className="min-w-0">
              <Link href={s.href} className="flex h-full w-56 flex-col rounded-tile border border-border bg-surface px-4 py-3 transition-[border-color,box-shadow] duration-(--duration-fast) hover:border-border-strong hover:shadow-1 md:w-auto">
                <span className="font-mono text-small font-semibold">{s.name}</span>
                <span className="mt-0.5 text-small text-text-muted">{s.what}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-12 flex flex-col gap-16 md:mt-16">
        <section id="claude" className="scroll-mt-24" aria-labelledby="claude-title">
          <SectionHeader
            id="claude-title"
            title="Use CargoFlow in Claude"
            description={<>The <span className="font-mono text-ink">@cargoflow/mcp</span> server gives assistants read tools (shipments, evidence, explanations, cover, the market) and prepare tools that return unsigned transactions with a link to sign them here. No private keys, ever.</>}
            className="mb-6"
          />
          <div id="mcp" className="scroll-mt-24">
            <UseWithClaude />
          </div>
        </section>

        <section aria-labelledby="libs">
          <SectionHeader id="libs" title="Libraries and tools" description="Install, then copy the example. Each README has the full reference." className="mb-6" />
          <div className="flex flex-col gap-4">
            {TOOLS.map((t) => (
              <article key={t.id} id={t.id} className="grid scroll-mt-24 grid-cols-1 items-start gap-6 rounded-card border border-border bg-surface p-5 shadow-1 md:p-6 lg:grid-cols-12">
                <div className="min-w-0 lg:col-span-5">
                  <p className="eyebrow">{t.kind}</p>
                  <h3 className="mt-1.5 font-mono text-h3 font-semibold">{t.name}</h3>
                  <p className="mt-2 text-text-muted">{t.blurb}</p>
                  <a href={t.readme} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-small font-semibold underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
                    README and full reference<span className="sr-only"> (opens in a new tab)</span>
                    <span aria-hidden="true">↗</span>
                  </a>
                </div>
                <div className="flex min-w-0 flex-col gap-3 lg:col-span-7">
                  <CodeBlock label="Install" code={t.install} />
                  <CodeBlock label="Example" code={t.example} />
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
