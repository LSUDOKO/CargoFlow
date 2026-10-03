import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/ui/CodeBlock";
import arbitrum from "@/data/deployments/arbitrum-sepolia.json";
import v3 from "@/data/deployments/robinhood-testnet.json";
import v1 from "@/data/deployments/robinhood-testnet-v1.json";
import { DOCS_API_URL, GITHUB_URL, MCP_URL, PUBLIC_SITE_URL } from "@/lib/developer";
import { ROBINHOOD_EXPLORER } from "@/lib/explorer";

export const metadata: Metadata = {
  title: "Deployments",
  description: "Every CargoFlow contract on Robinhood Chain Testnet with verified source, the live services and the sponsor deployments.",
};

/** What each contract does, in one line. */
const ROLES: Record<string, { name: string; role: string }> = {
  access: { name: "CargoFlowAccess", role: "Roles (admin, worker, monitor, arbiter, attestor) with a two-step, delayed admin transfer" },
  shipmentRegistry: { name: "ShipmentRegistry", role: "Shipments: parties, invoice hash, route commitment, milestone places" },
  policyEngine: { name: "PolicyEngine", role: "Each shipment's evidence policy: temperature band, humidity and shock limits, sensors" },
  evidenceRegistry: { name: "EvidenceRegistry", role: "Committed evidence epochs: Merkle roots, scores and aggregates (never raw readings)" },
  receivableVault: { name: "ReceivableVault", role: "USDG escrow: deposits, milestone releases, the settlement waterfall" },
  financingController: { name: "FinancingController", role: "The facility state machine: releases, pauses, ZK resume, disputes, delivery, cancellation" },
  groth16Verifier: { name: "Groth16Verifier", role: "Verifies the zero-knowledge recovery proof on chain" },
  coverPool: { name: "CoverPool", role: "Default cover and parametric triggers: offers, acceptance, claims, payouts" },
  deviceRegistry: { name: "DeviceRegistry", role: "Evidence devices and their class (software, passkey, secure element)" },
  eblRegistry: { name: "EBLRegistry", role: "Electronic bills of lading (ERC-721): issue, endorse, surrender, bind to a facility" },
};
const ORDER = ["access", "shipmentRegistry", "policyEngine", "evidenceRegistry", "receivableVault", "financingController", "groth16Verifier", "coverPool", "deviceRegistry", "eblRegistry"];

const PASSKEY_INFRA = [
  { name: "EntryPoint v0.7", role: "ERC-4337 entry point for passkey smart accounts", address: "0x0000000071727De22E5E9d8BAf0edAc6f37da032" },
  { name: "Kernel v3.1 meta factory", role: "Deploys ZeroDev Kernel accounts", address: "0xd703aaE79538628d27099B8c4f621bE4CCd142d5" },
  { name: "Kernel v3.1 implementation", role: "The smart-account code each passkey account runs", address: "0xbAC849bB641841b44E965fB01A4Bf5F074f84b4D" },
  { name: "Kernel v3.3 factory", role: "Available, not used by CargoFlow", address: "0x2577507b78c2008Ff367261CB6285d44ba5eF2E9" },
  { name: "WebAuthn validator 0.0.3", role: "Checks passkey signatures (RIP-7212 P-256 precompile at 0x100)", address: "0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69" },
];

type Manifest = { chainId?: number; contracts?: Record<string, string>; deployer?: string; usdg?: string; explorer?: string; verification?: string; roles?: Record<string, string> };

const addressUrl = (a: string, base = ROBINHOOD_EXPLORER) => `${base.replace(/\/+$/, "")}/address/${a}`;

function Address({ value, explorer = ROBINHOOD_EXPLORER, verified = true }: { value: string; explorer?: string; verified?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <a href={addressUrl(value, explorer)} target="_blank" rel="noreferrer" className="font-mono text-[0.8125rem] font-semibold break-all underline decoration-ink/25 underline-offset-2 hover:decoration-ink">
        {value}<span className="sr-only"> (opens the explorer in a new tab)</span>
      </a>
      <CopyButton text={value} />
      {verified && (
        <a href={`${addressUrl(value, explorer)}?tab=contract`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-verified/12 px-2.5 py-0.5 text-xs font-semibold text-[#00733e] hover:bg-verified/20">
          ✓ Verified source<span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </div>
  );
}

function Table({ rows, caption, explorer }: { rows: { key: string; name: string; role: string; address: string; verified?: boolean }[]; caption: string; explorer?: string }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="hidden bg-mist text-xs tracking-wide text-slate uppercase md:table-header-group">
          <tr>
            <th scope="col" className="px-5 py-3 font-semibold">Contract</th>
            <th scope="col" className="px-5 py-3 font-semibold">Address</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.key} className="flex flex-col gap-2 px-5 py-4 md:table-row md:p-0">
              <th scope="row" className="font-normal md:w-[45%] md:px-5 md:py-4 md:align-top">
                <span className="block font-semibold">{r.name}</span>
                <span className="mt-0.5 block text-slate">{r.role}</span>
              </th>
              <td className="md:px-5 md:py-4 md:align-top">
                <Address value={r.address} explorer={explorer} verified={r.verified !== false} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DeploymentsPage() {
  const cur = v3 as Manifest;
  const old = v1 as Manifest;
  const arb = arbitrum as Manifest;
  const current = ORDER.filter((k) => cur.contracts?.[k]).map((k) => ({ key: k, ...ROLES[k]!, address: cur.contracts![k]! }));
  if (cur.usdg) current.push({ key: "usdg", name: "USDG (Paxos)", role: "The settlement token: Paxos's USDG on Robinhood Chain Testnet, 6 decimals", address: cur.usdg });
  const history = Object.entries(old.contracts ?? {}).map(([k, a]) => ({ key: k, name: ROLES[k]?.name ?? k, role: ROLES[k]?.role ?? "", address: a }));
  const arbExplorer = arb.explorer ?? "https://sepolia.arbiscan.io";
  const sponsor = [
    { key: "confidentialInvoiceTerms", name: "ConfidentialInvoiceTerms (Fhenix CoFHE)", role: "Encrypted invoice margin and penalty schedule, computed under FHE" },
    { key: "gmxHedgeVault", name: "GMXHedgeVault (GMX v2)", role: "A financier's optional price hedge, sized to their CargoFlow exposure" },
  ];
  const services = [
    { name: "Website", href: PUBLIC_SITE_URL, note: "This app on Cloudflare Workers" },
    { name: "API", href: DOCS_API_URL, note: "Go backend", extra: [{ label: "/v1/health", href: `${DOCS_API_URL}/v1/health` }, { label: "/v1/openapi.json", href: `${DOCS_API_URL}/v1/openapi.json` }] },
    { name: "API reference", href: "/docs", note: "Interactive, with request recipes" },
    { name: "MCP server", href: MCP_URL, note: "Remote, Streamable HTTP; add it to Claude as a custom connector" },
    { name: "Source", href: GITHUB_URL, note: "Contracts, backend, web app, SDKs" },
  ];

  return (
    <div className="container-page py-10 md:py-14">
      <header className="max-w-3xl">
        <p className="text-sm font-semibold tracking-[0.12em] text-slate uppercase">Verify</p>
        <h1 className="mt-2 font-display text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.05] font-bold tracking-tight">Deployments</h1>
        <p className="mt-4 text-lg text-ink/75">
          Contracts v3 on Robinhood Chain Testnet (chain {cur.chainId ?? 46630}), deployed in blocks 128,127,715 – 128,127,723. Every address links to the explorer, where the verified source can be read.
        </p>
      </header>

      <section className="mt-10" aria-labelledby="v3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="v3" className="font-display text-2xl font-semibold">Contracts v3 · live</h2>
          {cur.deployer && <p className="text-sm text-slate">Deployer <span className="font-mono">{cur.deployer}</span></p>}
        </div>
        <div className="mt-4"><Table rows={current} caption="CargoFlow contracts v3 on Robinhood Chain Testnet" /></div>
      </section>

      <section className="mt-12" aria-labelledby="services">
        <h2 id="services" className="font-display text-2xl font-semibold">Live services</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <li key={s.name} className="rounded-2xl border border-line bg-white px-4 py-3.5">
              <p className="font-semibold">{s.name}</p>
              <p className="text-sm text-slate">{s.note}</p>
              {s.href.startsWith("/") ? (
                <Link href={s.href} className="mt-1 block font-mono text-[0.8125rem] font-semibold break-all underline decoration-ink/25 underline-offset-2">{s.href}</Link>
              ) : (
                <a href={s.href} target="_blank" rel="noreferrer" className="mt-1 block font-mono text-[0.8125rem] font-semibold break-all underline decoration-ink/25 underline-offset-2">{s.href}<span className="sr-only"> (opens in a new tab)</span></a>
              )}
              {s.extra && (
                <p className="mt-1 flex flex-wrap gap-3 text-xs">
                  {s.extra.map((x) => <a key={x.href} href={x.href} target="_blank" rel="noreferrer" className="font-mono font-semibold text-slate underline underline-offset-2 hover:text-ink">{x.label}</a>)}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12" aria-labelledby="aa">
        <h2 id="aa" className="font-display text-2xl font-semibold">Passkey accounts (ERC-4337)</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate">Shared infrastructure on Robinhood Chain Testnet used by &quot;Continue with passkey&quot;: ZeroDev Kernel smart accounts with a WebAuthn validator.</p>
        <div className="mt-4"><Table rows={PASSKEY_INFRA.map((r) => ({ key: r.address, ...r, verified: false }))} caption="Account abstraction contracts used for passkey accounts" /></div>
      </section>

      <section className="mt-12" aria-labelledby="sponsors">
        <h2 id="sponsors" className="font-display text-2xl font-semibold">Arbitrum Sepolia · sponsor integrations</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate">Fhenix and GMX do not run on Robinhood Chain, so these contracts live on Arbitrum Sepolia (chain 421614) and are linked to a shipment by its id.</p>
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
          {sponsor.map((c) => {
            const address = arb.contracts?.[c.key];
            return (
              <li key={c.key} className="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-start md:gap-6">
                <div className="md:w-[45%]">
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-sm text-slate">{c.role}</p>
                </div>
                {address ? (
                  <Address value={address} explorer={arbExplorer} verified={false} />
                ) : (
                  <span className="self-start rounded-full bg-alert/15 px-3 py-1 text-xs font-semibold">Pending deployment</span>
                )}
              </li>
            );
          })}
        </ul>
        {arb.verification && <p className="mt-2 text-xs text-slate">Source verification: {arb.verification}.</p>}
      </section>

      <section className="mt-12" aria-labelledby="history">
        <h2 id="history" className="font-display text-2xl font-semibold">History · contracts v1</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate">The first deployment, superseded by v3. Kept for its transaction record; new shipments use v3.</p>
        <details className="mt-4 group">
          <summary className="cursor-pointer text-sm font-semibold underline-offset-4 hover:underline">Show {history.length} v1 contracts</summary>
          <div className="mt-3"><Table rows={history} caption="CargoFlow contracts v1 (history)" /></div>
        </details>
      </section>
    </div>
  );
}
