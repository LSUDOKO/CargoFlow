// zod schemas mirroring the Go API's JSON (backend/internal/{store,service,api}). Go encodes nil slices and maps
// as null, so list fields accept null and normalise it to an empty value.
import { z } from "zod";

const list = <T extends z.ZodTypeAny>(item: T) => z.array(item).nullish().transform((v) => v ?? []);
const amount = z.string(); // USDG base units as a decimal string

export const Policy = z.object({
  minTempX100: z.number(),
  maxTempX100: z.number(),
  maxGapSec: z.number(),
  maxRouteDeviationM: z.number(),
  minEvidenceScore: z.number(),
  maxConflictBps: z.number(),
  maxRiskBps: z.number(),
  requiresZk: z.boolean(),
  minSensors: z.number(),
});

export const RoutePoint = z.object({ latE6: z.number(), lonE6: z.number() });

export const Shipment = z.object({
  id: z.string(),
  externalRef: z.string(),
  exporter: z.string(),
  buyer: z.string(),
  financier: z.string().optional().default(""),
  invoiceHash: z.string(),
  routeCommitment: z.string(),
  policyCommitment: z.string(),
  invoiceValue: amount,
  policy: Policy,
  route: list(RoutePoint),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Shipment = z.infer<typeof Shipment>;

export const ShipmentList = z.object({ shipments: list(Shipment), limit: z.number(), offset: z.number() });

export const Milestone = z.object({
  index: z.number(),
  description: z.string(),
  allocatedUsdg: amount,
  evidenceThreshold: z.number(),
  checkpointCommitment: z.string(),
  released: z.boolean(),
  releaseTxHash: z.string().optional(),
  releasedAt: z.string().optional(),
});
export type Milestone = z.infer<typeof Milestone>;

export const Facility = z.object({
  status: z.string(),
  exporter: z.string(),
  financier: z.string(),
  buyer: z.string(),
  committed: amount,
  drawn: amount,
  remaining: amount,
  feeBps: z.number(),
  nextMilestone: z.number(),
  milestoneCount: z.number(),
  pausedAt: z.number(),
  pauseReason: z.string().optional(),
  pauseCount: z.number(),
  funded: z.boolean(),
  vaultPaused: z.boolean(),
  closed: z.boolean(),
});
export type Facility = z.infer<typeof Facility>;

export const EpochSummary = z.object({
  sequence: z.number(),
  milestoneIndex: z.number(),
  epochId: z.string(),
  root: z.string(),
  readingCount: z.number(),
  startTime: z.number(),
  endTime: z.number(),
  score: z.number(),
  conflictBps: z.number(),
  riskBps: z.number(),
  compliant: z.boolean(),
  penalties: z.record(z.string(), z.number()).nullish().transform((v) => v ?? {}),
  decisionPass: z.boolean(),
  decisionAction: z.string(),
  reasons: list(z.string()),
  commitTx: z.string().optional(),
  proofVerified: z.boolean(),
  createdAt: z.string(),
});
export type EpochSummary = z.infer<typeof EpochSummary>;
export const EpochList = z.object({ epochs: list(EpochSummary) });

export const ShipmentView = z.object({
  shipment: Shipment,
  milestones: list(Milestone),
  facility: Facility.nullable(),
  latestEvidence: EpochSummary.nullable(),
  quarantinedReadings: z.number(),
  usdgDecimals: z.number(),
});
export type ShipmentView = z.infer<typeof ShipmentView>;

export const AuditEntry = z.object({
  time: z.string(),
  kind: z.string(),
  title: z.string(),
  txHash: z.string().optional(),
  detail: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
});
export type AuditEntry = z.infer<typeof AuditEntry>;
export const AuditList = z.object({ entries: list(AuditEntry) });

export const SensorSummary = z.object({
  sensorId: z.string(),
  readings: z.number(),
  minTempX100: z.number(),
  maxTempX100: z.number(),
  meanTempX100: z.number(),
});
export const EpochTelemetry = z.object({
  epochId: z.string(),
  milestoneIndex: z.number(),
  startTime: z.number(),
  endTime: z.number(),
  sensors: list(SensorSummary),
});
export type EpochTelemetry = z.infer<typeof EpochTelemetry>;
export const TelemetrySummary = z.object({
  epochs: list(EpochTelemetry),
  position: z.object({ latE6: z.number(), lonE6: z.number(), timestamp: z.number() }).nullable(),
});
export type TelemetrySummary = z.infer<typeof TelemetrySummary>;

export const Stats = z.object({
  shipments: z.record(z.string(), z.number()),
  total: z.number(),
  epochsCommitted: z.number(),
  proofsVerified: z.number(),
});
export type Stats = z.infer<typeof Stats>;

export const Config = z.object({
  chainId: z.number(),
  usdgDecimals: z.number(),
  demoMode: z.boolean().optional().default(false),
  contracts: z.record(z.string(), z.string()),
});
export type Config = z.infer<typeof Config>;

export const Health = z.object({
  status: z.string(),
  database: z.string().optional(),
  chain: z.string().optional(),
  chainId: z.number().optional(),
  headBlock: z.number().optional(),
});
export type Health = z.infer<typeof Health>;

export const DemoStep = z.object({
  scene: z.string(),
  txHashes: list(z.string()),
  status: z.string().optional().default(""),
  drawn: z.string().optional().default("0"),
});
export type DemoStep = z.infer<typeof DemoStep>;
export const DemoCreated = DemoStep.extend({ shipmentId: z.string(), divisor: z.number().optional().default(1) });
export const DemoStatus = z.object({ done: list(z.string()), next: z.string(), divisor: z.number().optional().default(1) });
export type DemoStatus = z.infer<typeof DemoStatus>;

export const MirrorResult = Shipment;
