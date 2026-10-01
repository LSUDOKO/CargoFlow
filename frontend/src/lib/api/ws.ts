"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { API_URL, wsURL } from "./client";

export type WsEvent = { type: string; shipmentId: string; seq: number; time: string; data?: unknown };

/** Adds an event to the newest-first list, ignoring duplicates (same seq) and keeping the newest 50. */
export function reduceEvents(prev: WsEvent[], ev: WsEvent): WsEvent[] {
  if (prev.some((p) => p.seq === ev.seq && p.type === ev.type)) return prev;
  return [ev, ...prev].sort((a, b) => b.seq - a.seq).slice(0, 50);
}

/**
 * Subscribes to a shipment's live events. Each event invalidates the shipment's queries so the views refetch
 * the authoritative state; the socket reconnects with backoff, and a 1013 close (slow consumer) refetches all.
 */
export function useShipmentStream(id: string | undefined) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<WsEvent[]>([]);
  useEffect(() => {
    if (!id) return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let delay = 500;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      for (const k of ["shipment", "epochs", "audit", "telemetry"]) void qc.invalidateQueries({ queryKey: [k, id] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    };
    const open = () => {
      if (stopped) return;
      ws = new WebSocket(wsURL(API_URL, id));
      ws.onopen = () => {
        setConnected(true);
        delay = 500;
      };
      ws.onmessage = (m) => {
        try {
          const ev = JSON.parse(String(m.data)) as WsEvent;
          setEvents((prev) => reduceEvents(prev, ev));
          invalidate();
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = (e) => {
        setConnected(false);
        if (e.code === 1013) invalidate();
        if (!stopped) {
          timer = setTimeout(open, delay);
          delay = Math.min(delay * 2, 8000);
        }
      };
      ws.onerror = () => ws?.close();
    };
    open();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, [id, qc]);
  return { connected, events };
}
