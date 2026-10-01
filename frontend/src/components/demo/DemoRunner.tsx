"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Highlight } from "@/components/brand/Highlight";
import { ShipmentDashboard } from "@/components/shipment/ShipmentDashboard";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { HashBadge } from "@/components/ui/HashBadge";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { ApiError, apiPost } from "@/lib/api/client";
import { useConfig, useDemoStatus } from "@/lib/api/hooks";
import { DemoCreated, DemoStep } from "@/lib/api/schemas";
import { formatUSDG } from "@/lib/format";

/** The story, in the order the backend enforces. Labels are shared with the end-to-end test. */
export const SCENES = [
  { id: "healthy", label: "Healthy milestones", what: "Sixteen in-range readings from both probes close two evidence epochs. Each is committed on-chain and releases its tranche." },
  { id: "excursion", label: "Thermal excursion", what: "The container's air probe climbs to 11.7 °C while the core probe stays cool. The probes contradict each other, the score falls and the facility pauses. Milestone 3 is blocked." },
  { id: "recover", label: "Recovery proof", what: "The core probe keeps reporting in range. A Groth16 proof over eight hidden readings, bound to this pause, resumes the facility and releases milestone 3." },
  { id: "finish", label: "Remaining milestones", what: "Clean evidence clears milestones 4 and 5. The whole facility is now drawn." },
  { id: "settle", label: "Delivery and settlement", what: "The buyer confirms delivery and pays the invoice. The vault repays the financier with the fee and sends the exporter the residual." },
] as const;

export function DemoRunner() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id") ?? undefined;
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: cfg, isPending: cfgPending } = useConfig();
  const status = useDemoStatus(id);
  const [busy, setBusy] = useState<string | null>(null);
  const [txs, setTxs] = useState<Record<string, string[]>>({});
  const done = new Set(status.data?.done ?? []);
  const next = status.data?.next ?? "";
  const lost = !!id && status.isError && (status.error as ApiError).status === 404;

  const run = async (scene: string) => {
    setBusy(scene);
    try {
      if (scene === "setup") {
        const r = await apiPost("/v1/demo/shipments", {}, DemoCreated);
        setTxs({ setup: r.txHashes });
        router.replace(`/demo?id=${r.shipmentId}`, { scroll: false });
        toast({ tone: "verified", title: "Shipment registered and funded", body: `${formatUSDG(r.drawn === "0" ? "0" : r.drawn)} USDG drawn so far` });
      } else if (id) {
        const r = await apiPost(`/v1/demo/shipments/${id}/scenes/${scene}`, undefined, DemoStep);
        setTxs((t) => ({ ...t, [scene]: r.txHashes }));
        toast({ tone: r.status === "PAUSED" ? "alert" : "verified", title: `${SCENES.find((s) => s.id === scene)?.label} done`, body: r.status ? `Facility is ${r.status.toLowerCase()}` : undefined });
      }
    } catch (e) {
      const err = e as ApiError;
      toast({
        tone: "danger",
        title: err.status === 429 ? "Another run started moments ago" : err.status === 409 ? "That scene isn't next" : "The scene failed",
        body: err.status === 429 ? "Runs are spaced 30 seconds apart. Try again shortly." : err.message,
      });
    } finally {
      setBusy(null);
      await qc.invalidateQueries();
    }
  };

  if (!cfgPending && cfg && !cfg.demoMode) {
    return (
      <div className="container-page py-16">
        <Card className="mx-auto max-w-2xl text-center">
          <h1 className="font-display text-3xl font-bold">The live demo is switched off here</h1>
          <p className="mx-auto mt-3 max-w-md text-slate">
            This backend runs without demo wallets. Start it with <code className="rounded bg-ink/6 px-1.5">DEMO_MODE=true</code>, or run the
            same story from a terminal with <code className="rounded bg-ink/6 px-1.5">make demo</code>.
          </p>
        </Card>
      </div>
    );
  }

  const divisor = status.data?.divisor ?? 1;
  return (
    <div className="container-page py-10">
      <div className="grid gap-6 xl:grid-cols-[400px_1fr]">
        <div className="xl:sticky xl:top-24 xl:self-start">
          <h1 className="font-display text-[clamp(2.2rem,4.5vw,3.4rem)] leading-[1] font-bold tracking-[-0.04em]">
            Watch a shipment <Highlight>earn</Highlight> its capital
          </h1>
          <p className="mt-4 text-lg text-ink/75">
            Each step below sends real transactions with wallets the demo backend holds. Nothing is staged: the dashboard shows what the chain says.
          </p>
          {!id || lost ? (
            <Card className="mt-6">
              {lost && <p className="mb-3 text-sm font-medium text-[#8a5300]">That run is no longer in memory (the backend restarted). Start a fresh one.</p>}
              <p className="text-slate">A new run registers a reefer shipment from Nhava Sheva to Singapore, opens a five-milestone facility and funds it.</p>
              <Button className="mt-4 w-full" size="lg" loading={busy === "setup"} onClick={() => run("setup")}>Start a new run</Button>
            </Card>
          ) : (
            <ol className="mt-6 flex flex-col gap-3" aria-label="Story scenes">
              <li className="flex items-center gap-3 rounded-2xl bg-verified/10 px-4 py-3 text-sm font-semibold">
                <span aria-label="done" className="grid h-7 w-7 place-items-center rounded-full bg-verified text-white">✓</span>
                Registered and funded{divisor > 1 && <span className="font-normal text-slate"> · amounts scaled 1/{divisor}</span>}
              </li>
              {SCENES.map((s, i) => {
                const isDone = done.has(s.id);
                const isNext = next === s.id;
                return (
                  <li key={s.id} className={`rounded-2xl border p-4 transition-colors ${isNext ? "border-ink bg-white shadow-[var(--shadow-card)]" : isDone ? "border-transparent bg-verified/10" : "border-line bg-paper"}`}>
                    <div className="flex items-start gap-3">
                      {isDone ? (
                        <span aria-label="done" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-verified text-sm text-white">✓</span>
                      ) : (
                        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${isNext ? "bg-ink text-signal" : "bg-ink/8 text-slate"}`}>{i + 1}</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{s.label}</p>
                        <p className="mt-1 text-sm text-slate">{s.what}</p>
                        {(txs[s.id]?.length ?? 0) > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {txs[s.id]!.slice(0, 6).map((h) => <HashBadge key={h} value={h} kind="tx" chainId={cfg?.chainId} compact />)}
                          </div>
                        )}
                        {isNext && (
                          <Button className="mt-3" loading={busy === s.id} disabled={!!busy} onClick={() => run(s.id)} aria-label={`Run: ${s.label}`}>
                            {busy === s.id ? "Sending transactions…" : `Run: ${s.label}`}
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
              {status.data && !next && (
                <li className="rounded-2xl bg-ink p-5 text-paper">
                  <p className="font-display text-xl font-semibold text-signal">Settled</p>
                  <p className="mt-1 text-paper/75">The story is complete. Every transaction above is on-chain; the audit trail lists them all.</p>
                  <Button className="mt-4" onClick={() => router.replace("/demo")}>Start another run</Button>
                </li>
              )}
            </ol>
          )}
          {busy && busy !== "setup" && (
            <p className="mt-4 flex items-center gap-2 text-sm text-slate"><Spinner /> Readings are being signed, scored and committed…</p>
          )}
        </div>
        <div className="min-w-0">
          {id && !lost ? (
            <ShipmentDashboard id={id} compact />
          ) : (
            <div className="grid min-h-[24rem] place-items-center rounded-[var(--radius-card)] border border-dashed border-ink/20 p-10 text-center text-slate">
              The live dashboard for your run appears here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
