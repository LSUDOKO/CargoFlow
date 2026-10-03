"use client";

// The logger track (replay) and the AIS vessel for a shipment. Both endpoints are newer than the rest of the API:
// a 404 means "not available" (no vessel registered, or a backend that predates them), never an error to show.

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, apiGet } from "@/lib/api/client";

const list = <T extends z.ZodTypeAny>(item: T) => z.array(item).nullish().transform((v) => v ?? []);

export const TrackPoint = z.object({
  epochId: z.string(),
  milestoneIndex: z.number(),
  sequence: z.number(),
  startTime: z.number(),
  endTime: z.number(),
  latE6: z.number(),
  lonE6: z.number(),
  minTempX100: z.number(),
  maxTempX100: z.number(),
  pass: z.boolean(),
  committed: z.boolean().optional().default(false),
});
export type TrackPoint = z.infer<typeof TrackPoint>;
export const Track = z.object({ points: list(TrackPoint) });

export const Vessel = z.object({
  mmsi: z.union([z.string(), z.number()]).transform(String),
  name: z.string().optional().default(""),
  live: z.boolean().optional().default(false),
  last: z
    .object({ latE6: z.number(), lonE6: z.number(), timestamp: z.number(), sogKnotsX10: z.number().optional(), cogDegX10: z.number().optional() })
    .nullish()
    .transform((v) => v ?? null),
  track: list(z.object({ latE6: z.number(), lonE6: z.number(), timestamp: z.number() })),
  crossCheck: z
    .object({ loggerLatE6: z.number(), loggerLonE6: z.number(), distanceM: z.number(), ageSec: z.number(), agrees: z.boolean() })
    .nullish()
    .transform((v) => v ?? null),
});
export type Vessel = z.infer<typeof Vessel>;

const valid = (id?: string) => !!id && /^0x[0-9a-fA-F]{64}$/.test(id);

/** null when the endpoint answers 404 (or 405/501 from an older backend). */
async function optional<S extends z.ZodTypeAny>(path: string, schema: S): Promise<z.infer<S> | null> {
  try {
    return await apiGet(path, schema);
  } catch (e) {
    if (e instanceof ApiError && [404, 405, 501].includes(e.status)) return null;
    throw e;
  }
}

export const useTrack = (id?: string) =>
  useQuery({
    queryKey: ["geo", "track", id?.toLowerCase()],
    queryFn: () => optional(`/v1/shipments/${id}/track`, Track),
    enabled: valid(id),
    refetchInterval: 30_000,
    retry: 1,
  });

export const useVessel = (id?: string) =>
  useQuery({
    queryKey: ["geo", "vessel", id?.toLowerCase()],
    queryFn: () => optional(`/v1/shipments/${id}/vessel`, Vessel),
    enabled: valid(id),
    refetchInterval: 60_000,
    retry: 1,
  });

export type ReplayDetail = { epochId: string; index: number; sequence: number };

/** The event the map's replay slider fires on window, so other panels (the temperature chart) can follow it. */
export const REPLAY_EVENT = "cargoflow:replay";

export function emitReplay(detail: ReplayDetail | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ReplayDetail | null>(REPLAY_EVENT, { detail }));
}
