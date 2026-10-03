import { Pill } from "@/components/ui/Pill";
import type { Facility } from "@/lib/api/schemas";
import { formatUSDG } from "@/lib/format";
import { facilityStages, stepperStage } from "@/lib/shipment";

export function EscrowPanel({ facility }: { facility: Facility | null }) {
  if (!facility) {
    return <p className="text-slate">No financing facility has been opened for this shipment yet.</p>;
  }
  const committed = BigInt(facility.committed);
  const drawn = BigInt(facility.drawn);
  const pct = committed > 0n ? Number((drawn * 1000n) / committed) / 10 : 0;
  const stage = stepperStage(facility.status);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-4xl font-bold tabular">{formatUSDG(drawn)}</p>
        <p className="text-sm text-slate">of {formatUSDG(committed)} USDG drawn</p>
      </div>
      <div className="mt-3 flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-ink/8" role="img" aria-label={`${pct}% of the facility drawn`}>
        {Array.from({ length: facility.milestoneCount }, (_, i) => (
          <span key={i} className={`flex-1 ${i < facility.nextMilestone ? "bg-verified" : facility.status === "PAUSED" && i === facility.nextMilestone ? "bg-alert" : ""}`} />
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-slate">Still in escrow</dt><dd className="font-mono font-semibold">{formatUSDG(facility.remaining)} USDG</dd></div>
        <div><dt className="text-slate">Financing fee</dt><dd className="font-mono font-semibold">{facility.feeBps / 100}%</dd></div>
      </dl>
      <ol className="mt-5 flex flex-wrap gap-1.5" aria-label="Facility lifecycle">
        {facilityStages.map((s, i) => {
          if (s === "PAUSED" && facility.pauseCount === 0 && facility.status !== "PAUSED") return null;
          const current = s === facility.status;
          const past = i < stage && !(s === "PAUSED" && facility.status !== "PAUSED" && facility.pauseCount === 0);
          return (
            <li key={s} aria-current={current ? "step" : undefined}>
              <Pill tone={current ? (s === "PAUSED" ? "alert" : "ink") : past ? "verified" : "slate"}>{s.charAt(0) + s.slice(1).toLowerCase()}</Pill>
            </li>
          );
        })}
      </ol>
      {facility.status === "PAUSED" && (
        <div className="mt-4 rounded-2xl bg-alert/15 px-4 py-3 text-sm">
          <p className="font-semibold">Releases are paused</p>
          <p className="mt-1 text-ink/75">
            {/HUMIDITY_LIMIT|SHOCK_LIMIT/.test(facility.pauseReason ?? "")
              ? "The last evidence broke the agreed humidity or shock limit. The money stays in escrow until the arbiter resumes the facility (the temperature proof cannot clear this pause)."
              : "The last evidence failed the policy. The money stays in escrow until a zero-knowledge proof of in-range readings resumes the facility."}
          </p>
        </div>
      )}
    </div>
  );
}
