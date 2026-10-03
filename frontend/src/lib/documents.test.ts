import { describe, expect, it } from "vitest";
import { formatBytes, guessKind, hashBytes, hashFile, verifyHashes } from "./documents";

const abc = new TextEncoder().encode("abc");
const SHA_ABC = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const KECCAK_ABC = "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45";

describe("hashing in the browser", () => {
  it("computes SHA-256 and keccak256 of the exact bytes", async () => {
    expect(await hashBytes(abc)).toEqual({ sha256: SHA_ABC, keccak256: KECCAK_ABC });
  });
  it("hashes a File without uploading it", async () => {
    const f = new File([abc], "invoice-CF-1.pdf", { type: "application/pdf" });
    expect(await hashFile(f)).toEqual({ name: "invoice-CF-1.pdf", sizeBytes: 3, sha256: SHA_ABC, keccak256: KECCAK_ABC });
  });
});

describe("verifyHashes", () => {
  const doc = { id: "d", kind: "invoice", name: "a", sizeBytes: 3, sha256: SHA_ABC.toUpperCase().replace("0X", "0x"), keccak256: KECCAK_ABC, signer: "0x1", role: "exporter", createdAt: "t", matchesInvoiceHash: true };
  it("matches attested documents and the on-chain invoice hash", () => {
    const v = verifyHashes({ sha256: SHA_ABC, keccak256: KECCAK_ABC }, [doc], KECCAK_ABC);
    expect(v.matches).toHaveLength(1);
    expect(v.invoice).toBe(true);
  });
  it("reports a mismatch clearly", () => {
    const v = verifyHashes({ sha256: "0x" + "0".repeat(64), keccak256: "0x" + "1".repeat(64) }, [doc], KECCAK_ABC);
    expect(v).toEqual({ matches: [], invoice: false });
  });
});

describe("guessKind and formatBytes", () => {
  it("guesses the kind from common file names", () => {
    expect(guessKind("Invoice_2026-118.pdf")).toBe("invoice");
    expect(guessKind("MSKU-bill-of-lading.pdf")).toBe("bill_of_lading");
    expect(guessKind("BL_2231.pdf")).toBe("bill_of_lading");
    expect(guessKind("packing list.xlsx")).toBe("packing_list");
    expect(guessKind("phytosanitary-cert.pdf")).toBe("certificate");
    expect(guessKind("photo.jpg")).toBe("other");
  });
  it("formats sizes", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
