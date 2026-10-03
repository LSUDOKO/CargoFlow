import type { Metadata } from "next";
import Link from "next/link";
import { UseWithClaude } from "@/components/developers/UseWithClaude";
import { CodeBlock } from "@/components/ui/CodeBlock";
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

export default function DevelopersPage() {
  return (
    <div className="container-page py-10 md:py-14">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold tracking-[0.12em] text-slate uppercase">Developers</p>
        <h1 className="mt-2 font-display text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.05] font-bold tracking-tight">Build on CargoFlow</h1>
        <p className="mt-4 text-lg text-ink/75">
          Everything the website does is open: a REST API with an OpenAPI spec, SDKs in TypeScript and Python, an edge agent for data loggers and an MCP server so assistants can read shipments and prepare transactions for your wallet.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/docs" className="inline-flex h-11 items-center rounded-full bg-ink px-5 font-semibold text-paper hover:bg-ink-2">API reference</Link>
          <Link href="/deployments" className="inline-flex h-11 items-center rounded-full border-2 border-ink/80 px-5 font-semibold hover:bg-ink hover:text-paper">Contracts and services</Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded-full border-2 border-ink/80 px-5 font-semibold hover:bg-ink hover:text-paper">
            Source on GitHub<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </header>

      <section id="claude" className="mt-14 scroll-mt-24" aria-labelledby="claude-title">
        <h2 id="claude-title" className="font-display text-2xl font-semibold md:text-3xl">Use CargoFlow in Claude</h2>
        <p className="mt-2 max-w-2xl text-slate">
          The <span className="font-mono text-ink">@cargoflow/mcp</span> server gives assistants read tools (shipments, evidence, explanations, cover, the market) and prepare tools that return unsigned transactions with a link to sign them here. No private keys, ever.
        </p>
        <div id="mcp" className="mt-6 scroll-mt-24">
          <UseWithClaude />
        </div>
      </section>

      <section className="mt-16" aria-labelledby="libs">
        <h2 id="libs" className="font-display text-2xl font-semibold md:text-3xl">Libraries and tools</h2>
        <div className="mt-6 flex flex-col gap-5">
          {TOOLS.map((t) => (
            <article key={t.id} id={t.id} className="grid scroll-mt-24 grid-cols-1 gap-5 rounded-[var(--radius-card)] border border-line bg-white p-5 md:p-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div>
                <p className="text-xs font-semibold tracking-wide text-slate uppercase">{t.kind}</p>
                <h3 className="mt-1 font-mono text-xl font-semibold">{t.name}</h3>
                <p className="mt-2 text-ink/80">{t.blurb}</p>
                <a href={t.readme} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
                  README and full reference<span className="sr-only"> (opens in a new tab)</span>
                </a>
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <CodeBlock label="Install" code={t.install} />
                <CodeBlock label="Example" code={t.example} />
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
