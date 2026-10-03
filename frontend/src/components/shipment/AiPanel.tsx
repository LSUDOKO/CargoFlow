import { Pill } from "@/components/ui/Pill";
import type { Assessment } from "@/lib/shipment";

const actionWords: Record<string, string> = { APPROVE_ADVANCE: "Approve the next tranche", PAUSE_FACILITY: "Pause the facility", REQUEST_SECONDARY_PROOF: "Ask for more proof", OBSERVED: "Observed only", RESUME_WITH_PROOF: "Resumed with proof", HELD_NOT_AT_PLACE: "Hold: not at the place yet" };
const reasonWords: Record<string, string> = {
  OK: "All checks passed", SCORE_BELOW_THRESHOLD: "Evidence score below the threshold", NOT_COMPLIANT: "Readings outside the agreed band",
  CONFLICT_TOO_HIGH: "The probes contradict each other", RISK_TOO_HIGH: "Risk above the policy limit", FRAUD_SIGNALS: "Signs of manipulated telemetry",
  AI_REQUESTED: "The AI monitor asked for it", HUMIDITY_LIMIT: "Humidity above the agreed limit", SHOCK_LIMIT: "A shock above the agreed limit", ZK_RECOVERY: "Zero-knowledge recovery", FACILITY_PAUSED: "Facility was paused",
};

export function AiPanel({ assessment }: { assessment: Assessment | null }) {
  if (!assessment) return <p className="text-sm text-text-muted">The monitor reports here once the first epoch is evaluated.</p>;
  const severe = assessment.action === "PAUSE_FACILITY";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={severe ? "alert" : assessment.action === "APPROVE_ADVANCE" ? "verified" : assessment.action === "HELD_NOT_AT_PLACE" ? "ink" : "slate"} dot>{actionWords[assessment.action] ?? assessment.action}</Pill>
        {assessment.confidence !== undefined && <Pill tone="slate"><span className="num">{Math.round(assessment.confidence * 100)}%</span> confident</Pill>}
      </div>
      <p className="mt-3 font-display text-h3">{reasonWords[assessment.reason] ?? assessment.reason}</p>
      {assessment.explanation && <blockquote className="mt-3 border-l-2 border-signal-2 pl-3 text-sm text-ink/80">{assessment.explanation}</blockquote>}
      <p className="mt-3 text-sm text-text-muted">
        {assessment.decider === "ai-escalation"
          ? "The AI monitor made this stricter than the policy required."
          : assessment.provider
            ? `Decided by the policy gate; ${assessment.provider.replace("groq:", "")} reviewed it.`
            : "Decided by the deterministic policy gate (no AI model configured)."}
      </p>
      <p className="mt-2 text-caption text-text-muted">The AI can only tighten a decision. It cannot release money or override the contract.</p>
    </div>
  );
}
