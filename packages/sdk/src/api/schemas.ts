// zod schemas for the CargoFlow API's JSON (backend/internal/{store,service,api}). They are deliberately tolerant:
// Go encodes nil slices and maps as null (normalised to [] / {}), fields added by newer deployments are kept
// (loose objects), and fields that only contracts v2 deployments send (places, humidity and shock, cover) are optional.
// USDG amounts are base units (6 decimals) as decimal strings.
import { z } from "zod";

export const list = <T extends z.ZodTypeAny>(item: T) =>
  z
    .array(item)
    .nullish()
    .transform((v) => (v ?? []) as z.infer<T>[]);
const amount = z.union([z.string(), z.number()]).transform((v) => String(v));
const optAmount = amount.nullish().transform((v) => v ?? "0");
const count = z.number().nullish().transform((v) => v ?? 0);
const optString = z.string().nullish().transform((v) => v ?? "");

export const Policy = z.looseObject({
  minTempX100: z.number(),
  maxTempX100: z.number(),
  maxGapSec: z.number(),
  maxRouteDeviationM: z.number(),
  minEvidenceScore: z.number(),
  maxConflictBps: z.number(),
  maxRiskBps: z.number(),
  requiresZk: z.boolean(),
  minSensors: z.number(),
  /** v2: relative humidity % x 100; 0 = no limit */
  maxHumidityX100: z.number().optional(),
  /** v2: shock g x 100; 0 = no limit */
  maxShockX100: z.number().optional(),
});
export type Policy = z.infer<typeof Policy>;

export const RoutePoint = z.object({ latE6: z.number(), lonE6: z.number() });
export type RoutePoint = z.infer<typeof RoutePoint>;

export const Shipment = z.looseObject({
  id: z.string(),
  externalRef: z.string(),
  exporter: z.string(),
  buyer: z.string(),
  financier: optString,
  invoiceHash: z.string(),
  routeCommitment: z.string(),
  policyCommitment: z.string(),
  invoiceValue: amount,
  policy: Policy,
  route: list(RoutePoint),
  placeLabels: list(z.string()),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Shipment = z.infer<typeof Shipment>;

export const ShipmentList = z.looseObject({ shipments: list(Shipment), limit: count, offset: count });
export type ShipmentList = z.infer<typeof ShipmentList>;

export const Milestone = z.looseObject({
  index: z.number(),
  description: optString,
  allocatedUsdg: amount,
  evidenceThreshold: z.number(),
  checkpointCommitment: z.string(),
  released: z.boolean(),
  releaseTxHash: z.string().optional(),
  releasedAt: z.string().optional(),
  /** v2 place: centre (degrees x 1e6) and radius in metres; radiusM 0 = no place condition */
  latE6: z.number().optional(),
  lonE6: z.number().optional(),
  radiusM: z.number().optional(),
  placeLabel: z.string().optional(),
});
export type Milestone = z.infer<typeof Milestone>;

export const Facility = z.looseObject({
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

export const EpochSummary = z.looseObject({
  sequence: z.number(),
  /** 255 = observed but not evaluated against a milestone */
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
  /** v2 committed aggregates */
  latE6: z.number().optional(),
  lonE6: z.number().optional(),
  maxHumidityX100: z.number().optional(),
  maxShockX100: z.number().optional(),
  heldDistanceM: z.number().nullish(),
  /** v3: the device keys whose readings fed the epoch, and the recordEpochSources transaction */
  sources: z.array(z.looseObject({ keyHash: z.string(), deviceClass: z.string(), onChain: z.boolean() })).nullish(),
  sourcesTx: z.string().optional(),
});
export type EpochSummary = z.infer<typeof EpochSummary>;
export const EpochList = z.looseObject({ epochs: list(EpochSummary) });
export type EpochList = z.infer<typeof EpochList>;

export const CoverOffer = z.looseObject({
  insurer: z.string(),
  amount,
  premiumBps: z.number(),
  createdAt: z.string().optional(),
  /** v3 parametric terms */
  parametric: z.looseObject({ consecutiveFailedEpochs: z.number(), salvageToExporter: amount }).nullish(),
});
export type CoverOffer = z.infer<typeof CoverOffer>;
export const Cover = z.looseObject({
  insurer: z.string(),
  financier: z.string(),
  amount,
  premium: amount,
  /** ACTIVE, RELEASED or CLAIMED */
  status: z.string(),
  financierPayout: optAmount,
  insurerReturn: optAmount,
  /** v3 parametric cover terms */
  parametric: z
    .looseObject({ consecutiveFailedEpochs: z.number(), salvageToExporter: amount, epochFloor: z.number().optional(), exporterSalvage: amount.optional() })
    .nullish(),
});
export type Cover = z.infer<typeof Cover>;
export const CoverState = z.looseObject({ offers: list(CoverOffer), cover: Cover.nullish().transform((v) => v ?? null) });
export type CoverState = z.infer<typeof CoverState>;

export const ShipmentView = z.looseObject({
  shipment: Shipment,
  milestones: list(Milestone),
  facility: Facility.nullish().transform((v) => v ?? null),
  latestEvidence: EpochSummary.nullish().transform((v) => v ?? null),
  quarantinedReadings: count,
  usdgDecimals: z.number().optional().default(6),
  /** v2 */
  cover: Cover.nullish(),
  openCoverOffers: z.array(CoverOffer).nullish(),
});
export type ShipmentView = z.infer<typeof ShipmentView>;

export const AuditEntry = z.looseObject({
  time: z.string(),
  kind: z.string(),
  title: z.string(),
  txHash: z.string().optional(),
  detail: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
});
export type AuditEntry = z.infer<typeof AuditEntry>;
export const AuditList = z.looseObject({ entries: list(AuditEntry) });
export type AuditList = z.infer<typeof AuditList>;

export const TrackPoint = z.looseObject({
  epochId: z.string(),
  milestoneIndex: z.number(),
  sequence: z.number(),
  startTime: z.number(),
  endTime: z.number(),
  latE6: z.number(),
  lonE6: z.number(),
  minTempX100: z.number(),
  maxTempX100: z.number(),
  maxHumidityX100: z.number().optional(),
  maxShockX100: z.number().optional(),
  pass: z.boolean(),
  committed: z.boolean(),
});
export type TrackPoint = z.infer<typeof TrackPoint>;
export const Track = z.looseObject({ points: list(TrackPoint) });
export type Track = z.infer<typeof Track>;

export const SensorSummary = z.looseObject({
  sensorId: z.string(),
  readings: z.number(),
  minTempX100: z.number(),
  maxTempX100: z.number(),
  meanTempX100: z.number(),
});
export const EpochTelemetry = z.looseObject({
  epochId: z.string(),
  milestoneIndex: z.number(),
  startTime: z.number(),
  endTime: z.number(),
  sensors: list(SensorSummary),
});
export const TelemetrySummary = z.looseObject({
  epochs: list(EpochTelemetry),
  position: z.object({ latE6: z.number(), lonE6: z.number(), timestamp: z.number() }).nullish().transform((v) => v ?? null),
});
export type TelemetrySummary = z.infer<typeof TelemetrySummary>;

export const Explanation = z.looseObject({
  status: z.string(),
  headline: z.string(),
  causes: list(z.string()),
  nextSteps: list(z.object({ role: z.string(), action: z.string() })),
  forecast: z
    .object({ sensorId: z.string(), trend: z.string(), minutesToLimit: z.number().nullish().transform((v) => v ?? null) })
    .nullish()
    .transform((v) => v ?? null),
  /** v2: set while the next milestone waits for evidence from its place */
  hold: z
    .looseObject({
      milestoneIndex: z.number(),
      placeLabel: optString,
      latE6: z.number(),
      lonE6: z.number(),
      radiusM: z.number(),
      distanceM: z.number(),
      message: optString,
    })
    .nullish()
    .transform((v) => v ?? null),
  /** "rules", or "ai" when a model reworded it */
  source: z.string().optional().default("rules"),
});
export type Explanation = z.infer<typeof Explanation>;

export const AttestedDocument = z.looseObject({
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  sizeBytes: z.number(),
  sha256: z.string(),
  keccak256: z.string(),
  signer: z.string(),
  role: z.string(),
  createdAt: z.string(),
  matchesInvoiceHash: z.boolean().optional().default(false),
});
export type AttestedDocument = z.infer<typeof AttestedDocument>;
export const DocumentList = z.looseObject({ documents: list(AttestedDocument) });
export type DocumentList = z.infer<typeof DocumentList>;

export const Subscription = z.looseObject({
  id: z.string(),
  channel: z.string(),
  targetMasked: optString,
  events: list(z.string()),
  active: z.boolean().optional().default(true),
  createdAt: z.string().optional(),
  /** returned once, at creation, for webhooks */
  secret: z.string().optional(),
  /** Telegram: press Start at this link to activate */
  linkUrl: z.string().optional(),
});
export type Subscription = z.infer<typeof Subscription>;
export const SubscriptionList = z.looseObject({ subscriptions: list(Subscription) });

const Fix = z.object({ latE6: z.number(), lonE6: z.number(), timestamp: z.number() });
export const Vessel = z.looseObject({
  mmsi: z.string(),
  name: z.string(),
  live: z.boolean(),
  last: Fix.extend({ sogKnotsX10: z.number().optional().default(0), cogDegX10: z.number().optional().default(0) })
    .nullish()
    .transform((v) => v ?? null),
  track: list(Fix),
  crossCheck: z
    .looseObject({ loggerLatE6: z.number(), loggerLonE6: z.number(), distanceM: z.number(), ageSec: z.number(), agrees: z.boolean() })
    .nullish()
    .transform((v) => v ?? null),
});
export type Vessel = z.infer<typeof Vessel>;

export const KEY_TYPES = ["ed25519", "p256", "webauthn"] as const;
export const DEVICE_CLASSES = ["software", "passkey", "secure_element"] as const;

export const GatewaySource = z.looseObject({
  id: z.string(),
  shipmentId: z.string(),
  label: optString,
  publicKey: z.string(),
  sensorIds: list(z.string()),
  createdAt: z.string(),
  /** device trust (absent on older deployments) */
  keyType: z.string().optional(),
  deviceClass: z.string().optional(),
  keyHash: z.string().optional(),
  attested: z.boolean().optional(),
  reliabilityBps: z.number().optional(),
  attestation: z.record(z.string(), z.unknown()).nullish(),
  /** v3: the DeviceRegistry.registerDevice transaction (registration responses only) */
  deviceTx: z.string().optional(),
});
export type GatewaySource = z.infer<typeof GatewaySource>;
export const GatewayList = z.looseObject({ sources: list(GatewaySource) });

export const Offer = z.looseObject({
  id: z.string(),
  financier: z.string(),
  feeBps: z.number(),
  createdAt: z.string(),
  accepted: z.boolean().nullish().transform((v) => v ?? false),
});
export type Offer = z.infer<typeof Offer>;

export const REQUEST_STATUSES = ["open", "accepted", "funded", "closed"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const MarketRequest = z.looseObject({
  id: z.string(),
  shipmentId: z.string(),
  externalRef: z.string(),
  exporter: z.string(),
  buyer: z.string(),
  invoiceValue: amount,
  amount,
  maxFeeBps: z.number(),
  milestoneCount: z.number(),
  note: optString,
  route: list(RoutePoint),
  policy: Policy.partial().nullish().transform((v) => v ?? {}),
  status: z.string().transform((s) => s.toLowerCase()),
  offers: list(Offer),
  createdAt: z.string(),
});
export type MarketRequest = z.infer<typeof MarketRequest>;
export const RequestList = z.looseObject({ requests: list(MarketRequest) });

export const Party = z.looseObject({
  address: z.string(),
  exporter: z.looseObject({
    shipments: count, settled: count, active: count, paused: count, disputed: count, defaulted: count, recoveries: count,
    avgEvidenceScore: z.number().nullish().transform((v) => v ?? null),
    volume: optAmount,
  }),
  financier: z.looseObject({
    facilities: count, committed: optAmount, drawn: optAmount, inEscrow: optAmount, feesEarned: optAmount, settled: count, defaulted: count,
  }),
  buyer: z.looseObject({ shipments: count, settled: count, paidVolume: optAmount }),
  /** v2 */
  insurer: z
    .looseObject({
      offered: count, active: count, released: count, claimed: count,
      coverWritten: optAmount, premiumsEarned: optAmount, paidOut: optAmount,
    })
    .optional(),
  grade: z.enum(["A", "B", "C", "new"]).catch("new"),
  since: z.union([z.string(), z.number()]).nullish().transform((v) => (v === undefined || v === null || v === "" ? null : v)),
});
export type Party = z.infer<typeof Party>;

export const ContractAddresses = z.looseObject({
  usdg: z.string(),
  access: z.string(),
  shipmentRegistry: z.string(),
  policyEngine: z.string(),
  evidenceRegistry: z.string(),
  receivableVault: z.string(),
  financingController: z.string(),
  groth16Verifier: z.string().optional(),
  /** v2 deployments only */
  coverPool: z.string().optional(),
  /** v3 deployments only (each optional there too) */
  deviceRegistry: z.string().optional(),
  eblRegistry: z.string().optional(),
});

export const Config = z.looseObject({
  chainId: z.number(),
  usdgDecimals: z.number().optional().default(6),
  contracts: ContractAddresses,
  alerts: z
    .looseObject({
      webhook: z.boolean().optional().default(true),
      telegram: z.boolean().optional().default(false),
      email: z.boolean().optional().default(false),
      telegramBot: optString,
    })
    .nullish()
    .transform((v) => v ?? null),
  gasDrip: z.boolean().optional().default(false),
  ais: z.boolean().optional().default(false),
  /** v3: whether the emergency brake on new risk is engaged */
  paused: z.looseObject({ controller: z.boolean(), coverPool: z.boolean() }).nullish(),
});
export type Config = z.infer<typeof Config>;

export const Health = z.looseObject({
  status: z.string(),
  database: z.string().optional(),
  chain: z.string().optional(),
  chainId: z.number().optional(),
  headBlock: z.number().optional(),
});
export type Health = z.infer<typeof Health>;

export const Stats = z.looseObject({
  shipments: z.record(z.string(), z.number()).nullish().transform((v) => v ?? {}),
  total: count,
  epochsCommitted: count,
  proofsVerified: count,
});
export type Stats = z.infer<typeof Stats>;

export const EpochOutcome = z.looseObject({
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
  pauseTx: z.string().optional(),
  error: z.string().optional(),
});
export const IngestResult = z.looseObject({
  accepted: count,
  rejected: list(z.object({ sensorId: z.string(), timestamp: z.number(), reason: z.string() })),
  epochs: list(EpochOutcome),
});
export type IngestResult = z.infer<typeof IngestResult>;

const word = z.string();
export const RecoveryProof = z.looseObject({
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
});
export type RecoveryProof = z.infer<typeof RecoveryProof>;

/** Writes whose response the SDK does not pin beyond being an object (an id, a record, a transaction hash). */
export const Created = z.looseObject({ id: z.string().optional() });
export type Created = z.infer<typeof Created>;

export const GasResult = z.looseObject({ txHash: z.string().optional(), amountWei: amount.optional(), address: z.string().optional() });
export type GasResult = z.infer<typeof GasResult>;

export const Deleted = z.looseObject({ id: z.string(), deleted: z.boolean() });

// ------------------------------------------------------------------------------------------------- platform / v3

export const Notification = z.looseObject({
  id: z.string(),
  address: z.string(),
  shipmentId: optString,
  kind: z.string(),
  title: z.string(),
  body: optString,
  link: optString,
  data: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
  readAt: z.string().nullish().transform((v) => v ?? null),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof Notification>;
export const NotificationList = z.looseObject({ notifications: list(Notification), unread: count });
export type NotificationList = z.infer<typeof NotificationList>;
export const NotificationsReadResult = z.looseObject({ marked: count, unread: count });
export type NotificationsReadResult = z.infer<typeof NotificationsReadResult>;

export const Device = z.looseObject({
  keyHash: z.string(),
  keyType: z.string(),
  deviceClass: z.string(),
  reliabilityBps: z.number(),
  sourceId: z.string(),
  shipmentId: optString,
  label: optString,
  sensorIds: list(z.string()),
  disabled: z.boolean(),
  attested: z.boolean(),
  attestation: z.record(z.string(), z.unknown()).nullish().transform((v) => v ?? {}),
  registeredAt: z.string(),
  /** the v3 DeviceRegistry record; null without one */
  onChain: z
    .looseObject({ registered: z.boolean(), deviceClass: z.string(), revoked: z.boolean(), txHash: optString })
    .nullish()
    .transform((v) => v ?? null),
});
export type Device = z.infer<typeof Device>;

export const BILL_STATUSES = ["ISSUED", "SURRENDERED", "VOID"] as const;
export const Bill = z.looseObject({
  tokenId: amount,
  documentHash: z.string(),
  issuer: z.string(),
  shipper: z.string(),
  /** 0x000… for a bill made out to order */
  consignee: z.string(),
  holder: z.string(),
  status: z.string(),
  issuedAt: z.string(),
  closedAt: z.string().nullish().transform((v) => v ?? null),
  transfers: count,
  history: list(z.looseObject({ from: z.string(), to: z.string(), txHash: z.string(), at: z.string() })),
  boundShipmentId: z.string().nullish().transform((v) => v ?? null),
});
export type Bill = z.infer<typeof Bill>;
export const BillList = z.looseObject({ bills: list(Bill) });
export type BillList = z.infer<typeof BillList>;

export const PricingReason = z.looseObject({ factor: z.string(), bps: z.number(), detail: optString });
export const PricingSuggestion = z.looseObject({
  shipmentId: z.string(),
  lowBps: z.number(),
  midBps: z.number(),
  highBps: z.number(),
  reasons: list(PricingReason),
  inputs: z.looseObject({
    exporterGrade: z.string(),
    routeExcursionRate: z.number(),
    routeConflictRate: z.number(),
    cargoTemplate: z.string(),
    coverStatus: z.string(),
    tenorDays: z.number(),
    corridorShipments: z.number(),
    corridorEpochs: z.number(),
  }),
  model: optString,
});
export type PricingSuggestion = z.infer<typeof PricingSuggestion>;

/** A GS1 EPCIS 2.0 JSON-LD document (EPCISDocument); the event list is kept as loose objects. */
export const EpcisDocument = z.looseObject({
  "@context": z.unknown().optional(),
  type: z.string(),
  schemaVersion: z.string().optional(),
  creationDate: z.string().optional(),
  epcisBody: z.looseObject({ eventList: list(z.looseObject({ type: z.string() })) }),
});
export type EpcisDocument = z.infer<typeof EpcisDocument>;

/** The OpenAPI 3.1 document. */
export const OpenApiDocument = z.looseObject({ openapi: z.string(), info: z.looseObject({}).optional(), paths: z.record(z.string(), z.unknown()) });
export type OpenApiDocument = z.infer<typeof OpenApiDocument>;
