import Link from "next/link";
import { Highlight } from "@/components/brand/Highlight";
import { Illustration, type IllustrationName } from "@/components/brand/Illustration";
import { Timeline } from "@/components/ui/Timeline";

type Beat = { id: string; label: string; title: string; art: IllustrationName; detail: React.ReactNode };

const beats: Beat[] = [
  {
    id: "sense", label: "Sense", title: "Two probes watch every container, and their readings are weighed, not trusted", art: "sensor",
    detail: (
      <>
        Independent temperature probes sign each reading with their own Ed25519 key; unsigned, replayed or out-of-order packets are
        quarantined before they can count. Readings are fused with Dempster-Shafer theory, so two sensors that contradict each other raise
        a measurable conflict instead of averaging away a problem. An advisory AI can only ever make the verdict stricter.
      </>
    ),
  },
  {
    id: "commit", label: "Commit", title: "Eight readings become one root on-chain", art: "merkle",
    detail: "Every eight readings are hashed into a Poseidon Merkle root and committed on-chain with the score, conflict and risk. The raw readings never leave the operator.",
  },
  {
    id: "release", label: "Release", title: "Capital follows the evidence", art: "vault",
    detail: "The escrow vault releases the next USDG tranche only if the committed epoch meets the shipment's policy: score, compliance, conflict and freshness, all checked by the contract.",
  },
  {
    id: "prove", label: "Pause and prove", title: "An anomaly pauses, a proof resumes", art: "zk",
    detail: "A thermal excursion pauses the facility instantly. A Groth16 proof that the unaffected core probe stayed in range, bound to this exact pause, resumes it, without revealing a single reading.",
  },
  {
    id: "settle", label: "Settle", title: "The invoice pays everyone in one step", art: "settle",
    detail: "When the buyer pays, the vault returns the financier's principal and fee and sends the exporter the residual, in a fixed waterfall nobody can reorder.",
  },
];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The five-beat story. A sticky heading on the left; on the right a numbered rail where the ordinary beats are quiet
 * rows and the one that sets CargoFlow apart (pause and prove) is a navy panel with its own three-step sequence.
 */
export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="container-page mt-24 scroll-mt-24 md:mt-32">
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-28">
            <p className="eyebrow">How it works</p>
            <h2 id="how-title" className="h-section mt-3">
              From a sensor ping to <Highlight>released capital</Highlight>
            </h2>
            <p className="lede mt-5 text-text-muted">Five beats, each one checkable on the explorer.</p>
            <Link href="/deployments" className="mt-6 inline-flex items-center gap-1.5 text-small font-semibold underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
              See the contracts behind each step
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
        <ol className="flex flex-col lg:col-span-8">
          {beats.map((b, i) => {
            const last = i === beats.length - 1;
            if (b.id === "prove") {
              return (
                <li key={b.id} className="relative pb-6 md:pb-8">
                  <div className="surface-ink grid gap-6 rounded-card bg-ink p-6 text-paper shadow-2 md:grid-cols-[minmax(0,1fr)_auto] md:p-8">
                    <div className="min-w-0">
                      <p className="text-small font-semibold text-signal">
                        <span className="num">{pad(i + 1)}</span> · {b.label}
                      </p>
                      <h3 className="mt-2 font-display text-h2">{b.title}</h3>
                      <p className="mt-3 max-w-reading text-paper/75">{b.detail}</p>
                    </div>
                    <Illustration name={b.art} decorative className="hidden h-28 w-28 rounded-tile bg-paper p-2 md:block" />
                    <Timeline
                      onDark
                      orientation="horizontal"
                      label="What happens after an excursion"
                      className="md:col-span-2"
                      items={[
                        { id: "pause", state: "held", title: "Excursion", description: "Releases stop" },
                        { id: "proof", state: "done", title: "Proof verified", description: "On-chain, readings stay private" },
                        { id: "resume", state: "active", title: "Facility resumes", description: "Next tranche can release" },
                      ]}
                    />
                  </div>
                </li>
              );
            }
            return (
              <li key={b.id} className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4 pb-8 md:grid-cols-[2.5rem_minmax(0,1fr)_7rem] md:gap-x-6 md:pb-10">
                {!last && <span aria-hidden="true" className="absolute top-11 bottom-2 left-5 w-px bg-border" />}
                <span className="num grid h-10 w-10 place-items-center rounded-full bg-surface text-small font-semibold text-ink ring-1 ring-border-strong ring-inset" aria-hidden="true">
                  {pad(i + 1)}
                </span>
                <div className="min-w-0 pt-1.5">
                  <p className="eyebrow">{b.label}</p>
                  <h3 className="mt-1.5 font-display text-h2">{b.title}</h3>
                  <p className="mt-2 max-w-reading text-text-muted">{b.detail}</p>
                  {b.id === "settle" && (
                    <Link href="#payout" className="mt-3 inline-flex items-center gap-1.5 text-small font-semibold underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
                      See the split <span aria-hidden="true">↓</span>
                    </Link>
                  )}
                </div>
                <Illustration name={b.art} decorative className="hidden h-28 w-28 md:block" />
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
