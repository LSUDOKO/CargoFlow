import { HashBadge } from "@/components/ui/HashBadge";
import type { Facility, Milestone } from "@/lib/api/schemas";
import { formatUSDG } from "@/lib/format";
import { placeStatus, type PlaceStatus } from "@/lib/places";
import { milestoneStates } from "@/lib/shipment";

const placeTone: Record<PlaceStatus["tone"], string> = { done: "text-[#00733e]", held: "text-ink", inside: "text-ink", info: "text-slate" };

/** The milestone's place line (contracts v2), with a pin; nothing when the milestone may release anywhere. */
function PlaceLine({ status, className = "" }: { status: PlaceStatus | null; className?: string }) {
  if (!status) return null;
  return (
    <p className={`flex items-start gap-1.5 text-[0.8125rem] leading-snug ${placeTone[status.tone]} ${className}`}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8 14.5s4.5-4.2 4.5-8a4.5 4.5 0 0 0-9 0c0 3.8 4.5 8 4.5 8Z" /><circle cx="8" cy="6.5" r="1.6" /></svg>
      <span className="min-w-0">{status.text}</span>
    </p>
  );
}

const label = { released: "Released", next: "Awaiting evidence", blocked: "Blocked: facility paused", pending: "Pending" } as const;
const dot = {
  released: "bg-verified border-verified text-white",
  next: "bg-signal border-ink text-ink",
  blocked: "bg-alert border-ink text-ink",
  pending: "bg-paper border-line text-slate",
} as const;

export function MilestoneTimeline({ milestones, facility, chainId, nextDistanceM = null }: { milestones: Milestone[]; facility: Facility | null; chainId?: number; nextDistanceM?: number | null }) {
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
              <PlaceLine status={placeStatus(m, st, st === "next" ? nextDistanceM : null)} className="mt-0.5" />
              {m?.releaseTxHash && <HashBadge value={m.releaseTxHash} kind="tx" chainId={chainId} className="mt-1.5" />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const shortDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");

type Step = { key: string; overline: string; title: string; amount?: string; state: "done" | "next" | "blocked" | "pending"; status: string; date?: string; place?: PlaceStatus | null };

const node = {
  done: "border-verified bg-verified text-white",
  next: "border-ink bg-signal text-ink",
  blocked: "border-[#8a5300] bg-alert text-ink",
  pending: "border-line bg-white text-slate",
} as const;
const bar = { done: "bg-verified", next: "bg-signal", blocked: "bg-alert", pending: "bg-line" } as const;
const statusTone = { done: "text-[#00733e] font-semibold", next: "text-ink font-semibold", blocked: "text-[#8a5300] font-semibold", pending: "text-slate" } as const;

/**
 * The journey at a glance: each milestone with the money it releases, then delivery and payment. A released
 * milestone reads exactly "Released" (one per milestone; the lifecycle test counts them).
 */
export function JourneyStrip({ milestones, facility, invoiceValue, nextDistanceM = null }: { milestones: Milestone[]; facility: Facility | null; invoiceValue: string; nextDistanceM?: number | null }) {
  const states = milestoneStates(facility, milestones.length || 5);
  const status = facility?.status ?? "";
  const steps: Step[] = states.map((st, i) => {
    const m = milestones[i];
    const place = placeStatus(m, st, st === "next" ? nextDistanceM : null);
    return {
      key: `m${i}`,
      overline: `Milestone ${i + 1}`,
      title: m?.description || `Checkpoint ${i + 1}`,
      amount: m ? `${formatUSDG(m.allocatedUsdg)} USDG` : undefined,
      state: st === "released" ? "done" : st === "next" ? "next" : st === "blocked" ? "blocked" : "pending",
      status: st === "released" ? "Released" : st === "next" ? "Waiting for evidence" : st === "blocked" ? "Blocked by the pause" : "Not yet",
      date: st === "released" ? shortDate(m?.releasedAt) : undefined,
      place,
    };
  });
  const delivered = ["DELIVERED", "SETTLED"].includes(status);
  const allOut = !!facility && facility.nextMilestone >= facility.milestoneCount;
  steps.push({
    key: "delivery",
    overline: "Delivery",
    title: "Buyer confirms arrival",
    state: delivered ? "done" : allOut && status === "ACTIVE" ? "next" : "pending",
    status: delivered ? "Confirmed" : allOut && status === "ACTIVE" ? "Waiting for the buyer" : "Not yet",
  });
  steps.push({
    key: "payment",
    overline: "Payment",
    title: "Buyer pays the invoice",
    amount: `${formatUSDG(invoiceValue)} USDG`,
    state: status === "SETTLED" ? "done" : status === "DELIVERED" ? "next" : "pending",
    status: status === "SETTLED" ? "Paid and split" : status === "DELIVERED" ? "Waiting for payment" : status === "DEFAULTED" ? "Defaulted" : status === "CANCELLED" ? "Cancelled" : "Not yet",
  });

  return (
    <ol className="flex flex-col md:grid md:auto-cols-fr md:grid-flow-col md:gap-3">
        {steps.map((s, i) => (
          <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0 md:flex-col md:gap-0 md:pb-0">
            {/* connector: vertical on phones, horizontal from md */}
            {i < steps.length - 1 && <span aria-hidden="true" className={`absolute top-8 bottom-0 left-[13px] w-0.5 md:hidden ${s.state === "done" ? "bg-verified" : "bg-line"}`} />}
            <div className="relative flex shrink-0 items-center md:mb-3">
              <span className={`relative z-10 grid h-7 w-7 place-items-center rounded-full border-2 text-xs font-bold tabular ${node[s.state]}`} aria-hidden="true">
                {s.state === "done" ? "✓" : s.state === "blocked" ? "!" : i < states.length ? i + 1 : s.key === "delivery" ? "D" : "$"}
              </span>
              <span aria-hidden="true" className={`ml-2 hidden h-1 flex-1 rounded-full md:block ${bar[s.state]}`} />
            </div>
            <div className="min-w-0 pt-0.5 md:pt-0">
              <p className="text-[0.6875rem] font-semibold tracking-wide text-slate uppercase">{s.overline}</p>
              <p className="text-sm leading-snug font-semibold">{s.title}</p>
              {s.amount && <p className="mt-0.5 font-mono text-[0.8125rem] text-ink/80">{s.amount}</p>}
              <p className="mt-1 text-sm">
                <span className={statusTone[s.state]}>{s.status}</span>
                {s.date && <span className="text-slate"> · {s.date}</span>}
              </p>
              <PlaceLine status={s.place ?? null} className="mt-1" />
            </div>
          </li>
        ))}
    </ol>
  );
}
