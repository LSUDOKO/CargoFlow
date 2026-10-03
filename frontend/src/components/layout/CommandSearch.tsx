"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { Modal } from "@/components/ui/Modal";
import { controlClass } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";
import { lookupReference } from "@/lib/api/client";
import { resolveShipment } from "@/lib/resolve";

/**
 * Global "find a shipment" dialog, opened with Ctrl/⌘ K or the header button.
 * The trigger is a 40px search icon below xl and a labelled field-like button from xl, so the header fits at 768.
 */
export function CommandSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) {
      setError("Enter a shipment id or reference.");
      return;
    }
    setBusy(true);
    const r = await resolveShipment(q, lookupReference).catch(() => null);
    setBusy(false);
    if (!r) {
      setError("The CargoFlow backend could not be reached. Try again in a moment.");
      return;
    }
    if (r.kind === "none") {
      setError("We couldn't find that shipment. Paste its 0x id or its exact reference.");
      return;
    }
    setOpen(false);
    setQ("");
    setError(null);
    router.push(`/track/${r.id}`);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Find a shipment"
        aria-keyshortcuts="Control+K Meta+K"
        title="Find a shipment (Ctrl K)"
        className={cx(
          "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full text-paper/80 ring-1 ring-paper/15 ring-inset",
          "transition-colors duration-(--duration-fast) ease-standard hover:bg-paper/8 hover:text-paper hover:ring-paper/30",
          "w-10 xl:w-auto xl:justify-start xl:pr-1.5 xl:pl-3.5",
        )}
      >
        <svg viewBox="0 0 20 20" className="h-[1.125rem] w-[1.125rem] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="9" cy="9" r="5.5" />
          <path d="m13.2 13.2 3.3 3.3" />
        </svg>
        <span className="hidden text-small font-medium whitespace-nowrap xl:inline">Find a shipment</span>
        <span className="ml-3 hidden xl:inline-flex" aria-hidden="true">
          <Kbd keys={["Ctrl", "K"]} onDark />
        </span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Find a shipment" description="Search by shipment id or by your reference, for example CF-2026-SG01-….">
        <form onSubmit={go} className="flex flex-col gap-3" noValidate>
          <label htmlFor="cmd-q" className="sr-only">Shipment id or reference</label>
          <input
            id="cmd-q"
            data-autofocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setError(null); }}
            placeholder="0x… or CF-2026-SG01-…"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "cmd-q-error" : undefined}
            className={controlClass({ error: !!error, className: "h-12 font-mono text-sm" })}
            autoComplete="off"
            spellCheck={false}
          />
          {error && <p id="cmd-q-error" className="text-small font-medium text-danger-fg" role="alert">{error}</p>}
          <Button type="submit" size="lg" loading={busy}>Track shipment</Button>
        </form>
      </Modal>
    </>
  );
}
