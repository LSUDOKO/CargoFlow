import { cx } from "./cx";

type Props = {
  title: string;
  description?: React.ReactNode;
  /** A 24px line icon (stroke 1.6). Leave out rather than use a generic one. */
  icon?: React.ReactNode;
  /** One next step: a Button or LinkButton (secondary unless it is the page's main action). */
  action?: React.ReactNode;
  /** dashed: a drop-zone-like frame for a list area; plain: inside a card that already frames it. */
  frame?: "dashed" | "plain";
  size?: "sm" | "md";
  className?: string;
  /** Heading level for the title, to fit the page outline. "h1" when the empty state is the whole page (not found). */
  as?: "h1" | "h2" | "h3" | "p";
};

/**
 * What a list or panel shows when it has nothing: say what will appear here and how to make it appear.
 * Filter results that match nothing are an empty state too, with "Clear filters" as the action.
 */
export function EmptyState({ title, description, icon, action, frame = "dashed", size = "md", className, as: H = "h3" }: Props) {
  return (
    <div
      className={cx(
        "flex flex-col items-center text-center",
        size === "sm" ? "px-4 py-8" : "px-6 py-12 md:py-14",
        frame === "dashed" && "rounded-card border border-dashed border-border-strong bg-neutral-25",
        className,
      )}
    >
      {icon && (
        <span className="mb-4 grid h-11 w-11 place-items-center rounded-tile bg-mist text-ink-500" aria-hidden="true">
          {icon}
        </span>
      )}
      <H className={cx("font-display", H === "h1" ? "text-h2" : size === "sm" ? "text-h4" : "text-h3")}>{title}</H>
      {description && <p className="mt-1.5 max-w-[42ch] text-small text-text-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
