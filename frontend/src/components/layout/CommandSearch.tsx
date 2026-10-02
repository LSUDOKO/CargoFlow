"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { lookupReference } from "@/lib/api/client";
import { resolveShipment } from "@/lib/resolve";

/** Global "find a shipment" dialog, opened with Ctrl/⌘ K or the header button. */
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
        className="hidden h-11 shrink-0 items-center gap-3 rounded-full border-2 border-paper/20 bg-paper/5 pr-2 pl-4 text-sm whitespace-nowrap text-paper/75 transition-colors hover:border-paper/50 hover:text-paper md:inline-flex"
      >
        Find a shipment
        <kbd className="rounded-full bg-paper/10 px-2 py-1 font-sans text-xs font-semibold whitespace-nowrap text-paper/80">Ctrl K</kbd>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Find a shipment" description="Search by shipment id or by your reference, for example CF-2026-SG01-….">
        <form onSubmit={go} className="flex flex-col gap-3">
          <label htmlFor="cmd-q" className="sr-only">Shipment id or reference</label>
          <input
            id="cmd-q"
            data-autofocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setError(null); }}
            placeholder="0x… or CF-2026-SG01-…"
            className="h-13 rounded-2xl border-2 border-line bg-white px-4 font-mono text-sm outline-none focus:border-ink"
            autoComplete="off"
          />
          {error && <p className="text-sm font-medium text-danger">{error}</p>}
          <Button type="submit" size="lg" loading={busy}>Track shipment</Button>
        </form>
      </Modal>
    </>
  );
}
