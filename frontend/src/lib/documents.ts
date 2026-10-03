// Trade documents are hashed in the browser and only the hashes leave it: SHA-256 (WebCrypto) for the attested
// fingerprint and keccak256 (viem), the hash the shipment registry stores on chain as `invoiceHash`.
import { bytesToHex, keccak256 } from "viem";
import type { AttestedDocument, DocumentKind } from "@/lib/api/extras";

export type FileHashes = { name: string; sizeBytes: number; sha256: `0x${string}`; keccak256: `0x${string}` };

/** The largest file the browser hashes (it is read into memory once). */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export async function hashBytes(bytes: Uint8Array): Promise<{ sha256: `0x${string}`; keccak256: `0x${string}` }> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return { sha256: bytesToHex(new Uint8Array(digest)), keccak256: keccak256(bytes) };
}

export async function hashFile(file: Blob & { name: string }): Promise<FileHashes> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`Files up to ${formatBytes(MAX_FILE_BYTES)} can be hashed in the browser.`);
  const bytes = new Uint8Array(await readBytes(file));
  return { name: file.name, sizeBytes: file.size, ...(await hashBytes(bytes)) };
}

function readBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  // older engines (and jsdom) only offer FileReader
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error("The file could not be read."));
    r.readAsArrayBuffer(file);
  });
}

export const kindLabel: Record<string, string> = {
  invoice: "Commercial invoice",
  bill_of_lading: "Bill of lading",
  packing_list: "Packing list",
  certificate: "Certificate",
  other: "Other document",
};

/** A first guess at a document's kind from its file name; the person can change it. */
export function guessKind(name: string): DocumentKind {
  const n = name.toLowerCase();
  if (/bill[\s_-]*of[\s_-]*lading|(^|[^a-z])(bol|bl|b-l)([^a-z]|$)|waybill/.test(n)) return "bill_of_lading";
  if (/packing/.test(n)) return "packing_list";
  if (/invoice|(^|[^a-z])inv([^a-z]|$)/.test(n)) return "invoice";
  if (/cert|phyto|origin|coa|inspection|survey/.test(n)) return "certificate";
  return "other";
}

export type Verification = { matches: AttestedDocument[]; invoice: boolean };

/** Compares a file's hashes with the attested documents and the shipment's on-chain invoice hash. */
export function verifyHashes(h: { sha256: string; keccak256: string }, documents: AttestedDocument[], invoiceHash: string | undefined): Verification {
  const sha = h.sha256.toLowerCase();
  const kec = h.keccak256.toLowerCase();
  return {
    matches: documents.filter((d) => d.sha256.toLowerCase() === sha || d.keccak256.toLowerCase() === kec),
    invoice: !!invoiceHash && invoiceHash.toLowerCase() === kec,
  };
}

/** Saves a Blob (a PDF certificate, a PNG label) as a file in the browser. */
export function saveBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
