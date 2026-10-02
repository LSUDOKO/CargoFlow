"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { HashBadge } from "@/components/ui/HashBadge";
import { Spinner } from "@/components/ui/Spinner";
import { apiGet, lookupReference } from "@/lib/api/client";
import { useConfig, useShipments } from "@/lib/api/hooks";
import { EpochList, type EpochSummary } from "@/lib/api/schemas";
import { resolveShipment } from "@/lib/resolve";

const tabs = [
  { id: "track", label: "Track a shipment", icon: "M4 7h11l5 5v5h-2a2 2 0 1 1-4 0H9a2 2 0 1 1-4 0H4z" },
  { id: "finance", label: "Get financing", icon: "M4 7h16v10H4zM8 12h8M12 9v6" },
  { id: "verify", label: "Verify evidence", icon: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6zM9 12l2 2 4-4" },
] as const;

type TabId = (typeof tabs)[number]["id"];

/** The tabbed action bar docked on the hero: track a shipment, start financing, or look up committed evidence. */
export function TrackBar() {
  const [tab, setTab] = useState<TabId>("track");
  return (
    <div className="rounded-[1.75rem] border border-line bg-white p-2 shadow-[var(--shadow-lift)] md:p-3">
      <div role="tablist" aria-label="What would you like to do?" className="flex gap-1 overflow-x-auto px-1 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t, i) => {
          const selected = t.id === tab;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              id={`hero-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`hero-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (!dir) return;
                const next = tabs[(i + dir + tabs.length) % tabs.length]!;
                setTab(next.id);
                document.getElementById(`hero-tab-${next.id}`)?.focus();
              }}
              className={`relative inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-[0.95rem] font-semibold transition-colors ${selected ? "bg-ink text-paper" : "text-ink/70 hover:bg-ink/5 hover:text-ink"}`}
            >
              <svg viewBox="0 0 24 24" className="h-[1.1rem] w-[1.1rem]" aria-hidden="true">
                <path d={t.icon} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="p-2 pt-3 md:p-3">
        {tab === "track" && <TrackPanel />}
        {tab === "finance" && <FinancePanel />}
        {tab === "verify" && <VerifyPanel />}
      </div>
    </div>
  );
}

function SearchRow({ id, label, placeholder, value, onChange, busy, cta, onSubmit }: {
  id: string; label: string; placeholder: string; value: string; onChange: (v: string) => void; busy?: boolean; cta: string; onSubmit: () => void;
}) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:rounded-full sm:border-2 sm:border-line sm:bg-paper sm:p-1.5 sm:focus-within:border-ink"
    >
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="h-13 min-w-0 rounded-full border-2 border-line bg-paper px-5 sm:flex-1 text-[1rem] outline-none focus:border-ink sm:h-12 sm:border-0 sm:bg-transparent"
      />
      <Button type="submit" size="lg" loading={busy} className="sm:h-12">{cta}</Button>
    </form>
  );
}

function TrackPanel() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!q.trim()) return setError("Enter a shipment id or reference.");
    setBusy(true);
    try {
      const r = await resolveShipment(q, lookupReference);
      if (r.kind === "none") setError("We couldn't find that shipment. Paste its 0x id or its exact reference.");
      else router.push(`/track/${r.id}`);
    } catch {
      setError("The CargoFlow backend could not be reached. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div id="hero-panel-track" role="tabpanel" aria-labelledby="hero-tab-track">
      <SearchRow
        id="track-q"
        label="Shipment id or reference"
        placeholder="Shipment id (0x…) or reference, e.g. CF-2026-SG01-…"
        value={q}
        onChange={(v) => { setQ(v); setError(null); }}
        busy={busy}
        cta="Track"
        onSubmit={submit}
      />
      {error ? (
        <p className="mt-2 px-3 text-sm font-medium text-danger" role="alert">{error}</p>
      ) : (
        <p className="mt-2 px-3 text-sm text-slate">
          See the route, the evidence behind every release and the money in escrow, live. No wallet needed.
        </p>
      )}
    </div>
  );
}

function FinancePanel() {
  return (
    <div id="hero-panel-finance" role="tabpanel" aria-labelledby="hero-tab-finance" className="flex flex-col gap-4 px-1 sm:flex-row sm:items-center sm:justify-between">
      <p className="max-w-xl text-[1.02rem] text-ink/80">
        Register a shipment and its cold-chain policy, then name a financier. Each tranche reaches you the moment its evidence is committed.
      </p>
      <div className="flex shrink-0 gap-2">
        <LinkButton href="/exporter" size="lg">Start as an exporter</LinkButton>
        <LinkButton href="/financier" size="lg" variant="secondary">Fund a facility</LinkButton>
      </div>
    </div>
  );
}

function VerifyPanel() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ shipment: string; epoch: EpochSummary } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data } = useShipments(50, 0);
  const { data: cfg } = useConfig();
  const search = async () => {
    const target = q.trim().toLowerCase();
    setFound(null);
    if (!/^0x[0-9a-f]{64}$/.test(target)) {
      setError("Paste a 0x epoch id (64 hex characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const s of data?.shipments ?? []) {
        const { epochs } = await apiGet(`/v1/shipments/${s.id}/epochs`, EpochList);
        const hit = epochs.find((e) => e.epochId.toLowerCase() === target);
        if (hit) {
          setFound({ shipment: s.id, epoch: hit });
          return;
        }
      }
      setError("No committed epoch has that id in the latest 50 shipments.");
    } catch {
      setError("The backend could not be reached. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div id="hero-panel-verify" role="tabpanel" aria-labelledby="hero-tab-verify">
      <SearchRow id="verify-q" label="Evidence epoch id" placeholder="Evidence epoch id (0x…)" value={q} onChange={(v) => { setQ(v); setError(null); }} busy={busy} cta="Verify" onSubmit={search} />
      {error && <p className="mt-2 px-3 text-sm font-medium text-danger" role="alert">{error}</p>}
      {found && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-verified/10 px-4 py-3 text-sm">
          <span className="font-semibold text-[#00733e]">Committed on-chain</span>
          <span>Score <b className="tabular">{found.epoch.score}</b></span>
          <span>{found.epoch.readingCount} readings</span>
          <HashBadge value={found.epoch.root} label="root" />
          {found.epoch.commitTx && <HashBadge value={found.epoch.commitTx} kind="tx" chainId={cfg?.chainId} label="tx" />}
          <a href={`/track/${found.shipment}`} className="font-semibold underline underline-offset-2">Open shipment</a>
        </div>
      )}
      {!error && !found && !busy && <p className="mt-2 px-3 text-sm text-slate">Every evidence epoch is a Poseidon Merkle root on-chain. The readings themselves stay private.</p>}
      {busy && <p className="mt-2 flex items-center gap-2 px-3 text-sm text-slate"><Spinner /> Searching committed epochs…</p>}
    </div>
  );
}
