import { HashBadge } from "@/components/ui/HashBadge";
import type { Facility, Milestone } from "@/lib/api/schemas";
import { formatUSDG } from "@/lib/format";
import { milestoneStates } from "@/lib/shipment";

const label = { released: "Released", next: "Awaiting evidence", blocked: "Blocked: facility paused", pending: "Pending" } as const;
const dot = {
  released: "bg-verified border-verified text-white",
  next: "bg-signal border-ink text-ink",
  blocked: "bg-alert border-ink text-ink",
  pending: "bg-paper border-line text-slate",
} as const;

export function MilestoneTimeline({ milestones, facility, chainId }: { milestones: Milestone[]; facility: Facility | null; chainId?: number }) {
  const states = milestoneStates(facility, milestones.length || 5);
  return (
    <ol className="relative">
      {states.map((st, i) => {
        const m = milestones[i];
        return (
          <li key={i} className="relative flex gap-4 pb-6 last:pb-0">
            {i < states.length - 1 && <span aria-hidden="true" className={`absolute top-9 bottom-0 left-[17px] w-0.5 ${st === "released" ? "bg-verified" : "bg-line"}`} />}
            <span className={`relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 text-sm font-bold tabular ${dot[st]}`}>
              {st === "released" ? "✓" : st === "blocked" ? "!" : i + 1}
            </span>
            <div className="min-w-0 pt-1">
              <p className="font-semibold">
                Milestone {i + 1}
                {m && <span className="ml-2 font-mono text-sm font-normal text-slate">{formatUSDG(m.allocatedUsdg)} USDG</span>}
              </p>
              <p className={`text-sm ${st === "blocked" ? "font-semibold text-[#8a5300]" : "text-slate"}`}>{label[st]}</p>
              {m?.releaseTxHash && <HashBadge value={m.releaseTxHash} kind="tx" chainId={chainId} className="mt-1.5" />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
