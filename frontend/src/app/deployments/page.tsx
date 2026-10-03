import type { Metadata } from "next";
import Link from "next/link";
import { ContractTable } from "@/components/developers/ContractTable";
import { LinkButton } from "@/components/ui/Button";
import { CopyField } from "@/components/ui/CopyField";
import { Badge } from "@/components/ui/Pill";
import { PageHeader, Section } from "@/components/ui/Section";
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

const ExternalIcon = () => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
  </svg>
);

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
    <div className="container-page py-(--space-page-y)">
      <PageHeader
        eyebrow="Verify"
        title="Deployments"
        description={<>Contracts v3 on Robinhood Chain Testnet (chain {cur.chainId ?? 46630}), deployed in blocks <span className="num">128,127,715 – 128,127,723</span>. Every address links to the explorer, where the verified source can be read.</>}
        actions={<LinkButton href={ROBINHOOD_EXPLORER} external variant="secondary" iconEnd={<ExternalIcon />}>Open the explorer<span className="sr-only"> (opens in a new tab)</span></LinkButton>}
      />

      <div className="flex flex-col gap-12 md:gap-16">
        <Section
          title={<span className="inline-flex flex-wrap items-center gap-3">Contracts v3 <Badge variant="success" dot pulse>Live</Badge></span>}
          description={`${current.length - (cur.usdg ? 1 : 0)} contracts and the settlement token, all source-verified on the Robinhood explorer.`}
          actions={cur.deployer ? <CopyField value={cur.deployer} label="Deployer" kind="address" chainId={cur.chainId ?? 46630} size="sm" /> : undefined}
        >
          <ContractTable rows={current} caption="CargoFlow contracts v3 on Robinhood Chain Testnet" />
        </Section>

        <Section title="Live services" description="Everything the contracts are read and written through.">
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-1">
            {services.map((s) => (
              <li key={s.name} className="flex flex-col gap-1.5 px-5 py-4 md:flex-row md:items-center md:justify-between md:gap-6">
                <div className="min-w-0">
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-small text-text-muted">{s.note}</p>
                </div>
                <div className="flex min-w-0 flex-col gap-1 md:items-end">
                  {s.href.startsWith("/") ? (
                    <Link href={s.href} className="truncate font-mono text-small font-semibold underline decoration-ink/25 underline-offset-4 hover:decoration-ink">{s.href}</Link>
                  ) : (
                    <a href={s.href} target="_blank" rel="noreferrer" title={s.href} className="max-w-full truncate font-mono text-small font-semibold underline decoration-ink/25 underline-offset-4 hover:decoration-ink">
                      {s.href.replace(/^https:\/\//, "")}<span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  )}
                  {s.extra && (
                    <p className="flex flex-wrap gap-3">
                      {s.extra.map((x) => <a key={x.href} href={x.href} target="_blank" rel="noreferrer" className="font-mono text-caption text-text-muted underline underline-offset-4 hover:text-ink">{x.label}<span className="sr-only"> (opens in a new tab)</span></a>)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Passkey accounts (ERC-4337)" description={<>Shared infrastructure on Robinhood Chain Testnet used by &quot;Continue with passkey&quot;: ZeroDev Kernel smart accounts with a WebAuthn validator.</>}>
          <ContractTable rows={PASSKEY_INFRA.map((r) => ({ key: r.address, ...r, verified: false }))} caption="Account abstraction contracts used for passkey accounts" showVerified={false} />
        </Section>

        <Section title="Arbitrum Sepolia · sponsor integrations" description="Fhenix and GMX do not run on Robinhood Chain, so these contracts live on Arbitrum Sepolia (chain 421614) and are linked to a shipment by its id.">
          <ContractTable rows={sponsor.map((c) => ({ ...c, address: arb.contracts?.[c.key], verified: false }))} caption="Sponsor integration contracts on Arbitrum Sepolia" explorer={arbExplorer} showVerified={false} />
          {arb.verification && <p className="mt-2 text-caption text-text-muted">Source verification: {arb.verification}.</p>}
        </Section>

        <Section title="History · contracts v1" description="The first deployment, superseded by v3. Kept for its transaction record; new shipments use v3.">
          <details className="group rounded-card border border-border bg-surface shadow-1">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-card px-5 py-4 text-small font-semibold [&::-webkit-details-marker]:hidden">
              Show {history.length} v1 contracts
              <svg viewBox="0 0 12 12" className="h-3 w-3 transition-transform duration-(--duration-fast) group-open:rotate-180" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </summary>
            <div className="border-t border-border">
              <ContractTable rows={history} caption="CargoFlow contracts v1 (history)" />
            </div>
          </details>
        </Section>
      </div>
    </div>
  );
}
