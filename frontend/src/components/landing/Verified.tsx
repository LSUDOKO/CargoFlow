"use client";

import { LinkButton } from "@/components/ui/Button";
import { CopyField } from "@/components/ui/CopyField";
import { Badge } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { useConfig } from "@/lib/api/hooks";
import { chainName, ROBINHOOD_TESTNET_ID } from "@/lib/explorer";

const roles: [string, string, string][] = [
  ["financingController", "Financing controller", "The state machine: release, pause, resume, settle"],
  ["receivableVault", "Receivable vault", "The only contract that ever holds USDG"],
  ["evidenceRegistry", "Evidence registry", "Merkle roots, scores and proof status per epoch"],
  ["groth16Verifier", "Groth16 verifier", "Checks recovery proofs on-chain"],
  ["shipmentRegistry", "Shipment registry", "Parties, invoice and route commitments"],
  ["policyEngine", "Policy engine", "The temperature band and evidence thresholds, frozen at registration"],
];

/** "Read the chain": the six core contracts as one list, each address copyable and one click from the explorer. */
export function Verified() {
  const { data, isPending } = useConfig();
  const testnet = data?.chainId === ROBINHOOD_TESTNET_ID;
  return (
    <section aria-labelledby="verified-title" className="container-page mt-24 md:mt-32">
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-5">
          <p className="eyebrow">Verify</p>
          <h2 id="verified-title" className="h-section mt-3">Don&apos;t trust the dashboard. Read the chain.</h2>
          <p className="lede mt-5 text-text-muted">
            Six immutable contracts, source-verified, no admin key that can move funds. Every number on this site can be checked against them.
          </p>
          <div className="mt-7">
            <LinkButton href="/deployments" variant="secondary">All contracts and services</LinkButton>
          </div>
        </div>
        <div className="min-w-0 rounded-card border border-border bg-surface shadow-1 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4 md:px-6">
            <h3 className="font-display text-h3">Core contracts</h3>
            {data && (testnet ? <Badge variant="success" dot>Source verified · {chainName(data.chainId)}</Badge> : <Badge>{chainName(data.chainId)}</Badge>)}
          </div>
          <ul className="divide-y divide-border">
            {roles.map(([key, name, what]) => (
              <li key={key} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 md:px-6">
                <div className="min-w-0">
                  <p className="font-semibold">{name}</p>
                  <p className="text-small text-text-muted">{what}</p>
                </div>
                <div className="shrink-0">
                  {isPending ? (
                    <Skeleton className="h-7 w-40" />
                  ) : data?.contracts[key] ? (
                    <CopyField value={data.contracts[key]!} kind="address" chainId={data.chainId} size="sm" />
                  ) : (
                    <span className="text-small text-text-muted">Not available</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
