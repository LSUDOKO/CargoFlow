import type { Tone } from "@/lib/status";
import { statusLabel, statusTone } from "@/lib/status";
import { cx } from "./cx";

/**
 * Badge: a short status or category label.
 * Semantic variants: success, warning, danger, info, neutral, plus ink (a settled/final state) and signal (live, new).
 * `onDark` switches to the ink-surface palette. Shapes: pill (status) or square (category, count, code-like tags).
 */
export type BadgeVariant = "success" | "warning" | "danger" | "info" | "neutral" | "ink" | "signal";
export type BadgeSize = "sm" | "md";

const light: Record<BadgeVariant, string> = {
  success: "bg-success-bg text-success-fg ring-success-border",
  warning: "bg-warning-bg text-warning-fg ring-warning-border",
  danger: "bg-danger-bg text-danger-fg ring-danger-border",
  info: "bg-info-bg text-info-fg ring-info-border",
  neutral: "bg-ink/6 text-text-muted ring-ink/10",
  ink: "bg-ink text-paper ring-ink",
  signal: "bg-signal-soft text-signal-fg ring-signal-2/60",
};
const dark: Record<BadgeVariant, string> = {
  success: "bg-success-bg-ink text-success-fg-ink ring-success-border-ink",
  warning: "bg-warning-bg-ink text-warning-fg-ink ring-warning-border-ink",
  danger: "bg-danger-bg-ink text-danger-fg-ink ring-danger-border-ink",
  info: "bg-info-bg-ink text-info-fg-ink ring-info-border-ink",
  neutral: "bg-paper/12 text-paper ring-paper/20",
  ink: "bg-signal text-ink ring-signal",
  signal: "bg-signal text-ink ring-signal",
};
const dots: Record<BadgeVariant, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-slate",
  ink: "bg-signal",
  signal: "bg-signal-fg",
};
const darkDots: Partial<Record<BadgeVariant, string>> = { ink: "bg-ink", signal: "bg-ink", neutral: "bg-paper/70" };

export type BadgeProps = {
  variant?: BadgeVariant;
  size?: BadgeSize;
  shape?: "pill" | "square";
  dot?: boolean;
  /** Animate the dot (live data). Respects reduced motion. */
  pulse?: boolean;
  onDark?: boolean;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

export function Badge({ variant = "neutral", size = "md", shape = "pill", dot, pulse, onDark, icon, className, children }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex max-w-full items-center gap-1.5 font-semibold whitespace-nowrap ring-1 ring-inset",
        size === "sm" ? "h-5 px-2 text-micro" : "h-6 px-2.5 text-xs",
        shape === "pill" ? "rounded-full" : "rounded-md",
        onDark ? dark[variant] : light[variant],
        className,
      )}
    >
      {dot && <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", (onDark && darkDots[variant]) || dots[variant], pulse && "animate-pulse-dot")} aria-hidden="true" />}
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** v1 tone names → badge variants. */
const toneToVariant: Record<Tone | "info", BadgeVariant> = { verified: "success", alert: "warning", ink: "ink", danger: "danger", slate: "neutral", info: "info" };

/** The v1 status pill. Takes the status tone (verified/alert/ink/danger/slate, plus info). Prefer Badge in new code. */
export function Pill({ tone = "slate", children, className, dot, onDark }: { tone?: Tone | "info"; children: React.ReactNode; className?: string; dot?: boolean; onDark?: boolean }) {
  return (
    <Badge variant={toneToVariant[tone]} dot={dot} onDark={onDark} className={className}>
      {children}
    </Badge>
  );
}

export function StatusPill({ status, className, onDark }: { status: string | undefined | null; className?: string; onDark?: boolean }) {
  return (
    <Pill tone={statusTone(status)} dot className={className} onDark={onDark}>
      <span data-testid="status-pill" data-status={status ?? ""}>{statusLabel(status)}</span>
    </Pill>
  );
}
