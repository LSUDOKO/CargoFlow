"use client";

import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { apiGet, fetchHealth } from "./client";
import { AuditList, Config, EpochList, GatewayList, ShipmentList, ShipmentView, Stats, TelemetrySummary } from "./schemas";

export const useConfig = () => useQuery({ queryKey: ["config"], queryFn: () => apiGet("/v1/config", Config), staleTime: 5 * 60_000 });

export const useHealth = () =>
  useQuery({ queryKey: ["health"], queryFn: () => fetchHealth(), refetchInterval: 15_000, retry: 0 });

export const useStats = () => useQuery({ queryKey: ["stats"], queryFn: () => apiGet("/v1/stats", Stats), refetchInterval: 20_000 });

/** Shipments where `party` is the exporter, financier or buyer (no 200-row ceiling: the backend filters). */
export const useShipmentsFor = (party: string | undefined) =>
  useQuery({
    queryKey: ["shipments", "party", party?.toLowerCase()],
    queryFn: () => apiGet(`/v1/shipments?party=${party}&limit=200`, ShipmentList),
    enabled: !!party,
    refetchInterval: 20_000,
  });

/** Shipments in any of these states, for the arbiter's queue. */
export const useShipmentsByStatus = (statuses: string[], enabledFlag = true) =>
  useQuery({
    queryKey: ["shipments", "status", statuses.join(",")],
    queryFn: () => apiGet(`/v1/shipments?status=${statuses.join(",")}&limit=200`, ShipmentList),
    enabled: enabledFlag,
    refetchInterval: 20_000,
  });

const PAGE = 50;

/** The fleet, page by page, using offsets so it never asks for more than the backend allows per request. */
export const useFleetPages = () =>
  useInfiniteQuery({
    queryKey: ["shipments", "fleet"],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => apiGet(`/v1/shipments?limit=${PAGE}&offset=${pageParam}`, ShipmentList),
    getNextPageParam: (last, pages) => (last.shipments.length === PAGE ? pages.length * PAGE : undefined),
    refetchInterval: 30_000,
  });

export const useShipments = (limit = 50, offset = 0) =>
  useQuery({
    queryKey: ["shipments", limit, offset],
    queryFn: () => apiGet(`/v1/shipments?limit=${limit}&offset=${offset}`, ShipmentList),
    refetchInterval: 20_000,
  });

const enabled = (id?: string) => !!id && /^0x[0-9a-fA-F]{64}$/.test(id);

export const useShipment = (id?: string) =>
  useQuery({
    queryKey: ["shipment", id],
    queryFn: () => apiGet(`/v1/shipments/${id}`, ShipmentView),
    enabled: enabled(id),
    retry: (n, e) => (e as { status?: number }).status !== 404 && n < 1,
  });

export const useEpochs = (id?: string) =>
  useQuery({ queryKey: ["epochs", id], queryFn: () => apiGet(`/v1/shipments/${id}/epochs`, EpochList), enabled: enabled(id) });

export const useAudit = (id?: string) =>
  useQuery({ queryKey: ["audit", id], queryFn: () => apiGet(`/v1/shipments/${id}/audit?limit=500`, AuditList), enabled: enabled(id) });

export const useTelemetry = (id?: string) =>
  useQuery({ queryKey: ["telemetry", id], queryFn: () => apiGet(`/v1/shipments/${id}/telemetry`, TelemetrySummary), enabled: enabled(id) });

export const useGateways = (id?: string) =>
  useQuery({ queryKey: ["gateways", id], queryFn: () => apiGet(`/v1/shipments/${id}/sources`, GatewayList), enabled: enabled(id) });

/** Live views for many shipments at once (portals filter them by the connected wallet's role). */
export function useShipmentViews(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({ queryKey: ["shipment", id], queryFn: () => apiGet(`/v1/shipments/${id}`, ShipmentView), staleTime: 10_000 })),
  });
}
