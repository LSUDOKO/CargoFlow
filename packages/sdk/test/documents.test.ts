import { describe, expect, it } from "vitest";
import { guessDocumentKind, hashDocument, verifyDocument } from "../src/documents";

const bytes = new TextEncoder().encode("abc");

describe("documents", () => {
  it("hashes with SHA-256 and keccak256 (known vectors for 'abc')", () => {
    expect(hashDocument(bytes)).toEqual({
      sizeBytes: 3,
      sha256: "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      keccak256: "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
    });
  });
  it("matches attested documents by either hash and the on-chain invoice hash by keccak256", () => {
    const h = hashDocument(bytes);
    const docs = [
      { id: "1", sha256: h.sha256.toUpperCase().replace("0X", "0x"), keccak256: "0x00" },
      { id: "2", sha256: "0x00", keccak256: "0x11" },
    ];
    const v = verifyDocument(h, docs, h.keccak256);
    expect(v.matches.map((d) => d.id)).toEqual(["1"]);
    expect(v.matchesInvoiceHash).toBe(true);
    expect(verifyDocument(h, [], null).matchesInvoiceHash).toBe(false);
  });
  it("guesses kinds from file names", () => {
    expect(guessDocumentKind("BL-2026-001.pdf")).toBe("bill_of_lading");
    expect(guessDocumentKind("invoice_77.pdf")).toBe("invoice");
    expect(guessDocumentKind("phyto-cert.pdf")).toBe("certificate");
    expect(guessDocumentKind("photo.jpg")).toBe("other");
  });
});
