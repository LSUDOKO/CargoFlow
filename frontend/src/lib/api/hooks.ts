"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { apiGet } from "./client";
import { AuditList, Config, DemoStatus, EpochList, Health, ShipmentList, ShipmentView, Stats, TelemetrySummary } from "./schemas";

export const useConfig = () => useQuery({ queryKey: ["config"], queryFn: () => apiGet("/v1/config", Config), staleTime: 5 * 60_000 });

export const useHealth = () =>
  useQuery({ queryKey: ["health"], queryFn: () => apiGet("/v1/health", Health), refetchInterval: 15_000, retry: 0 });

export const useStats = () => useQuery({ queryKey: ["stats"], queryFn: () => apiGet("/v1/stats", Stats), refetchInterval: 20_000 });

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

export const useDemoStatus = (id?: string) =>
  useQuery({ queryKey: ["demo", id], queryFn: () => apiGet(`/v1/demo/shipments/${id}`, DemoStatus), enabled: enabled(id), retry: 0 });

/** Live views for many shipments at once (portals filter them by the connected wallet's role). */
export function useShipmentViews(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({ queryKey: ["shipment", id], queryFn: () => apiGet(`/v1/shipments/${id}`, ShipmentView), staleTime: 10_000 })),
  });
}
