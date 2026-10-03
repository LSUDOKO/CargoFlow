"use client";

import { CopyField } from "@/components/ui/CopyField";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Pill";
import { ROBINHOOD_TESTNET_ID } from "@/lib/explorer";

export type ContractRow = { key: string; name: string; role: string; address?: string; verified?: boolean };

/**
 * A deployment table: contract and what it does, the address as one CopyField (copy + one explorer action), and a
 * single "Verified" badge. `explorer` is the explorer root for chains the app's explorer map does not know
 * (Arbitrum Sepolia: https://sepolia.arbiscan.io); the field's explorer action then links there.
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
          <CopyField value={r.address} kind="address" chainId={chainId} explorerBase={explorer} srLabel={r.name} size="sm" />
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
