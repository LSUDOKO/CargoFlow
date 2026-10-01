import { HashBadge } from "@/components/ui/HashBadge";
import type { AuditEntry, EpochSummary } from "@/lib/api/schemas";

export function ProofCard({ epochs, audit, chainId, paused }: { epochs: EpochSummary[]; audit: AuditEntry[]; chainId?: number; paused: boolean }) {
  const proven = epochs.find((e) => e.proofVerified);
  const resume = audit.find((a) => a.title.startsWith("RESUME_WITH_PROOF"));
  if (!proven) {
    return (
      <p className="text-slate">
        {paused
          ? "Waiting for recovery evidence: eight in-range readings from the unaffected probe, then a Groth16 proof bound to this pause."
          : "No recovery has been needed. A proof appears here if a pause is ever lifted with zero-knowledge evidence."}
      </p>
    );
  }
  return (
    <div className="rounded-2xl bg-ink p-4 text-paper">
      <p className="font-display text-lg font-semibold text-signal">Groth16 proof verified on-chain</p>
      <p className="mt-1 text-sm text-paper/75">
        Eight hidden readings from milestone {proven.milestoneIndex + 1} were proven to sit inside the agreed band. None of them were revealed.
      </p>
      <div className="mt-3 flex flex-wrap gap-2 [&>span]:bg-paper/10 [&>span]:text-paper">
        <HashBadge value={proven.root} label="root" />
        {resume?.txHash && <HashBadge value={resume.txHash} kind="tx" chainId={chainId} label="resume" />}
      </div>
    </div>
  );
}
