import { Pill } from "@/components/ui/Pill";
import { cx } from "@/components/ui/cx";
import { cargoBand, type MarketRequest } from "@/lib/api/market";
import type { Tone } from "@/lib/status";
import { routeEnds } from "./ports";

const statusInfo: Record<string, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "verified" },
  accepted: { label: "Offer accepted", tone: "alert" },
  funded: { label: "Funded", tone: "ink" },
  closed: { label: "Closed", tone: "slate" },
};

export function RequestStatusPill({ status, className, onDark }: { status: string; className?: string; onDark?: boolean }) {
  const s = statusInfo[status] ?? { label: status, tone: "slate" as Tone };
  return (
    <Pill tone={s.tone} dot className={className} onDark={onDark}>
      <span data-testid="request-status" data-status={status}>{s.label}</span>
    </Pill>
  );
}

function Place({ p }: { p: { name: string; country: string | null } }) {
  return (
    <span className="whitespace-nowrap">
      {p.name}
      {p.country && <span className="ml-1 text-caption font-semibold text-text-muted">{p.country}</span>}
    </span>
  );
}

/** "Nhava Sheva IN → Singapore SG" with the country codes de-emphasised. */
export function RouteLabel({ route, className }: { route: MarketRequest["route"]; className?: string }) {
  const ends = routeEnds(route);
  if (!ends) return <span className={cx("text-text-muted", className)}>Route not published</span>;
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-x-1.5", className)}>
      <Place p={ends.from} />
      <svg viewBox="0 0 20 10" className="h-2.5 w-5 shrink-0 text-text-muted" aria-label="to" role="img">
        <path d="M1 5h16M13 1.5 17 5l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <Place p={ends.to} />
    </span>
  );
}

/** The policy's temperature band as a chip: a thermometer, the template name when it matches one, and the range. */
export function BandChip({ policy, className }: { policy: MarketRequest["policy"]; className?: string }) {
  const b = cargoBand(policy);
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-md bg-ink/6 px-2 text-xs font-semibold text-ink ring-1 ring-ink/10 ring-inset", className)}>
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-ink-500" aria-hidden="true">
        <path d="M6.5 2.5a1.5 1.5 0 0 1 3 0v6.3a3 3 0 1 1-3 0z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="8" cy="11.3" r="1.3" fill="currentColor" />
      </svg>
      {b.name && <span>{b.name}</span>}
      {b.name && <span className="text-text-muted" aria-hidden="true">·</span>}
      <span className="num">{b.range}</span>
    </span>
  );
}

/** A labelled figure in a terms grid. */
export function Term({ label, children, sub, className }: { label: string; children: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <dt className="text-small text-text-muted">{label}</dt>
      <dd className="num mt-0.5 text-lg font-semibold text-ink">{children}</dd>
      {sub && <dd className="mt-0.5 text-caption text-text-muted">{sub}</dd>}
    </div>
  );
}
