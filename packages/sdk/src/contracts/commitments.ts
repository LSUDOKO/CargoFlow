// Pure hashes the contracts and backend agree on. Each is pinned by a vector in test/commitments.test.ts.
import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from "viem";

export type RoutePoint = { latE6: number; lonE6: number };

/**
 * The route commitment a shipment registers: keccak256 of the waypoints as compact JSON with fields latE6, lonE6,
 * exactly as backend/internal/service.RouteCommitment computes it (Go's encoding/json).
 */
export function routeCommitment(route: readonly RoutePoint[]): Hex {
  return keccak256(toBytes(JSON.stringify(route.map((p) => ({ latE6: p.latE6, lonE6: p.lonE6 })))));
}

/**
 * The on-chain policy (PolicyEngine.Policy, contracts v2: ten fields). Temperatures are °C x 100 (signed), humidity
 * % x 100 and shock g x 100 with 0 meaning no limit. The API's `maxGapSec` is `maxEvidenceAgeSec` here, and its
 * `minSensors` is an off-chain scoring parameter that is not part of the commitment.
 */
export interface OnChainPolicy {
  minTempX100: number;
  maxTempX100: number;
  maxEvidenceAgeSec: number;
  maxRouteDeviationM: number;
  minEvidenceScore: number;
  maxConflictBps: number;
  maxRiskBps: number;
  requiresZK: boolean;
  maxHumidityX100: number;
  maxShockX100: number;
}

export const POLICY_COMPONENTS = [
  { name: "minTempX100", type: "int32" },
  { name: "maxTempX100", type: "int32" },
  { name: "maxEvidenceAgeSec", type: "uint32" },
  { name: "maxRouteDeviationM", type: "uint32" },
  { name: "minEvidenceScore", type: "uint16" },
  { name: "maxConflictBps", type: "uint16" },
  { name: "maxRiskBps", type: "uint16" },
  { name: "requiresZK", type: "bool" },
  { name: "maxHumidityX100", type: "uint16" },
  { name: "maxShockX100", type: "uint16" },
] as const;

/** keccak256(abi.encode(policy)), what PolicyEngine.hashPolicy returns and the registry stores as policyCommitment. */
export function hashPolicy(p: OnChainPolicy): Hex {
  return keccak256(encodeAbiParameters([{ type: "tuple", components: POLICY_COMPONENTS }], [p]));
}

/** The API's policy shape (shipment.policy) as the on-chain struct. */
export function onChainPolicy(p: {
  minTempX100: number; maxTempX100: number; maxGapSec: number; maxRouteDeviationM: number; minEvidenceScore: number;
  maxConflictBps: number; maxRiskBps: number; requiresZk: boolean; maxHumidityX100?: number; maxShockX100?: number;
}): OnChainPolicy {
  return {
    minTempX100: p.minTempX100,
    maxTempX100: p.maxTempX100,
    maxEvidenceAgeSec: p.maxGapSec,
    maxRouteDeviationM: p.maxRouteDeviationM,
    minEvidenceScore: p.minEvidenceScore,
    maxConflictBps: p.maxConflictBps,
    maxRiskBps: p.maxRiskBps,
    requiresZK: p.requiresZk,
    maxHumidityX100: p.maxHumidityX100 ?? 0,
    maxShockX100: p.maxShockX100 ?? 0,
  };
}

/** keccak256 of the human reference ("CF-2026-SG01"), the `externalRef` argument of registerShipment. */
export const externalRefHash = (ref: string): Hex => keccak256(toBytes(ref));

/** ShipmentRegistry.shipmentIdFor: keccak256(abi.encode(exporter, keccak256(ref))). Pass a ref or its 0x hash. */
export function shipmentIdFor(exporter: Address, ref: string): Hex {
  const refHash = /^0x[0-9a-fA-F]{64}$/.test(ref) ? (ref as Hex) : externalRefHash(ref);
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [exporter, refHash]));
}

/** EvidenceRegistry.epochIdFor: keccak256(abi.encode(shipmentId, milestoneIndex, seq)). */
export function epochIdFor(shipmentId: Hex, milestoneIndex: number, seq: number): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint8" }, { type: "uint32" }], [shipmentId, milestoneIndex, seq]));
}

/** keccak256 of free text, as the web app hashes a dispute reason or resolution note into a bytes32. */
export const textHash = (text: string): Hex => keccak256(toBytes(text));

/** The checkpoint commitment the web app gives milestone i (1-based) of a reference. */
export const checkpointCommitment = (ref: string, i: number): Hex => keccak256(toBytes(`${ref}:checkpoint:${i}`));
