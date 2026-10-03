"use client";

import Link from "next/link";
import { cx } from "@/components/ui/cx";
import { useParty, type Grade } from "@/lib/api/market";
import { shortHash } from "@/lib/format";

const gradeTone: Record<Grade, string> = {
  A: "bg-success-solid text-white",
  B: "bg-signal text-ink",
  C: "bg-alert text-ink",
  new: "bg-ink/8 text-text-muted",
};

const gradeWords: Record<Grade, string> = {
  A: "Grade A: a clean record of settled trade",
  B: "Grade B: mostly settled, some pauses",
  C: "Grade C: disputes or defaults on record",
  new: "New: no settled trade on CargoFlow yet",
};

/** A track-record grade as a small square badge; "new" reads as a dash-free word so it never looks like a score. */
export function GradeBadge({ grade, size = "sm", className }: { grade: Grade | undefined; size?: "sm" | "lg"; className?: string }) {
  const g = grade ?? "new";
  return (
    <span
      role="img"
      title={gradeWords[g]}
      aria-label={gradeWords[g]}
      className={cx(
        "inline-grid shrink-0 place-items-center font-display font-bold",
        size === "lg" ? "h-14 min-w-14 rounded-tile px-3 text-metric" : "h-6 min-w-6 rounded-md px-1.5 text-xs",
        g === "new" && size === "sm" && "text-caption",
        g === "new" && size === "lg" && "text-base",
        gradeTone[g],
        className,
      )}
    >
      {g === "new" ? "New" : g}
    </span>
  );
}

/** The grade's meaning without the "Grade A:" prefix, for places that already show the grade. */
export const gradeDescription = (g: Grade | undefined) => {
  const t = gradeWords[g ?? "new"].split(": ")[1] ?? "";
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** An address that opens its track record, with the party's grade beside it (fetched once per address and cached). */
export function PartyLink({ address, label, className, onDark }: { address: string; label?: string; className?: string; onDark?: boolean }) {
  const { data } = useParty(address);
  return (
    <Link
      href={`/parties/${address.toLowerCase()}`}
      className={cx("group inline-flex items-center gap-2 rounded-lg text-sm font-semibold", className)}
      title={`Track record of ${address}`}
    >
      <GradeBadge grade={data?.grade} />
      <span className={cx("font-mono underline-offset-2 group-hover:underline", onDark ? "text-paper" : "text-ink")}>{label ?? shortHash(address, 4, 4)}</span>
    </Link>
  );
}
