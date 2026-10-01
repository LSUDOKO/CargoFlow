"use client";

import { HashBadge } from "@/components/ui/HashBadge";
import { Pill } from "@/components/ui/Pill";
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

export function Verified() {
  const { data, isPending } = useConfig();
  const testnet = data?.chainId === ROBINHOOD_TESTNET_ID;
  return (
    <section aria-labelledby="verified-title" className="container-page mt-24 md:mt-32">
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <h2 id="verified-title" className="max-w-2xl font-display text-[clamp(2.2rem,4.6vw,3.6rem)] leading-[1] font-bold tracking-[-0.04em]">
          Don&apos;t trust the dashboard. Read the chain.
        </h2>
        <p className="max-w-md text-lg text-ink/75">
          Six immutable contracts, source-verified, no admin key that can move funds. Every number on this site can be checked against them.
        </p>
      </div>
      <ul className="mt-10 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {roles.map(([key, name, what]) => (
          <li key={key} className="rounded-2xl border border-line bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-lg font-semibold">{name}</h3>
              {data && <Pill tone={testnet ? "verified" : "slate"} dot>{testnet ? "Source verified" : chainName(data.chainId)}</Pill>}
            </div>
            <p className="mt-1.5 text-sm text-slate">{what}</p>
            <div className="mt-4">
              {isPending ? <Skeleton className="h-6 w-44" /> : data?.contracts[key] ? <HashBadge value={data.contracts[key]!} kind="address" chainId={data.chainId} /> : <span className="text-sm text-slate">Not available</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
