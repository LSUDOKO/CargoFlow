import { CopyField } from "@/components/ui/CopyField";
import { StateIcon } from "@/components/ui/StateIcon";
import type { AuditEntry, EpochSummary } from "@/lib/api/schemas";

export function ProofCard({ epochs, audit, chainId, paused }: { epochs: EpochSummary[]; audit: AuditEntry[]; chainId?: number; paused: boolean }) {
  const proven = epochs.find((e) => e.proofVerified);
  // sent by the backend (operator recovery) or by the exporter's own wallet; the chain event covers both
  const resume = audit.find((a) => a.title.startsWith("FinancingResumed") || a.title.startsWith("RESUME_WITH_PROOF"));
  if (!proven) {
    return (
      <p className="text-sm text-text-muted">
        {paused
          ? "Waiting for recovery evidence: eight in-range readings from the unaffected probe, then a Groth16 proof bound to this pause."
          : "No recovery has been needed. A proof appears here if a pause is ever lifted with zero-knowledge evidence."}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-success-solid text-white"><StateIcon kind="success" className="h-3.5 w-3.5" /></span>
        <span className="min-w-0">
          <span className="block font-semibold text-ink">Groth16 proof verified on-chain</span>
          <span className="mt-0.5 block text-sm text-text-muted">Eight hidden readings from milestone {proven.milestoneIndex + 1} were proven to sit inside the agreed band. None of them were revealed.</span>
        </span>
      </p>
      <div className="flex flex-col items-start gap-1.5 pl-8.5">
        <CopyField value={proven.root} kind="hash" label="Root" size="sm" />
        {resume?.txHash && <CopyField value={resume.txHash} kind="tx" chainId={chainId} label="Resume" size="sm" />}
      </div>
    </div>
  );
}
