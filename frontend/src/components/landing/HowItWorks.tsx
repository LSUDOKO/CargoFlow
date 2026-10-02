"use client";

import { useState } from "react";
import { Highlight } from "@/components/brand/Highlight";
import { Illustration, type IllustrationName } from "@/components/brand/Illustration";
import { ToggleIcon } from "@/components/ui/Button";

const steps: { id: string; label: string; title: string; art: IllustrationName; detail: string }[] = [
  { id: "sense", label: "Sense", title: "Two probes watch every container", art: "sensor",
    detail: "Independent temperature probes sign each reading with their own Ed25519 key. Unsigned, replayed or out-of-order packets are quarantined before they can count." },
  { id: "fuse", label: "Fuse", title: "Evidence is weighed, not trusted", art: "ai",
    detail: "Readings are fused with Dempster-Shafer theory, so two sensors that contradict each other raise a measurable conflict instead of averaging away a problem. An advisory AI can only ever make the verdict stricter." },
  { id: "commit", label: "Commit", title: "Eight readings become one root", art: "merkle",
    detail: "Every eight readings are hashed into a Poseidon Merkle root and committed on-chain with the score, conflict and risk. The raw readings never leave the operator." },
  { id: "release", label: "Release", title: "Capital follows the evidence", art: "vault",
    detail: "The escrow vault releases the next USDG tranche only if the committed epoch meets the shipment's policy: score, compliance, conflict and freshness, all checked by the contract." },
  { id: "prove", label: "Pause & prove", title: "An anomaly pauses, a proof resumes", art: "zk",
    detail: "A thermal excursion pauses the facility instantly. A Groth16 proof that the unaffected core probe stayed in range, bound to this exact pause, resumes it, without revealing a single reading." },
  { id: "settle", label: "Settle", title: "The invoice pays everyone in one step", art: "settle",
    detail: "When the buyer pays, the vault returns the financier's principal and fee and sends the exporter the residual, in a fixed waterfall nobody can reorder." },
];

export function HowItWorks() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="surface-ink mt-24 bg-ink py-20 text-paper md:mt-32 md:py-28">
      <div className="container-page">
        <h2 id="how-title" className="h-section max-w-3xl">
          From a sensor ping to <Highlight>released capital</Highlight>
        </h2>
        <p className="lede mt-5 text-paper/70">
          Six steps, each one checkable on the explorer. Open a card to see what happens underneath.
        </p>
        <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, i) => {
            const expanded = open === s.id;
            return (
              <li key={s.id} className="surface-light flex min-h-[22rem] flex-col rounded-[var(--radius-card)] bg-white p-6 text-ink md:p-7">
                <div className="flex items-start justify-between gap-4">
                  <p className="pt-2 text-sm font-semibold text-slate">
                    <span className="tabular">{i + 1}.</span> {s.label}
                  </p>
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : s.id)}
                    aria-expanded={expanded}
                    aria-controls={`step-${s.id}`}
                    aria-label={`${expanded ? "Hide" : "Show"} details: ${s.title}`}
                    className="shrink-0 rounded-full"
                  >
                    <ToggleIcon open={expanded} />
                  </button>
                </div>
                <h3 className="mt-3 font-display text-[1.6rem] leading-[1.1] font-semibold tracking-[-0.03em]">{s.title}</h3>
                {expanded ? (
                  <p id={`step-${s.id}`} className="mt-4 leading-relaxed text-ink/80">{s.detail}</p>
                ) : (
                  <div className="mt-auto flex justify-center pt-6">
                    <Illustration name={s.art} className="h-36 w-36" />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
