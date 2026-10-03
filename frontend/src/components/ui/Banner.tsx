import { CloseIcon } from "./CloseIcon";
import { cx } from "./cx";
import { StateIcon } from "./StateIcon";

export type CalloutVariant = "info" | "success" | "warning" | "danger" | "neutral";

type Props = {
  variant?: CalloutVariant;
  title?: React.ReactNode;
  children?: React.ReactNode;
  /** A Button or link placed after the text (right on wide screens). */
  action?: React.ReactNode;
  onDismiss?: () => void;
  /**
   * Announce it: "polite" (role=status) for news that arrived, "assertive" (role=alert) for a problem the user must
   * act on now. Leave unset for static guidance that is part of the page.
   */
  live?: "polite" | "assertive";
  onDark?: boolean;
  /** Replace the state icon (pass null for none). */
  icon?: React.ReactNode | null;
  className?: string;
};

const light: Record<CalloutVariant, string> = {
  info: "bg-info-bg text-ink ring-info-border",
  success: "bg-success-bg text-ink ring-success-border",
  warning: "bg-warning-bg text-ink ring-warning-border",
  danger: "bg-danger-bg text-ink ring-danger-border",
  neutral: "bg-mist text-ink ring-border",
};
const dark: Record<CalloutVariant, string> = {
  info: "bg-info-bg-ink text-paper ring-info-border-ink",
  success: "bg-success-bg-ink text-paper ring-success-border-ink",
  warning: "bg-warning-bg-ink text-paper ring-warning-border-ink",
  danger: "bg-danger-bg-ink text-paper ring-danger-border-ink",
  neutral: "bg-paper/8 text-paper ring-paper/15",
};
const iconTone: Record<CalloutVariant, string> = { info: "text-info-fg", success: "text-success-fg", warning: "text-warning-fg", danger: "text-danger-fg", neutral: "text-ink-500" };
const iconToneDark: Record<CalloutVariant, string> = { info: "text-info-fg-ink", success: "text-success-fg-ink", warning: "text-warning-fg-ink", danger: "text-danger-fg-ink", neutral: "text-paper/70" };
const kind = { info: "info", success: "success", warning: "warning", danger: "danger", neutral: "info" } as const;

function Base({ variant = "info", title, children, action, onDismiss, live, onDark, icon, className, bar }: Props & { bar?: boolean }) {
  const role = live === "assertive" ? "alert" : live === "polite" ? "status" : undefined;
  return (
    <div
      role={role}
      className={cx(
        "flex items-start gap-3 ring-1 ring-inset",
        bar ? "px-[var(--gutter)] py-3" : "rounded-tile px-4 py-3.5",
        onDark ? dark[variant] : light[variant],
        className,
      )}
    >
      {icon !== null && <span className={cx("mt-0.5 shrink-0", onDark ? iconToneDark[variant] : iconTone[variant])}>{icon ?? <StateIcon kind={kind[variant]} />}</span>}
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-sm">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={cx(!!title && "mt-0.5", onDark ? "text-paper/80" : "text-ink/80")}>{children}</div>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className={cx("-my-1 -mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-full", onDark ? "text-paper/70 hover:bg-paper/10" : "text-ink/60 hover:bg-ink/8 hover:text-ink")}>
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Inline guidance or a state message inside the content: rounded, sits within a card or a column. */
export function Callout(props: Props) {
  return <Base {...props} />;
}

/** A full-width bar at the top of the page or a panel (offline, wrong network, testnet notice). Square edges. */
export function Banner(props: Props) {
  return <Base {...props} bar />;
}
