// Trade documents are fingerprinted locally and only the hashes ever leave the device: SHA-256 for the attested
// fingerprint and keccak256, the hash the shipment registry stores on chain as `invoiceHash`.
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, keccak256, type Hex } from "viem";

export interface DocumentHashes {
  sizeBytes: number;
  sha256: Hex;
  keccak256: Hex;
}

/** SHA-256 and keccak256 of a file's bytes (synchronous; works in Node, browsers and Workers). */
export function hashDocument(bytes: Uint8Array): DocumentHashes {
  return { sizeBytes: bytes.length, sha256: bytesToHex(sha256(bytes)), keccak256: keccak256(bytes) };
}

export interface DocumentVerification<D> {
  /** attested documents with the same SHA-256 or keccak256 */
  matches: D[];
  /** the file's keccak256 equals the on-chain invoiceHash */
  matchesInvoiceHash: boolean;
}

/** Compares a file's hashes with the shipment's attested documents and its on-chain invoice hash. */
export function verifyDocument<D extends { sha256: string; keccak256: string }>(
  h: { sha256: string; keccak256: string },
  documents: readonly D[],
  invoiceHash: string | undefined | null,
): DocumentVerification<D> {
  const sha = h.sha256.toLowerCase();
  const kec = h.keccak256.toLowerCase();
  return {
    matches: documents.filter((d) => d.sha256.toLowerCase() === sha || d.keccak256.toLowerCase() === kec),
    matchesInvoiceHash: !!invoiceHash && invoiceHash.toLowerCase() === kec,
  };
}

/** A first guess at a document's kind from its file name. */
export function guessDocumentKind(name: string): "invoice" | "bill_of_lading" | "packing_list" | "certificate" | "other" {
  const n = name.toLowerCase();
  if (/bill[\s_-]*of[\s_-]*lading|(^|[^a-z])(bol|bl|b-l)([^a-z]|$)|waybill/.test(n)) return "bill_of_lading";
  if (/packing/.test(n)) return "packing_list";
  if (/invoice|(^|[^a-z])inv([^a-z]|$)/.test(n)) return "invoice";
  if (/cert|phyto|origin|coa|inspection|survey/.test(n)) return "certificate";
  return "other";
}
