"use client";

import { CopyField } from "@/components/ui/CopyField";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Pill";
import { ROBINHOOD_TESTNET_ID } from "@/lib/explorer";

export type ContractRow = { key: string; name: string; role: string; address?: string; verified?: boolean };

const ExternalIcon = () => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
  </svg>
);

/**
 * A deployment table: contract and what it does, the address as one CopyField (copy + one explorer action), and a
 * single "Verified" badge. `explorer` is for chains the kit's explorer map does not know (Arbitrum Sepolia): the
 * address is then copy-only inside the field and the explorer link sits right after it.
 */
export function ContractTable({ rows, caption, explorer, chainId = ROBINHOOD_TESTNET_ID, showVerified = true }: {
  rows: ContractRow[];
  caption: string;
  explorer?: string;
  chainId?: number;
  showVerified?: boolean;
}) {
  const columns: Column<ContractRow>[] = [
    {
      key: "name",
      header: "Contract",
      primary: true,
      cell: (r) => (
        <span className="block min-w-0 py-1">
          <span className="block font-semibold text-ink">{r.name}</span>
          <span className="mt-0.5 block max-w-reading text-small text-text-muted">{r.role}</span>
        </span>
      ),
    },
    {
      key: "address",
      header: "Address",
      width: "15rem",
      cell: (r) =>
        r.address ? (
          explorer ? (
            <span className="inline-flex items-center gap-1">
              <CopyField value={r.address} kind="hash" size="sm" />
              <a
                href={`${explorer.replace(/\/+$/, "")}/address/${r.address}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`View ${r.name} on the explorer (opens in a new tab)`}
                className="grid h-7 w-7 place-items-center rounded-chip text-text-muted ring-1 ring-border ring-inset transition-colors hover:bg-ink/6 hover:text-ink"
              >
                <ExternalIcon />
              </a>
            </span>
          ) : (
            <CopyField value={r.address} kind="address" chainId={chainId} size="sm" />
          )
        ) : (
          <Badge variant="warning">Pending deployment</Badge>
        ),
    },
  ];
  if (showVerified) {
    columns.push({
      key: "verified",
      header: "Source",
      width: "7.5rem",
      cardLabel: "Source",
      cell: (r) => (r.verified !== false && r.address ? <Badge variant="success" dot>Verified</Badge> : <span className="text-small text-text-muted">–</span>),
    });
  }
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface shadow-1">
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} caption={caption} />
    </div>
  );
}
