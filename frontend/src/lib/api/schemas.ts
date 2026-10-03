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
  // contracts v2: relative humidity % x 100 and shock g x 100; 0 = no limit (and absent on a v1 deployment)
  maxHumidityX100: z.number().optional().default(0),
  maxShockX100: z.number().optional().default(0),
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
  /** milestone place names by index, as the exporter's wizard posted them ("" for none) */
  placeLabels: list(z.string()),
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
  // contracts v2: the milestone only releases on evidence from within radiusM of (latE6, lonE6); radiusM 0 = anywhere
  latE6: z.number().optional().default(0),
  lonE6: z.number().optional().default(0),
  radiusM: z.number().optional().default(0),
  placeLabel: z.string().nullish().transform((v) => v ?? ""),
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

/** Device class: the backend's word or the DeviceRegistry's number (0 software, 1 passkey, 2 secure element). */
export const DeviceClass = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v): "software" | "passkey" | "secure_element" => {
    if (v === 1 || v === "1" || v === "passkey") return "passkey";
    if (v === 2 || v === "2" || v === "secure_element" || v === "secureElement") return "secure_element";
    return "software";
  });

/** An epoch's source device (contracts v3). onChain: recorded in the DeviceRegistry (a boolean or the record). */
export const EpochSource = z.object({
  keyHash: z.string(),
  deviceClass: DeviceClass,
  onChain: z.unknown().optional().transform((v) => (typeof v === "boolean" ? v : !!v && typeof v === "object" ? (v as { registered?: boolean; active?: boolean }).registered ?? (v as { active?: boolean }).active ?? true : false)),
});
export type EpochSource = z.infer<typeof EpochSource>;

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
  // contracts v2 aggregates committed with the epoch (0 before v2): centroid, humidity and shock maxima
  latE6: z.number().optional().default(0),
  lonE6: z.number().optional().default(0),
  maxHumidityX100: z.number().optional().default(0),
  maxShockX100: z.number().optional().default(0),
  /** metres from the milestone's place when the decision is HELD_NOT_AT_PLACE, else null */
  heldDistanceM: z.number().nullish().transform((v) => v ?? null),
  /** contracts v3: the device keys whose readings fed the epoch (EvidenceRegistry.recordEpochSources) */
  sources: list(EpochSource),
});
export type EpochSummary = z.infer<typeof EpochSummary>;
export const EpochList = z.object({ epochs: list(EpochSummary) });

/**
 * A parametric trigger (contracts v3): N consecutive failed epochs pay out, with a salvage share to the exporter.
 * On an offer only the first two fields are set; on an accepted cover epochFloor is the shipment's epoch count at
 * acceptance and exporterSalvage what the trigger paid the exporter. null for a plain cover.
 */
export const Parametric = z
  .object({
    consecutiveFailedEpochs: z.number(),
    salvageToExporter: z.union([z.string(), z.number()]).nullish().transform((v) => String(v ?? "0")),
    epochFloor: z.number().nullish().transform((v) => v ?? 0),
    exporterSalvage: z.union([z.string(), z.number()]).nullish().transform((v) => String(v ?? "0")),
  })
  .nullish()
  .transform((v) => (v && v.consecutiveFailedEpochs > 0 ? v : null));
export type Parametric = z.infer<typeof Parametric>;

/** A facility's accepted default cover (CoverPool). Amounts in USDG base units. */
export const Cover = z.object({
  insurer: z.string(),
  financier: z.string(),
  amount,
  premium: amount,
  status: z.string(), // ACTIVE | RELEASED | CLAIMED | TRIGGERED (v3)
  financierPayout: amount.nullish().transform((v) => v ?? "0"),
  insurerReturn: amount.nullish().transform((v) => v ?? "0"),
  parametric: Parametric,
});
export type Cover = z.infer<typeof Cover>;

export const CoverOffer = z.object({ insurer: z.string(), amount, premiumBps: z.number(), createdAt: z.string().optional().default(""), parametric: Parametric });
export type CoverOffer = z.infer<typeof CoverOffer>;

/** GET /v1/shipments/{id}/cover: the open offers and the accepted cover. */
export const ShipmentCover = z.object({ offers: list(CoverOffer), cover: Cover.nullish().transform((v) => v ?? null) });
export type ShipmentCover = z.infer<typeof ShipmentCover>;

/** The bill of lading bound to a facility; holder is the controller while escrowed, then its final recipient. */
export const Title = z
  .object({
    tokenId: z.union([z.string(), z.number()]).transform((v) => String(v)),
    status: z.union([z.string(), z.number()]).nullish().transform((v) => (v === null || v === undefined ? "ISSUED" : String(v))),
    holder: z.string().nullish().transform((v) => v ?? ""),
  })
  .nullish()
  .transform((v) => v ?? null);
export type Title = z.infer<typeof Title>;

export const ShipmentView = z.object({
  shipment: Shipment,
  milestones: list(Milestone),
  facility: Facility.nullable(),
  latestEvidence: EpochSummary.nullable(),
  quarantinedReadings: z.number(),
  usdgDecimals: z.number(),
  cover: Cover.nullish().transform((v) => v ?? null),
  openCoverOffers: z.number().optional().default(0),
  /** contracts v3: the electronic bill of lading bound to the facility (documents against payment) */
  title: Title,
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
  contracts: z.record(z.string(), z.string()),
  /** contracts v3: whether the guardian has paused new risk on each contract */
  paused: z
    .object({ controller: z.boolean().nullish().transform((v) => !!v), coverPool: z.boolean().nullish().transform((v) => !!v) })
    .nullish()
    .transform((v) => v ?? null),
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


export const MirrorResult = Shipment;

export const GatewaySource = z.object({
  id: z.string(),
  shipmentId: z.string(),
  label: z.string(),
  publicKey: z.string(),
  sensorIds: list(z.string()),
  createdAt: z.string(),
  // contracts v3 device trust: absent on older backends (the key hash is then computed from publicKey)
  keyType: z.string().optional().default("ed25519"),
  deviceClass: DeviceClass,
  keyHash: z.string().optional().default(""),
  attested: z.boolean().optional().default(false),
});
export type GatewaySource = z.infer<typeof GatewaySource>;
export const GatewayList = z.object({ sources: list(GatewaySource) });

export const EpochOutcome = z.object({
  sequence: z.number(),
  milestoneIndex: z.number(),
  epochId: z.string(),
  score: z.number(),
  pass: z.boolean(),
  action: z.string(),
  reasons: list(z.string()),
  skipped: z.string().optional(),
  commitTx: z.string().optional(),
  releaseTx: z.string().optional(),
  /** passed the policy, but the cargo is outside the milestone's place: the release waits (not a failure) */
  held: z.boolean().optional().default(false),
  distanceM: z.number().optional(),
  pauseTx: z.string().optional(),
  error: z.string().optional(),
});
export type EpochOutcome = z.infer<typeof EpochOutcome>;
export const IngestResult = z.object({
  accepted: z.number(),
  rejected: list(z.object({ sensorId: z.string(), timestamp: z.number(), reason: z.string() })),
  epochs: list(EpochOutcome),
});
export type IngestResult = z.infer<typeof IngestResult>;

const word = z.string();
export const RecoveryProof = z.object({
  milestoneIndex: z.number(),
  sequence: z.number(),
  epochId: z.string(),
  root: z.string(),
  score: z.number(),
  commitTx: z.string(),
  submitter: z.string(),
  a: z.tuple([word, word]),
  b: z.tuple([z.tuple([word, word]), z.tuple([word, word])]),
  c: z.tuple([word, word]),
  /** the automatic recovery worker had already proven it: only the evidence commit ran */
  cached: z.boolean().optional().default(false),
});
export type RecoveryProof = z.infer<typeof RecoveryProof>;
