import type { Tone } from "@/lib/status";
import { statusLabel, statusTone } from "@/lib/status";
import { cx } from "./cx";

const tones: Record<Tone, string> = {
  verified: "bg-verified/12 text-[#00733e] ring-verified/30",
  alert: "bg-alert/18 text-[#8a5300] ring-alert/40",
  ink: "bg-ink text-paper ring-ink",
  danger: "bg-danger/12 text-[#a1191e] ring-danger/30",
  slate: "bg-ink/6 text-slate ring-ink/10",
};
const dots: Record<Tone, string> = { verified: "bg-verified", alert: "bg-alert", ink: "bg-signal", danger: "bg-danger", slate: "bg-slate" };

export function Pill({ tone = "slate", children, className, dot }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", tones[tone], className)}>
      {dot && <span className={cx("h-1.5 w-1.5 rounded-full", dots[tone])} aria-hidden="true" />}
      {children}
    </span>
  );
}

export function StatusPill({ status, className }: { status: string | undefined | null; className?: string }) {
  return (
    <Pill tone={statusTone(status)} dot className={className}>
      <span data-testid="status-pill" data-status={status ?? ""}>{statusLabel(status)}</span>
    </Pill>
  );
}
