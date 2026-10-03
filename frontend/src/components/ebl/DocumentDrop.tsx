"use client";

import { useId, useState } from "react";
import { hashFile } from "@/lib/ebl";
import { cx } from "@/components/ui/cx";

/**
 * A file picker that also takes a dropped file and hashes it in the browser (keccak256 of the bytes). The file never
 * leaves the device; only its fingerprint is used.
 */
export function DocumentDrop({ label, hint, onHash, error }: { label: string; hint?: string; onHash: (hash: `0x${string}` | null, file: File | null) => void; error?: string }) {
  const id = useId();
  const [over, setOver] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function take(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setName(file.name);
    try {
      onHash(await hashFile(file), file);
    } catch {
      onHash(null, null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">{label}</label>
      <input id={id} aria-describedby={hint ? `${id}-hint` : undefined} type="file" className="peer sr-only" onChange={(e) => void take(e.target.files?.[0] ?? undefined)} />
      <label
        htmlFor={id}
        aria-hidden="true"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take(e.dataTransfer.files[0]);
        }}
        className={cx(
          "flex cursor-pointer flex-col peer-focus-visible:ring-2 peer-focus-visible:ring-ink peer-focus-visible:ring-offset-2 items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-4 py-6 text-center text-sm transition-colors",
          over ? "border-ink bg-ink/5" : error ? "border-danger" : "border-line bg-white hover:border-ink/50",
        )}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-slate" aria-hidden="true">
          <path d="M7 3h7l5 5v13H7z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M14 3v5h5M10 14h6M10 17h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span className="font-semibold">{busy ? "Fingerprinting…" : name ?? "Drop the document here, or choose a file"}</span>
        <span className="text-xs text-slate">Hashed in your browser; the file is never uploaded.</span>
      </label>
      {hint && !error && <p id={`${id}-hint`} className="mt-1.5 text-sm text-slate">{hint}</p>}
      {error && <p className="mt-1.5 text-sm font-medium text-danger">{error}</p>}
    </div>
  );
}
