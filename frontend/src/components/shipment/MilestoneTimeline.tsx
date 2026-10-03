import { Badge, type BadgeVariant } from "@/components/ui/Pill";
import { CopyField } from "@/components/ui/CopyField";
import { cx } from "@/components/ui/cx";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Timeline, type TimelineItem, type TimelineState } from "@/components/ui/Timeline";
import type { Facility, Milestone } from "@/lib/api/schemas";
import { formatUSDG } from "@/lib/format";
import { placeStatus, type PlaceStatus } from "@/lib/places";
import { milestoneStates, type MilestoneState } from "@/lib/shipment";

const placeTone: Record<PlaceStatus["tone"], string> = { done: "text-text-muted", held: "text-warning-fg", inside: "text-ink", info: "text-text-muted" };

/** The milestone's place line (contracts v2), with a pin; nothing when the milestone may release anywhere. */
export function PlaceLine({ status, className }: { status: PlaceStatus | null; className?: string }) {
  if (!status) return null;
  return (
    <span className={cx("flex items-start gap-1.5 text-small leading-snug", placeTone[status.tone], className)}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8 14.5s4.5-4.2 4.5-8a4.5 4.5 0 0 0-9 0c0 3.8 4.5 8 4.5 8Z" /><circle cx="8" cy="6.5" r="1.6" /></svg>
      <span className="min-w-0">{status.text}</span>
    </span>
  );
}

const dateTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

/** Status words. A released milestone reads exactly "Released" (one per milestone; the lifecycle test counts them). */
const word: Record<MilestoneState, string> = { released: "Released", next: "Waiting for evidence", blocked: "Blocked by the pause", pending: "Not yet" };

function StateLine({ text, tone, time }: { text: string; tone: "muted" | "ink" | "warning" | "danger"; time?: string }) {
  const cls = { muted: "font-medium text-text-muted", ink: "font-semibold text-ink", warning: "font-semibold text-warning-fg", danger: "font-semibold text-danger-fg" }[tone];
  return (
    <>
      <span className={cls}>{text}</span>
      {time && (
        <>
          <span aria-hidden="true"> · </span>
          <span className="num">{time}</span>
        </>
      )}
    </>
  );
}

/**
 * The journey, top to bottom: each milestone with the money it releases and where it must happen, then delivery and
 * payment. Done steps are quiet (a check and a muted "Released"); the step that needs attention carries the colour.
 */
export function JourneyTimeline({ milestones, facility, invoiceValue, nextDistanceM = null }: { milestones: Milestone[]; facility: Facility | null; invoiceValue: string; nextDistanceM?: number | null }) {
  const states = milestoneStates(facility, milestones.length || 5);
  const status = facility?.status ?? "";
  const items: TimelineItem[] = states.map((st, i) => {
    const m = milestones[i];
    const place = placeStatus(m, st, st === "next" ? nextDistanceM : null);
    const placeHeld = st === "next" && place?.tone === "held";
    const state: TimelineState = st === "released" ? "done" : st === "blocked" ? "held" : st === "next" ? (placeHeld ? "held" : "active") : "pending";
    return {
      id: `m${i}`,
      eyebrow: `Milestone ${i + 1}`,
      title: (
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0">{m?.description || `Checkpoint ${i + 1}`}</span>
          {m && <span className="num shrink-0 font-medium text-ink">{formatUSDG(m.allocatedUsdg)} <span className="text-caption font-normal text-text-muted">USDG</span></span>}
        </span>
      ),
      time: (
        <StateLine
          text={placeHeld ? "Held: not at the place yet" : word[st]}
          tone={st === "released" ? "muted" : st === "blocked" || placeHeld ? "warning" : st === "next" ? "ink" : "muted"}
          time={st === "released" ? dateTime(m?.releasedAt) : undefined}
        />
      ),
      description: place ? <PlaceLine status={place} /> : undefined,
      state,
    };
  });
  const delivered = ["DELIVERED", "SETTLED"].includes(status);
  const allOut = !!facility && facility.nextMilestone >= facility.milestoneCount;
  const waitingBuyer = allOut && status === "ACTIVE";
  items.push({
    id: "delivery",
    eyebrow: "Delivery",
    title: "Buyer confirms arrival",
    time: <StateLine text={delivered ? "Confirmed" : waitingBuyer ? "Waiting for the buyer" : "Not yet"} tone={waitingBuyer ? "ink" : "muted"} />,
    state: delivered ? "done" : waitingBuyer ? "active" : "pending",
  });
  const failed = status === "DEFAULTED" || status === "CANCELLED";
  items.push({
    id: "payment",
    eyebrow: "Payment",
    title: (
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">Buyer pays the invoice</span>
        <span className="num shrink-0 font-medium text-ink">{formatUSDG(invoiceValue)} <span className="text-caption font-normal text-text-muted">USDG</span></span>
      </span>
    ),
    time: (
      <StateLine
        text={status === "SETTLED" ? "Paid and split" : status === "DELIVERED" ? "Waiting for payment" : status === "DEFAULTED" ? "Defaulted" : status === "CANCELLED" ? "Cancelled" : "Not yet"}
        tone={failed ? "danger" : status === "DELIVERED" ? "ink" : "muted"}
      />
    ),
    state: status === "SETTLED" ? "done" : status === "DELIVERED" ? "active" : failed ? "failed" : "pending",
  });
  return <Timeline items={items} label="Shipment journey" />;
}

const badge: Record<MilestoneState, BadgeVariant> = { released: "success", next: "info", blocked: "warning", pending: "neutral" };
type Row = { i: number; st: MilestoneState; m?: Milestone };

/** Every milestone's money: amount, state, when it was released and the transaction to check. */
export function MilestoneTable({ milestones, facility, chainId, nextDistanceM = null }: { milestones: Milestone[]; facility: Facility | null; chainId?: number; nextDistanceM?: number | null }) {
  const rows: Row[] = milestoneStates(facility, milestones.length || 5).map((st, i) => ({ i, st, m: milestones[i] }));
  const columns: Column<Row>[] = [
    {
      key: "milestone",
      header: "Milestone",
      primary: true,
      cell: (r) => {
        const place = placeStatus(r.m, r.st, r.st === "next" ? nextDistanceM : null);
        return (
          <span className="flex min-w-0 flex-col py-1.5">
            <span className="font-semibold">Milestone {r.i + 1}{r.m?.description ? <span className="font-normal text-text-muted"> · {r.m.description}</span> : null}</span>
            {place && <PlaceLine status={place} className="mt-0.5" />}
          </span>
        );
      },
    },
    { key: "amount", header: "Amount (USDG)", numeric: true, cell: (r) => (r.m ? formatUSDG(r.m.allocatedUsdg) : "–") },
    { key: "status", header: "Status", cell: (r) => <Badge variant={badge[r.st]} dot>{r.st === "next" ? "Awaiting evidence" : r.st === "blocked" ? "Blocked: facility paused" : r.st === "released" ? "Released" : "Pending"}</Badge> },
    { key: "when", header: "Released", cell: (r) => (r.m?.releasedAt ? <time className="num text-text-muted" dateTime={r.m.releasedAt}>{dateTime(r.m.releasedAt)}</time> : <span className="text-text-muted">–</span>) },
    { key: "tx", header: "Transaction", cell: (r) => (r.m?.releaseTxHash ? <CopyField value={r.m.releaseTxHash} kind="tx" chainId={chainId} size="sm" label="Tx" /> : <span className="text-text-muted">–</span>) },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(r) => `m${r.i}`} caption="Milestone releases" />;
}
