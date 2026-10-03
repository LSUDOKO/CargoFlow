import { cx } from "./cx";

export type CardTone = "white" | "paper" | "ink" | "sunken";
export type CardElevation = 0 | 1 | 2;
export type CardPadding = boolean | "none" | "sm" | "md" | "lg";

type Props = React.HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article" | "aside" | "li";
  /** white: the default card. paper: a card that sits on white. ink: a navy panel. sunken: a well inside a card (no border, no shadow). */
  tone?: CardTone;
  /** 0 flat (border only), 1 resting card (default), 2 raised (popover-like, use sparingly). */
  elevation?: CardElevation;
  /** true/"md": 16px on phones, 24px from md. "sm": 16px. "lg": 24px → 32px. false/"none": no padding (tables, maps). */
  padded?: CardPadding;
  /** Hover lift and pointer cursor for a card that is itself a link or button target. */
  interactive?: boolean;
};

const tones: Record<CardTone, string> = {
  white: "bg-surface border border-border",
  paper: "bg-paper border border-border",
  ink: "surface-ink bg-ink text-paper border border-ink-700",
  sunken: "bg-surface-sunken",
};
const elevations: Record<CardElevation, string> = { 0: "shadow-0", 1: "shadow-1", 2: "shadow-2" };
const paddings = { none: "", sm: "p-4", md: "p-4 md:p-6", lg: "p-6 md:p-8" } as const;

/** Card radius for the tone: wells nested in a card use the tile radius. */
export function cardClass({ tone = "white", elevation, padded = true, interactive, className }: Omit<Props, "as"> = {}) {
  const pad = padded === true ? "md" : padded === false ? "none" : padded;
  const elev = elevation ?? (tone === "sunken" ? 0 : 1);
  return cx(
    "min-w-0",
    tone === "sunken" ? "rounded-tile" : "rounded-card",
    tones[tone],
    elevations[elev],
    paddings[pad],
    interactive && "cursor-pointer transition-[box-shadow,border-color,transform] duration-(--duration-base) ease-standard hover:border-border-strong hover:shadow-2",
    className,
  );
}

export function Card({ as: Tag = "div", tone = "white", elevation, padded = true, interactive, className, ...rest }: Props) {
  return <Tag className={cardClass({ tone, elevation, padded, interactive, className })} {...rest} />;
}

/** Section heading inside a card: a title, an optional description and trailing content (actions, meta). */
export function CardHeader({
  title,
  description,
  children,
  id,
  as: H = "h2",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  id?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <H id={id} className="font-display text-h3">{title}</H>
        {description && <p className="mt-0.5 text-small text-text-muted">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2 text-small text-text-muted">{children}</div>}
    </div>
  );
}
