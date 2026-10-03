"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { CopyField } from "@/components/ui/CopyField";
import { Badge } from "@/components/ui/Pill";
import { Spinner } from "@/components/ui/Spinner";
import { apiGet, lookupReference } from "@/lib/api/client";
import { useConfig, useShipments } from "@/lib/api/hooks";
import { EpochList, type EpochSummary } from "@/lib/api/schemas";
import { resolveShipment } from "@/lib/resolve";

const tabs = [
  { id: "track", label: "Track a shipment", short: "Track", icon: "M4 7h11l5 5v5h-2a2 2 0 1 1-4 0H9a2 2 0 1 1-4 0H4z" },
  { id: "finance", label: "Get financing", short: "Finance", icon: "M4 7h16v10H4zM8 12h8M12 9v6" },
  { id: "verify", label: "Verify evidence", short: "Verify", icon: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6zM9 12l2 2 4-4" },
] as const;

type TabId = (typeof tabs)[number]["id"];

/** The tabbed action bar docked on the hero: track a shipment, start financing, or look up committed evidence. */
export function TrackBar() {
  const [tab, setTab] = useState<TabId>("track");
  return (
    <div className="surface-light rounded-card border border-border bg-surface p-2.5 text-ink shadow-3 md:p-3">
      {/* the tab strip, the search field and its button share one geometry: a 2px-bordered pill, 6px inset, 44px controls */}
      <div role="tablist" aria-label="What would you like to do?" className="grid grid-cols-3 gap-1 rounded-full bg-surface-sunken p-1 sm:inline-flex">
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
              className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full px-3 text-small font-semibold whitespace-nowrap transition-colors duration-(--duration-fast) ease-standard sm:px-4 ${selected ? "bg-surface text-ink shadow-1 ring-1 ring-border" : "text-text-muted hover:text-ink"}`}
            >
              <svg viewBox="0 0 24 24" className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true">
                <path d={t.icon} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              <span className="sm:hidden">{t.short}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>
      <div className="px-1 pt-2.5 pb-1 md:px-1.5">
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
      className="flex flex-col gap-2 sm:flex-row sm:items-center sm:rounded-full sm:bg-paper sm:p-1 sm:ring-1 sm:ring-border-strong sm:transition-shadow sm:ring-inset sm:focus-within:ring-2 sm:focus-within:ring-ink"
    >
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="h-12 min-w-0 rounded-full border border-border-strong bg-paper px-5 text-base outline-none placeholder:text-text-muted focus:border-ink focus-visible:outline-none sm:h-11 sm:flex-1 sm:border-0 sm:bg-transparent sm:px-4"
      />
      <Button type="submit" variant="ink" loading={busy} className="h-12 sm:h-11 sm:min-w-28">{cta}</Button>
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
        <p className="mt-2.5 px-4 text-small font-medium text-danger-fg" role="alert">{error}</p>
      ) : (
        <p className="mt-2.5 px-4 text-small text-text-muted">
          See the route, the evidence behind every release and the money in escrow, live. No wallet needed.
        </p>
      )}
    </div>
  );
}

function FinancePanel() {
  return (
    <div id="hero-panel-finance" role="tabpanel" aria-labelledby="hero-tab-finance" className="flex flex-col gap-4 px-1 sm:flex-row sm:items-center sm:justify-between sm:pl-4">
      <p className="max-w-xl text-body text-ink/80">
        Register a shipment and its cold-chain policy, then name a financier. Each tranche reaches you the moment its evidence is committed.
      </p>
      <div className="flex shrink-0 flex-wrap gap-2">
        <LinkButton href="/exporter" variant="ink">Start as an exporter</LinkButton>
        <LinkButton href="/financier" variant="secondary">Fund a facility</LinkButton>
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
      {error && <p className="mt-2.5 px-4 text-small font-medium text-danger-fg" role="alert">{error}</p>}
      {found && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-tile bg-success-bg px-4 py-3 text-small">
          <Badge variant="success" dot>Committed on-chain</Badge>
          <span>Score <b className="num">{found.epoch.score}</b></span>
          <span>{found.epoch.readingCount} readings</span>
          <CopyField value={found.epoch.root} label="Root" kind="hash" size="sm" />
          {found.epoch.commitTx && <CopyField value={found.epoch.commitTx} kind="tx" chainId={cfg?.chainId} label="Tx" size="sm" />}
          <LinkButton href={`/track/${found.shipment}`} variant="ghost" size="sm" className="-my-1">Open shipment</LinkButton>
        </div>
      )}
      {!error && !found && !busy && <p className="mt-2.5 px-4 text-small text-text-muted">Every evidence epoch is a Poseidon Merkle root on-chain. The readings themselves stay private.</p>}
      {busy && <p className="mt-2.5 flex items-center gap-2 px-4 text-small text-text-muted"><Spinner /> Searching committed epochs…</p>}
    </div>
  );
}
