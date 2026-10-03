"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useAccount } from "wagmi";
import { signMessage } from "wagmi/actions";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { HashBadge } from "@/components/ui/HashBadge";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { ApiError, apiPost } from "@/lib/api/client";
import { AttestedDocument, DOCUMENT_KINDS, documentMessage, isUnavailable, nowSec, rolesOf, useDocuments, type DocumentKind } from "@/lib/api/extras";
import type { ShipmentView } from "@/lib/api/schemas";
import { wagmiConfig } from "@/lib/chain/config";
import { signatureError } from "@/lib/chain/errors";
import { formatBytes, guessKind, hashFile, kindLabel, verifyHashes, type FileHashes, type Verification } from "@/lib/documents";
import { useHydrated } from "@/lib/useHydrated";

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium" });

/** A button that opens the file picker; the file is read locally and never uploaded. */
function PickFile({ onPick, children, variant = "secondary", disabled, label }: { onPick: (f: File) => void; children: React.ReactNode; variant?: "primary" | "secondary"; disabled?: boolean; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        hidden
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPick(f);
        }}
      />
      <Button size="sm" variant={variant} disabled={disabled} onClick={() => ref.current?.click()}>
        {children}
      </Button>
    </>
  );
}

/**
 * Trade documents, attested by hash. A party picks a file, the browser hashes it (SHA-256 and keccak256) and the
 * party's wallet signs the SHA-256; the file itself never leaves the device. Anyone can then check a copy they hold
 * against those hashes and against the invoice hash registered on chain.
 */
export function DocumentsPanel({ view }: { view: ShipmentView }) {
  const hydrated = useHydrated();
  const { address } = useAccount();
  const docs = useDocuments(view.shipment.id);
  const [attesting, setAttesting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ file: FileHashes; result: Verification } | { error: string } | null>(null);
  const isParty = hydrated && rolesOf(view, address).length > 0;
  const list = docs.data?.documents ?? [];
  const unavailable = docs.isError && isUnavailable(docs.error);
  const matched = new Set(check && "result" in check ? check.result.matches.map((d) => d.id) : []);

  async function verify(f: File) {
    setChecking(true);
    try {
      const file = await hashFile(f);
      setCheck({ file, result: verifyHashes(file, list, view.shipment.invoiceHash) });
    } catch (err) {
      setCheck({ error: err instanceof Error ? err.message : "The file could not be read." });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 text-sm text-text-muted">
        <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        <span>Files stay on your device. Only their fingerprints (hashes) are signed or compared.</span>
      </p>

      {docs.isPending ? (
        <div className="flex flex-col gap-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
      ) : unavailable ? (
        <p className="rounded-tile bg-mist px-4 py-3 text-sm text-text-muted">Document attestation is not available on this deployment yet. You can still check a file against the invoice hash registered on chain.</p>
      ) : docs.isError ? (
        <p className="text-sm text-text-muted">The attested documents could not be loaded. They will retry shortly.</p>
      ) : list.length === 0 ? (
        <p className="rounded-tile bg-mist px-4 py-3 text-sm text-text-muted">No documents attested yet.{isParty ? " Attest the invoice, bill of lading or certificates so every party can check their copies." : ""}</p>
      ) : (
        <ul className="-my-1 divide-y divide-line">
          {list.map((d) => (
            <DocumentRow key={d.id} d={d} highlighted={matched.has(d.id)} />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {isParty && !unavailable && (
          <Button size="sm" onClick={() => setAttesting(true)}>Attest a document</Button>
        )}
        <PickFile label="File to verify" onPick={(f) => void verify(f)} disabled={checking || docs.isPending}>
          {checking ? <><Spinner /> Hashing…</> : "Verify a file"}
        </PickFile>
      </div>

      {check && <VerifyResult check={check} onClear={() => setCheck(null)} />}
      {attesting && <AttestModal view={view} existing={list} onClose={() => setAttesting(false)} />}
    </div>
  );
}

function DocumentRow({ d, highlighted }: { d: AttestedDocument; highlighted: boolean }) {
  return (
    <li className={cx("py-3", highlighted && "-mx-3 rounded-tile bg-verified/10 px-3")}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 eyebrow">
        {kindLabel[d.kind] ?? d.kind}
        {d.matchesInvoiceHash && <Pill tone="verified" className="normal-case tracking-normal">Matches on-chain invoice</Pill>}
      </p>
      <p className="mt-0.5 truncate font-semibold" title={d.name}>{d.name}</p>
      <p className="text-xs text-text-muted">{formatBytes(d.sizeBytes)} · signed by the {d.role} · {date(d.createdAt)}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <HashBadge value={d.sha256} label="sha256" />
        <HashBadge value={d.keccak256} label="keccak" />
      </div>
    </li>
  );
}

function VerifyResult({ check, onClear }: { check: { file: FileHashes; result: Verification } | { error: string }; onClear: () => void }) {
  if ("error" in check) {
    return (
      <div role="alert" className="flex items-start justify-between gap-3 rounded-tile bg-danger/8 px-4 py-3 text-sm">
        <p className="font-medium text-danger-fg">{check.error}</p>
        <Button size="sm" variant="ghost" className="-my-1 -mr-2" onClick={onClear}>Clear</Button>
      </div>
    );
  }
  const { file, result } = check;
  const ok = result.matches.length > 0 || result.invoice;
  return (
    <div role="status" className={cx("rounded-tile px-4 py-3 text-sm", ok ? "bg-verified/10 ring-1 ring-verified/30 ring-inset" : "bg-danger/8 ring-1 ring-danger/25 ring-inset")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cx("flex items-center gap-2 font-display text-base font-semibold", ok ? "text-success-fg" : "text-danger-fg")}>
            <span aria-hidden="true" className={cx("grid h-5 w-5 place-items-center rounded-full text-xs text-white", ok ? "bg-verified" : "bg-danger")}>{ok ? "✓" : "×"}</span>
            {ok ? "This file matches" : "No match"}
          </p>
          <p className="mt-0.5 truncate text-text-muted" title={file.name}>{file.name} · {formatBytes(file.sizeBytes)}</p>
        </div>
        <Button size="sm" variant="ghost" className="-my-1 -mr-2" onClick={onClear}>Clear</Button>
      </div>
      {ok ? (
        <ul className="mt-2 flex flex-col gap-1">
          {result.matches.map((d) => (
            <li key={d.id}>{kindLabel[d.kind] ?? d.kind} attested by the {d.role} on {date(d.createdAt)}.</li>
          ))}
          {result.invoice && <li>Its keccak256 equals the invoice hash registered on chain.</li>}
        </ul>
      ) : (
        <p className="mt-2 text-ink/80">Its fingerprint differs from every attested document and from the invoice hash on chain. Changing even one byte gives a different fingerprint.</p>
      )}
      <div className="mt-2"><HashBadge value={file.sha256} label="sha256" /></div>
    </div>
  );
}

function AttestModal({ view, existing, onClose }: { view: ShipmentView; existing: AttestedDocument[]; onClose: () => void }) {
  const { address } = useAccount();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [file, setFile] = useState<FileHashes | null>(null);
  const [kind, setKind] = useState<DocumentKind>("invoice");
  const [hashing, setHashing] = useState(false);
  const [busy, setBusy] = useState<"sign" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = view.shipment.id;
  const duplicate = file ? existing.find((d) => d.sha256.toLowerCase() === file.sha256) : undefined;
  const isInvoice = !!file && file.keccak256 === view.shipment.invoiceHash.toLowerCase();

  async function pick(f: File) {
    setError(null);
    setHashing(true);
    try {
      const h = await hashFile(f);
      setFile(h);
      setKind(h.keccak256 === view.shipment.invoiceHash.toLowerCase() ? "invoice" : guessKind(h.name));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The file could not be read.");
    } finally {
      setHashing(false);
    }
  }

  async function attest() {
    if (!address || !file) return;
    setError(null);
    const issuedAt = nowSec();
    let signature: string;
    try {
      setBusy("sign");
      signature = await signMessage(wagmiConfig, { account: address, message: documentMessage(id, kind, file.sha256, issuedAt) });
    } catch (err) {
      setError(signatureError(err));
      setBusy(null);
      return;
    }
    try {
      setBusy("save");
      const doc = await apiPost(`/v1/shipments/${id}/documents`, { kind, name: file.name.slice(0, 200), sizeBytes: file.sizeBytes, sha256: file.sha256, keccak256: file.keccak256, issuedAt, signature }, AttestedDocument);
      await qc.invalidateQueries({ queryKey: ["documents", id] });
      toast({ tone: "verified", title: `${kindLabel[doc.kind] ?? "Document"} attested`, body: doc.matchesInvoiceHash ? "It matches the invoice hash registered on chain." : undefined });
      onClose();
    } catch (err) {
      setError(isUnavailable(err) ? "Document attestation is not available on this deployment yet." : err instanceof ApiError ? err.message : "The document could not be attested.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open onClose={onClose} title="Attest a document" description="Sign a file's fingerprint so every party can check their copy. The file stays on this device.">
      <div className="flex flex-col gap-4">
        {file ? (
          <div className="rounded-tile border border-line bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold" title={file.name}>{file.name}</p>
                <p className="text-sm text-text-muted">{formatBytes(file.sizeBytes)}</p>
              </div>
              <PickFile label="Another file to attest" onPick={(f) => void pick(f)} disabled={hashing || busy !== null}>Change</PickFile>
            </div>
            <div className="mt-3 flex flex-col items-start gap-1.5">
              <HashBadge value={file.sha256} label="sha256" />
              <HashBadge value={file.keccak256} label="keccak" />
            </div>
            {isInvoice && <Pill tone="verified" dot className="mt-3">Matches the on-chain invoice hash</Pill>}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-tile border-2 border-dashed border-line bg-white px-4 py-8 text-center">
            <p className="text-sm text-text-muted">Invoice, bill of lading, packing list or certificate: any file type.</p>
            <PickFile label="File to attest" variant="primary" onPick={(f) => void pick(f)} disabled={hashing}>
              {hashing ? <><Spinner /> Hashing…</> : "Choose a file"}
            </PickFile>
          </div>
        )}

        {file && (
          <div>
            <label htmlFor="doc-kind" className="mb-1.5 block text-sm font-semibold">Document type</label>
            <select id="doc-kind" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)} className="h-12 w-full rounded-tile border-2 border-line bg-white px-3 outline-none focus:border-ink">
              {DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>{kindLabel[k]}</option>
              ))}
            </select>
          </div>
        )}
        {duplicate && <p className="text-sm font-medium text-warning-fg">This exact file is already attested by the {duplicate.role} ({kindLabel[duplicate.kind] ?? duplicate.kind}).</p>}
        {error && <p role="alert" className="text-sm font-medium text-danger-fg">{error}</p>}
        <p className="text-sm text-text-muted">Your wallet signs a message naming this shipment, the document type and the SHA-256. Signing costs no gas.</p>
        <Button loading={busy !== null} disabled={!file || hashing || !!duplicate} onClick={() => void attest()}>
          {busy === "sign" ? "Waiting for your signature…" : busy === "save" ? "Attesting…" : "Sign and attest"}
        </Button>
      </div>
    </Modal>
  );
}
