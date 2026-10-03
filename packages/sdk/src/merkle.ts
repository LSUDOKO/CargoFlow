// Poseidon Merkle commitments over evidence epochs, bit-exact with backend/internal/merkle (and so with the ZK
// circuit and EvidenceRegistry.commitEpoch). Each epoch's readings are sorted by (timestamp, sensorId) and each leaf is
//
//   leaf = Poseidon(timestamp, sensorField, temp + 10000, humidity, lat + 90e6, lon + 180e6, shock, salt)
//
// over BN254 (circomlib's Poseidon, via poseidon-lite); internal nodes are Poseidon(left, right) and the leaves are
// padded with zeros to a power of two. A committed root can only be recomputed with the per-reading salts, which the
// operator derives from a secret (deriveSalt); verify roots and inclusion proofs only when the salts are supplied
// to you. test/merkle.test.ts pins a vector computed by the Go code.
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { poseidon2 } from "poseidon-lite/poseidon2";
import { poseidon8 } from "poseidon-lite/poseidon8";
import type { Reading } from "./csv.js";

/** The BN254 scalar field modulus. */
export const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const TEMP_OFFSET_X100 = 10_000;
export const LAT_OFFSET_E6 = 90_000_000;
export const LON_OFFSET_E6 = 180_000_000;

export type MerkleReading = Reading;

const bytesToBig = (b: Uint8Array): bigint => (b.length === 0 ? 0n : BigInt("0x" + bytesToHex(b)));
const checkField = (x: bigint, what: string) => {
  if (x < 0n || x >= FIELD_MODULUS) throw new Error(`${what} is outside the BN254 scalar field.`);
};

/** A sensor id as a 248-bit field element: the first 31 bytes of SHA-256(id). */
export const sensorField = (sensorId: string): bigint => bytesToBig(sha256(utf8ToBytes(sensorId)).slice(0, 31));

/**
 * The private per-reading salt, as the backend derives it: the first 31 bytes of
 * HMAC-SHA256(secret, shipmentId (32 bytes) || len(sensorId) (uint32 BE) || sensorId || timestamp (uint64 BE)).
 */
export function deriveSalt(secret: Uint8Array | string, shipmentId: string, sensorId: string, timestamp: number): bigint {
  const key = typeof secret === "string" ? utf8ToBytes(secret) : secret;
  const hex = shipmentId.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("A shipment id is 0x followed by 64 hex characters.");
  const sid = Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
  const sensor = utf8ToBytes(sensorId);
  const buf = new Uint8Array(32 + 4 + sensor.length + 8);
  const view = new DataView(buf.buffer);
  buf.set(sid, 0);
  view.setUint32(32, sensor.length);
  buf.set(sensor, 36);
  view.setBigUint64(36 + sensor.length, BigInt(timestamp));
  return bytesToBig(hmac(sha256, key, buf).slice(0, 31));
}

/** One reading's leaf. Throws on input the backend refuses to encode. */
export function leafHash(r: MerkleReading, salt: bigint): bigint {
  if (!(r.timestamp > 0)) throw new Error("The timestamp must be positive.");
  if (r.sensorId === "") throw new Error("The sensor id is empty.");
  if (r.temperatureX100 + TEMP_OFFSET_X100 < 0) throw new Error(`Temperature ${r.temperatureX100} is below the encodable range.`);
  if (r.latitudeE6 + LAT_OFFSET_E6 < 0) throw new Error(`Latitude ${r.latitudeE6} is below the encodable range.`);
  if (r.longitudeE6 + LON_OFFSET_E6 < 0) throw new Error(`Longitude ${r.longitudeE6} is below the encodable range.`);
  if (r.humidityX100 < 0 || r.shockX100 < 0) throw new Error("Humidity and shock must be non-negative.");
  checkField(salt, "The salt");
  return poseidon8([
    BigInt(r.timestamp),
    sensorField(r.sensorId),
    BigInt(r.temperatureX100 + TEMP_OFFSET_X100),
    BigInt(r.humidityX100),
    BigInt(r.latitudeE6 + LAT_OFFSET_E6),
    BigInt(r.longitudeE6 + LON_OFFSET_E6),
    BigInt(r.shockX100),
    salt,
  ]);
}

/** Poseidon(a, b), the internal-node hash. */
export const hash2 = (a: bigint, b: bigint): bigint => poseidon2([a, b]);

// Go compares strings by bytes; JavaScript's < compares UTF-16 units, which differs outside the BMP.
const enc = new TextEncoder();
function compareBytes(a: string, b: string): number {
  const x = enc.encode(a);
  const y = enc.encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
}

/** The epoch's commitment order: by timestamp, then sensor id (bytewise), stable. */
export const sortReadings = <T extends MerkleReading>(readings: readonly T[]): T[] =>
  readings
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.timestamp - b.r.timestamp || compareBytes(a.r.sensorId, b.r.sensorId) || a.i - b.i)
    .map((x) => x.r);

/** A complete binary Poseidon tree: levels[0] are the zero-padded leaves, the last level is [root]. */
export interface MerkleTree {
  levels: bigint[][];
  root: bigint;
  /** the root as the 0x-prefixed 32-byte big-endian value EvidenceRegistry stores */
  rootHex: `0x${string}`;
}

export const toBytes32 = (x: bigint): `0x${string}` => `0x${x.toString(16).padStart(64, "0")}`;

export function buildTree(leaves: readonly bigint[]): MerkleTree {
  if (leaves.length === 0) throw new Error("A tree needs at least one leaf.");
  let size = 1;
  while (size < leaves.length) size <<= 1;
  let level = Array.from({ length: size }, (_, i) => {
    const l = i < leaves.length ? leaves[i]! : 0n;
    checkField(l, `Leaf ${i}`);
    return l;
  });
  const levels = [level];
  while (level.length > 1) {
    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(hash2(level[i]!, level[i + 1]!));
    levels.push(next);
    level = next;
  }
  const root = level[0]!;
  return { levels, root, rootHex: toBytes32(root) };
}

/** The bottom-up sibling path for the leaf at `index`. */
export function proveInclusion(tree: MerkleTree, index: number): bigint[] {
  const size = tree.levels[0]!.length;
  if (!Number.isInteger(index) || index < 0 || index >= size) throw new Error(`Index ${index} is outside [0, ${size}).`);
  const proof: bigint[] = [];
  for (let lvl = 0; lvl < tree.levels.length - 1; lvl++) {
    proof.push(tree.levels[lvl]![index ^ 1]!);
    index >>= 1;
  }
  return proof;
}

const asBig = (x: bigint | string): bigint => (typeof x === "bigint" ? x : BigInt(x));

/** Checks that `leaf` sits at `index` under `root` (a bigint, decimal string or 0x bytes32) given the sibling path. */
export function verifyInclusion(leaf: bigint, index: number, proof: readonly (bigint | string)[], root: bigint | string): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= 2 ** proof.length || leaf < 0n || leaf >= FIELD_MODULUS) return false;
  let cur = leaf;
  for (const s of proof) {
    const sib = asBig(s);
    cur = index & 1 ? hash2(sib, cur) : hash2(cur, sib);
    index >>= 1;
  }
  return cur === asBig(root);
}

/** A reading with its salt. */
export type SaltedReading = MerkleReading & { salt: bigint | string };

/** The epoch tree over salted readings, in commitment order (the readings are sorted here). */
export function epochTree(readings: readonly SaltedReading[]): MerkleTree & { readings: SaltedReading[] } {
  const sorted = sortReadings(readings);
  return { ...buildTree(sorted.map((r) => leafHash(r, asBig(r.salt)))), readings: sorted };
}

/** True when the salted readings commit to `root` (e.g. an epoch's `root` from the API or EvidenceRegistry). */
export const verifyEpochRoot = (readings: readonly SaltedReading[], root: bigint | string): boolean => {
  try {
    return epochTree(readings).root === asBig(root);
  } catch {
    return false;
  }
};

/**
 * Checks one salted reading against a committed root with its index and sibling path (what a party holding a single
 * reading and its salt can verify without the rest of the epoch).
 */
export function verifyReadingInclusion(reading: SaltedReading, index: number, proof: readonly (bigint | string)[], root: bigint | string): boolean {
  try {
    return verifyInclusion(leafHash(reading, asBig(reading.salt)), index, proof, root);
  } catch {
    return false;
  }
}
