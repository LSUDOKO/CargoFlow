"use client";

// In-app notifications for the connected wallet: GET /v1/notifications?address= and the wallet-signed
// POST /v1/notifications/read. The message must stay byte-identical to backend/internal/auth/wallet.go
// (NotificationsReadAuthorization): lower-cased address and ids, "all" when no ids are named.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { z } from "zod";
import { API_URL, apiGet, apiPost } from "./client";
import { isUnavailable } from "./extras";

export const Notification = z.object({
  id: z.string(),
  address: z.string(),
  shipmentId: z.string().nullish().transform((v) => v ?? ""),
  kind: z.string(),
  title: z.string(),
  body: z.string().nullish().transform((v) => v ?? ""),
  link: z.string().nullish().transform((v) => v ?? ""),
  data: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
  readAt: z.string().nullish().transform((v) => v ?? null),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof Notification>;

export const NotificationList = z.object({
  notifications: z.array(Notification).nullish().transform((v) => v ?? []),
  unread: z.number().nullish().transform((v) => v ?? 0),
});
export type NotificationList = z.infer<typeof NotificationList>;

export const MarkReadResult = z.object({ marked: z.number(), unread: z.number() }).partial().passthrough();

export function notificationsReadMessage(address: string, ids: string[], issued: number): string {
  const list = ids.length ? ids.map((i) => i.toLowerCase()).join(",") : "all";
  return `CargoFlow notifications read\naddress: ${address.toLowerCase()}\nids: ${list}\nissued: ${issued}`;
}

export const postNotificationsRead = (body: { address: string; ids?: string[]; issuedAt: number; signature: string }) =>
  apiPost("/v1/notifications/read", body, MarkReadResult);

/**
 * A link from the backend (absolute, built from APP_URL, or relative) as an in-app path when it points at this app,
 * so it navigates without a reload; other absolute links are returned as they are.
 */
export function appPath(link: string, origin = typeof window !== "undefined" ? window.location.origin : ""): string {
  if (!link) return "";
  if (link.startsWith("/")) return link;
  try {
    const u = new URL(link);
    if (/^\/(track|market|parties|ebl|exporter|financier|buyer|arbiter|shipments)(\/|$|\?)/.test(u.pathname) || u.origin === origin) return `${u.pathname}${u.search}${u.hash}`;
    return link;
  } catch {
    return "";
  }
}

/** Where a notification leads: its link, or the shipment dashboard. */
export function notificationHref(n: Notification): string {
  return appPath(n.link) || (n.shipmentId ? `/track/${n.shipmentId}` : "");
}

const POLL_MS = 30_000;

export const notificationsKey = (address?: string) => ["notifications", address?.toLowerCase()] as const;

export function useNotifications(address?: string) {
  return useQuery({
    queryKey: notificationsKey(address),
    queryFn: () => apiGet(`/v1/notifications?address=${address!.toLowerCase()}&limit=50`, NotificationList),
    enabled: !!address && /^0x[0-9a-fA-F]{40}$/.test(address),
    refetchInterval: (q) => (q.state.error && isUnavailable(q.state.error) ? false : POLL_MS),
    retry: (n, e) => !isUnavailable(e) && n < 1,
  });
}

/** The latest RECOVERY_READY notification for this shipment and wallet, if any (newest first from the API). */
export function recoveryReady(list: Notification[] | undefined, shipmentId: string, sinceSec = 0): Notification | null {
  const id = shipmentId.toLowerCase();
  return list?.find((n) => n.kind === "RECOVERY_READY" && n.shipmentId.toLowerCase() === id && Date.parse(n.createdAt) / 1000 >= sinceSec) ?? null;
}

/**
 * Refetches the wallet's notifications whenever the event stream reports something (any shipment): events carry no
 * recipient, so the list is simply refreshed, at most once every 3 seconds.
 */
export function useNotificationStream(address?: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!address || typeof WebSocket === "undefined") return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let delay = 1000;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        void qc.invalidateQueries({ queryKey: notificationsKey(address) });
      }, 3000);
    };
    const open = () => {
      if (stopped) return;
      try {
        ws = new WebSocket(`${API_URL.replace(/^http/, "ws")}/v1/ws?shipment=*`);
      } catch {
        return;
      }
      ws.onopen = () => {
        delay = 1000;
      };
      ws.onmessage = refresh;
      ws.onclose = () => {
        if (stopped) return;
        retry = setTimeout(open, delay);
        delay = Math.min(delay * 2, 30_000);
      };
      ws.onerror = () => ws?.close();
    };
    open();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (pending) clearTimeout(pending);
      ws?.close();
    };
  }, [address, qc]);
}
