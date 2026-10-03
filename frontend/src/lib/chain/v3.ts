"use client";

// Chain reads for contracts v3 (cancellation, bills of lading, parametric cover, device registry, the guardian's
// pause). They read the contracts directly so every v3 view works before the backend serves the matching fields;
// where the backend does serve them, its values fill what the chain cannot answer cheaply (possession history).
// On a v2 deployment each read fails and the hooks report "not available" rather than throwing.

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { fetchBill, fetchBills, type BillMove } from "@/lib/api/ebl";
import { useConfig } from "@/lib/api/hooks";
import type { ShipmentView } from "@/lib/api/schemas";
import { eblStatus, type Bill } from "@/lib/ebl";
import { accessAbi, controllerAbi, coverPoolAbi, deviceRegistryAbi, eblRegistryAbi, evidenceAbi } from "./abis";
import { useContracts } from "./contracts";
import { CARRIER_ROLE } from "./roles";

type ChainId = 46630 | 31337;
const isId = (id?: string): id is `0x${string}` => !!id && /^0x[0-9a-fA-F]{64}$/.test(id);
const lower = (a?: string) => (a ?? "").toLowerCase();

/* ---------- the guardian's pause ---------- */

export type PauseState = { controller: boolean; coverPool: boolean; devices: boolean };

/** Whether the guardian has paused new risk on each contract (OpenZeppelin Pausable). False on a v2 deployment. */
export function usePaused(): PauseState {
  const { contracts, chainId } = useContracts();
  const { data: cfg } = useConfig();
  const q = { enabled: !!contracts, refetchInterval: 30_000, retry: 0 } as const;
  const c = useReadContract({ address: contracts?.controller, abi: controllerAbi, functionName: "paused", chainId: chainId as ChainId, query: q });
  const p = useReadContract({ address: contracts?.coverPool, abi: coverPoolAbi, functionName: "paused", chainId: chainId as ChainId, query: { ...q, enabled: !!contracts?.coverPool } });
  const d = useReadContract({ address: contracts?.deviceRegistry, abi: deviceRegistryAbi, functionName: "paused", chainId: chainId as ChainId, query: { ...q, enabled: !!contracts?.deviceRegistry } });
  return {
    controller: c.data === true || !!cfg?.paused?.controller,
    coverPool: p.data === true || !!cfg?.paused?.coverPool,
    devices: d.data === true,
  };
}

/* ---------- cancellation ---------- */

/** The deposit time and CANCEL_TIMEOUT for a facility (undefined on a v2 controller). */
export function useCancelInfo(shipmentId: string | undefined, enabled = true) {
  const { contracts, chainId } = useContracts();
  const on = !!contracts && isId(shipmentId) && enabled;
  const reads = useReadContracts({
    contracts: on
      ? [
          { address: contracts!.controller, abi: controllerAbi, functionName: "financedAt", args: [shipmentId as `0x${string}`], chainId: chainId as ChainId },
          { address: contracts!.controller, abi: controllerAbi, functionName: "CANCEL_TIMEOUT", chainId: chainId as ChainId },
        ]
      : [],
    query: { enabled: on, refetchInterval: 60_000 },
  });
  const financedAt = reads.data?.[0]?.result as bigint | undefined;
  const timeout = reads.data?.[1]?.result as bigint | undefined;
  // a deployment that configures a v3 registry is v3; otherwise the controller has no cancelFacility when
  // CANCEL_TIMEOUT cannot be read (a v2 deployment; an unreachable node reads the same, so the config decides first)
  const v3 = !!(contracts?.deviceRegistry || contracts?.eblRegistry);
  const supported = v3 || (reads.data ? reads.data[1]?.status === "success" : undefined);
  return { financedAt, timeout, supported, loading: reads.isPending && on };
}

/* ---------- bills of lading ---------- */

type ChainBill = { documentHash: `0x${string}`; issuer: Address; shipper: Address; consignee: Address; status: number; issuedAt: bigint; closedAt: bigint; transfers: number };

const toBill = (tokenId: bigint, b: ChainBill, holder: string): Bill => ({
  tokenId,
  documentHash: b.documentHash,
  issuer: b.issuer,
  shipper: b.shipper,
  consignee: b.consignee,
  status: eblStatus(b.status),
  issuedAt: Number(b.issuedAt),
  closedAt: Number(b.closedAt),
  transfers: Number(b.transfers),
  holder,
});

/** One bill read from the chain (getBill + ownerOf). */
function useChainBill(tokenId: bigint | null | undefined) {
  const { contracts, chainId } = useContracts();
  const ebl = contracts?.eblRegistry;
  const on = !!ebl && !!tokenId && tokenId > 0n;
  const reads = useReadContracts({
    contracts: on
      ? [
          { address: ebl!, abi: eblRegistryAbi, functionName: "getBill", args: [tokenId!], chainId: chainId as ChainId },
          { address: ebl!, abi: eblRegistryAbi, functionName: "ownerOf", args: [tokenId!], chainId: chainId as ChainId },
        ]
      : [],
    query: { enabled: on, refetchInterval: 20_000, retry: 1 },
  });
  const raw = reads.data?.[0];
  const bill = raw?.status === "success" ? toBill(tokenId!, raw.result as unknown as ChainBill, (reads.data?.[1]?.result as string | undefined) ?? "") : null;
  return { bill, notFound: raw?.status === "failure", loading: on && reads.isPending };
}

/** The bill of lading bound to a facility: the controller's titleOf while escrowed, else the backend's or the logs'. */
export function useTitle(view: ShipmentView | undefined) {
  const { contracts, chainId } = useContracts();
  const client = usePublicClient({ chainId: chainId as ChainId });
  const id = view?.shipment.id;
  const on = !!contracts?.eblRegistry && isId(id);
  const t = useReadContract({ address: contracts?.controller, abi: controllerAbi, functionName: "titleOf", args: on ? [id as `0x${string}`] : undefined, chainId: chainId as ChainId, query: { enabled: on, refetchInterval: 20_000, retry: 1 } });
  const [bound, chainToken] = (t.data as readonly [boolean, bigint] | undefined) ?? [false, 0n];
  const backendToken = view?.title?.tokenId ? BigInt(view.title.tokenId) : 0n;
  const status = view?.facility?.status ?? "";
  // released already (settled, defaulted, cancelled) and the backend does not say which bill: find TitleBound in the logs
  const needLogs = on && !bound && backendToken === 0n && ["SETTLED", "DEFAULTED", "CANCELLED"].includes(status) && !!client;
  const logs = useQuery({
    queryKey: ["titleBound", id],
    enabled: needLogs,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      try {
        const ev = await client!.getContractEvents({ address: contracts!.controller, abi: controllerAbi, eventName: "TitleBound", args: { shipmentId: id as `0x${string}` }, fromBlock: 0n });
        return (ev.at(-1)?.args as { tokenId?: bigint } | undefined)?.tokenId ?? 0n;
      } catch {
        return 0n;
      }
    },
  });
  const tokenId = bound ? chainToken : backendToken || logs.data || 0n;
  const chainBill = useChainBill(tokenId || null);
  // the chain is authoritative; the backend's bill stands in when the node cannot be read
  const backend = useQuery({ queryKey: ["ebl", String(tokenId)], queryFn: () => fetchBill(String(tokenId)), enabled: !!tokenId && !chainBill.bill && !chainBill.loading, retry: 0 });
  const b = backend.data;
  const bill: Bill | null =
    chainBill.bill ??
    (b ? { tokenId: BigInt(b.tokenId), documentHash: b.documentHash, issuer: b.issuer, shipper: b.shipper, consignee: b.consignee, status: b.status, issuedAt: b.issuedAt, closedAt: b.closedAt, transfers: b.transfers, holder: b.holder } : null);
  return { enabled: !!contracts?.eblRegistry, bound, tokenId: tokenId || null, bill, loading: (on && t.isPending) || chainBill.loading || (backend.isLoading && !bill) };
}

/** A bill for the public page: chain state (authoritative) plus the backend's history and bound shipment. */
export function useBill(tokenId: bigint | null) {
  const { contracts, chainId } = useContracts();
  const client = usePublicClient({ chainId: chainId as ChainId });
  const chain = useChainBill(tokenId);
  const backend = useQuery({ queryKey: ["ebl", String(tokenId)], queryFn: () => fetchBill(String(tokenId)), enabled: !!tokenId, retry: 0 });
  const ebl = contracts?.eblRegistry;
  // possession history and bound shipment from the logs when the backend does not serve them
  const logs = useQuery({
    queryKey: ["eblLogs", String(tokenId), ebl],
    enabled: !!tokenId && !!ebl && !!client && backend.isFetched && !backend.data,
    staleTime: 60_000,
    queryFn: async () => {
      const out: { history: BillMove[]; boundShipmentId: string | null } = { history: [], boundShipmentId: null };
      try {
        const ev = await client!.getContractEvents({ address: ebl!, abi: eblRegistryAbi, eventName: "Transfer", args: { tokenId: tokenId! }, fromBlock: 0n });
        const blocks = new Map<bigint, number>();
        for (const e of ev.slice(-30)) {
          if (e.blockNumber !== null && !blocks.has(e.blockNumber)) {
            try {
              blocks.set(e.blockNumber, Number((await client!.getBlock({ blockNumber: e.blockNumber })).timestamp));
            } catch {
              /* leave the time out */
            }
          }
        }
        out.history = ev.map((e) => {
          const a = e.args as { from?: string; to?: string };
          return { from: a.from ?? "", to: a.to ?? "", txHash: e.transactionHash ?? "", at: (e.blockNumber !== null && blocks.get(e.blockNumber)) || 0 };
        });
      } catch {
        /* history unavailable */
      }
      try {
        if (contracts?.controller) {
          const b = await client!.getContractEvents({ address: contracts.controller, abi: controllerAbi, eventName: "TitleBound", args: { tokenId: tokenId! }, fromBlock: 0n });
          out.boundShipmentId = ((b.at(-1)?.args as { shipmentId?: string } | undefined)?.shipmentId as string | undefined) ?? null;
        }
      } catch {
        /* unknown */
      }
      return out;
    },
  });
  const b = backend.data;
  const bill: Bill | null =
    chain.bill ??
    (b
      ? { tokenId: BigInt(b.tokenId), documentHash: b.documentHash, issuer: b.issuer, shipper: b.shipper, consignee: b.consignee, status: b.status, issuedAt: b.issuedAt, closedAt: b.closedAt, transfers: b.transfers, holder: b.holder }
      : null);
  return {
    enabled: !!ebl,
    bill,
    history: b?.history.length ? b.history : (logs.data?.history ?? []),
    historyLoading: logs.isLoading,
    boundShipmentId: b?.boundShipmentId ?? logs.data?.boundShipmentId ?? null,
    notFound: chain.notFound && !b,
    loading: chain.loading || (backend.isPending && !!tokenId),
  };
}

const SCAN_LIMIT = 300;

/**
 * Bills the wallet holds or issued. The backend's holder index when served; otherwise a scan of the registry (token
 * ids are sequential from 1), capped at the newest 300 bills.
 */
export function useMyBills(address: string | undefined) {
  const { contracts, chainId } = useContracts();
  const ebl = contracts?.eblRegistry;
  const backend = useQuery({ queryKey: ["ebl", "holder", lower(address)], queryFn: () => fetchBills(address!), enabled: !!address, retry: 0, refetchInterval: 20_000 });
  const scan = !!ebl && !!address && backend.isFetched && !backend.data;
  const total = useReadContract({ address: ebl, abi: eblRegistryAbi, functionName: "totalIssued", chainId: chainId as ChainId, query: { enabled: scan, refetchInterval: 20_000 } });
  const n = Number((total.data as bigint | undefined) ?? 0n);
  const ids = Array.from({ length: Math.min(n, SCAN_LIMIT) }, (_, i) => BigInt(n - i));
  const reads = useReadContracts({
    contracts: scan ? ids.flatMap((id) => [
      { address: ebl!, abi: eblRegistryAbi, functionName: "getBill", args: [id], chainId: chainId as ChainId } as const,
      { address: ebl!, abi: eblRegistryAbi, functionName: "ownerOf", args: [id], chainId: chainId as ChainId } as const,
    ]) : [],
    query: { enabled: scan && ids.length > 0, refetchInterval: 20_000 },
  });
  let bills: Bill[] = [];
  if (backend.data) {
    bills = backend.data.bills.map((b) => ({ tokenId: BigInt(b.tokenId), documentHash: b.documentHash, issuer: b.issuer, shipper: b.shipper, consignee: b.consignee, status: b.status, issuedAt: b.issuedAt, closedAt: b.closedAt, transfers: b.transfers, holder: b.holder }));
  } else if (reads.data) {
    bills = ids
      .map((id, i) => {
        const b = reads.data![i * 2], o = reads.data![i * 2 + 1];
        return b?.status === "success" ? toBill(id, b.result as unknown as ChainBill, (o?.result as string | undefined) ?? "") : null;
      })
      .filter((b): b is Bill => !!b);
  }
  const me = lower(address);
  return {
    enabled: !!ebl,
    held: bills.filter((b) => lower(b.holder) === me),
    issued: bills.filter((b) => lower(b.issuer) === me),
    loading: !!address && (backend.isPending || (scan && (total.isPending || (ids.length > 0 && reads.isPending)))),
  };
}

/** Whether `address` holds CARRIER_ROLE (may issue bills). */
export function useIsCarrier(address: string | undefined) {
  const { contracts, chainId } = useContracts();
  const on = !!contracts?.eblRegistry && !!address;
  const r = useReadContract({ address: contracts?.access, abi: accessAbi, functionName: "hasRole", args: on ? [CARRIER_ROLE, address as Address] : undefined, chainId: chainId as ChainId, query: { enabled: on } });
  // unknown: the read failed (an unreachable RPC), so the page lets the contract decide instead of hiding the form
  return { isCarrier: r.data === true, unknown: on && r.isError, loading: on && r.isPending };
}

/** Whether the controller may move `tokenId` for its holder (approve or operator approval). */
export function useControllerApproval(tokenId: bigint | null, holder: string | undefined) {
  const { contracts, chainId } = useContracts();
  const ebl = contracts?.eblRegistry;
  const on = !!ebl && !!tokenId && !!holder && !!contracts;
  const reads = useReadContracts({
    contracts: on
      ? [
          { address: ebl!, abi: eblRegistryAbi, functionName: "getApproved", args: [tokenId!], chainId: chainId as ChainId },
          { address: ebl!, abi: eblRegistryAbi, functionName: "isApprovedForAll", args: [holder as Address, contracts!.controller], chainId: chainId as ChainId },
        ]
      : [],
    query: { enabled: on, refetchInterval: 10_000 },
  });
  const approved = lower(reads.data?.[0]?.result as string | undefined) === lower(contracts?.controller) || reads.data?.[1]?.result === true;
  return { approved, loading: on && reads.isPending };
}

/* ---------- parametric cover ---------- */

type ChainParametric = { consecutiveFailedEpochs: number; salvageToExporter: bigint; epochFloor: number; exporter: Address; exporterSalvage: bigint };
type ChainCover = { insurer: Address; financier: Address; amount: bigint; premium: bigint; status: number; financierPayout: bigint; insurerReturn: bigint };
const COVER_STATUS = ["NONE", "ACTIVE", "RELEASED", "CLAIMED", "TRIGGERED"] as const;

/** The accepted cover's parametric terms and status, read from the pool (null on a v2 pool or a plain cover). */
export function useParametricCover(shipmentId: string | undefined, enabled = true) {
  const { contracts, chainId } = useContracts();
  const pool = contracts?.coverPool;
  const on = !!pool && isId(shipmentId) && enabled;
  const reads = useReadContracts({
    contracts: on
      ? [
          { address: pool!, abi: coverPoolAbi, functionName: "getParametricCover", args: [shipmentId as `0x${string}`], chainId: chainId as ChainId },
          { address: pool!, abi: coverPoolAbi, functionName: "getCover", args: [shipmentId as `0x${string}`], chainId: chainId as ChainId },
        ]
      : [],
    query: { enabled: on, refetchInterval: 20_000 },
  });
  const p = reads.data?.[0]?.status === "success" ? (reads.data[0].result as unknown as ChainParametric) : null;
  const c = reads.data?.[1]?.status === "success" ? (reads.data[1].result as unknown as ChainCover) : null;
  return {
    parametric: p && p.consecutiveFailedEpochs > 0 ? { consecutiveFailedEpochs: Number(p.consecutiveFailedEpochs), salvageToExporter: String(p.salvageToExporter), epochFloor: Number(p.epochFloor), exporterSalvage: String(p.exporterSalvage) } : null,
    status: c ? COVER_STATUS[Number(c.status)] ?? "NONE" : undefined,
    payouts: c ? { financier: String(c.financierPayout), insurer: String(c.insurerReturn) } : undefined,
  };
}

/** The parametric terms attached to each insurer's open offer (null for a plain offer). */
export function useOfferTriggers(shipmentId: string | undefined, insurers: string[]) {
  const { contracts, chainId } = useContracts();
  const pool = contracts?.coverPool;
  const on = !!pool && isId(shipmentId) && insurers.length > 0;
  const reads = useReadContracts({
    contracts: on ? insurers.map((i) => ({ address: pool!, abi: coverPoolAbi, functionName: "getOfferTrigger", args: [shipmentId as `0x${string}`, i as Address], chainId: chainId as ChainId }) as const) : [],
    query: { enabled: on, refetchInterval: 30_000 },
  });
  const out = new Map<string, { consecutiveFailedEpochs: number; salvageToExporter: string } | null>();
  insurers.forEach((ins, i) => {
    const r = reads.data?.[i];
    const t = r?.status === "success" ? (r.result as unknown as { consecutiveFailedEpochs: number; salvageToExporter: bigint }) : null;
    out.set(lower(ins), t && t.consecutiveFailedEpochs > 0 ? { consecutiveFailedEpochs: Number(t.consecutiveFailedEpochs), salvageToExporter: String(t.salvageToExporter) } : null);
  });
  return out;
}

/** Commit ordinals (EvidenceRegistry.epochOrdinal) of the given epochs, 0 when unknown, plus the shipment's epoch count. */
export function useEpochOrdinals(shipmentId: string | undefined, epochIds: string[], enabled = true) {
  const { contracts, chainId } = useContracts();
  const on = !!contracts && isId(shipmentId) && enabled;
  const countRead = useReadContract({ address: contracts?.evidence, abi: evidenceAbi, functionName: "epochCount", args: on ? [shipmentId as `0x${string}`] : undefined, chainId: chainId as ChainId, query: { enabled: on, refetchInterval: 20_000 } });
  const reads = useReadContracts({
    contracts: on ? epochIds.map((e) => ({ address: contracts!.evidence, abi: evidenceAbi, functionName: "epochOrdinal", args: [e as `0x${string}`], chainId: chainId as ChainId }) as const) : [],
    query: { enabled: on && epochIds.length > 0, refetchInterval: 20_000 },
  });
  const ordinals = new Map<string, number>();
  epochIds.forEach((e, i) => {
    const r = reads.data?.[i];
    ordinals.set(lower(e), r?.status === "success" ? Number(r.result) : 0);
  });
  const count = countRead.data !== undefined ? Number(countRead.data) : undefined;
  return { ordinals, count, loading: on && (countRead.isPending || (epochIds.length > 0 && reads.isPending)) };
}

/* ---------- device registry ---------- */

export type OnChainDevice = { registered: boolean; deviceClass: number; revoked: boolean };

/** The DeviceRegistry record of each key hash (registered false when unknown). Empty without a registry. */
export function useDevicesOnChain(keyHashes: string[]) {
  const { contracts, chainId } = useContracts();
  const reg = contracts?.deviceRegistry;
  const keys = keyHashes.filter((k) => isId(k));
  const on = !!reg && keys.length > 0;
  const reads = useReadContracts({
    contracts: on ? keys.map((k) => ({ address: reg!, abi: deviceRegistryAbi, functionName: "getDevice", args: [k as `0x${string}`], chainId: chainId as ChainId }) as const) : [],
    query: { enabled: on, refetchInterval: 60_000 },
  });
  const out = new Map<string, OnChainDevice>();
  keys.forEach((k, i) => {
    const r = reads.data?.[i];
    if (!r) return;
    if (r.status === "success") {
      const d = r.result as unknown as { deviceClass: number; revoked: boolean; registeredAt: bigint };
      out.set(lower(k), { registered: Number(d.registeredAt) > 0, deviceClass: Number(d.deviceClass), revoked: d.revoked });
    } else out.set(lower(k), { registered: false, deviceClass: 0, revoked: false });
  });
  return { enabled: !!reg, devices: out };
}
