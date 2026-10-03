import { useId } from "react";
import { cx } from "./cx";

type HeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Small uppercase label above the title. */
  eyebrow?: React.ReactNode;
  /** Buttons or links, right-aligned from sm, under the text on phones. */
  actions?: React.ReactNode;
  as?: "h2" | "h3";
  id?: string;
  className?: string;
};

/** The heading row of a page section: title, optional description and actions on one baseline. */
export function SectionHeader({ title, description, eyebrow, actions, as: H = "h2", id, className }: HeaderProps) {
  return (
    <div className={cx("mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <H id={id} className={cx("font-display", H === "h2" ? "text-h2" : "text-h3")}>{title}</H>
        {description && <p className="mt-1 max-w-reading text-sm text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type SectionProps = Omit<HeaderProps, "id" | "className"> & {
  children: React.ReactNode;
  className?: string;
};

/** A labelled page section: <section aria-labelledby> with a SectionHeader. Sections stack with --space-section between them. */
export function Section({ children, className, ...header }: SectionProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={className}>
      <SectionHeader id={id} {...header} />
      {children}
    </section>
  );
}

type PageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  /** The page's main action (one primary at most) and its alternatives. */
  actions?: React.ReactNode;
  /** A back link or breadcrumb, above the title. */
  back?: React.ReactNode;
  /** Status badges or key facts under the description. */
  meta?: React.ReactNode;
  className?: string;
};

/**
 * The header every app page starts with (Fleet, Market, portals, Developers, Deployments): one h1, a one-sentence
 * description, actions aligned to the title block's bottom. Landing-style hero panels are for the home page only.
 */
export function PageHeader({ title, description, eyebrow, actions, back, meta, className }: PageHeaderProps) {
  return (
    <header className={cx("mb-8 flex flex-col gap-5 md:mb-10 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        {back && <div className="mb-3 text-sm">{back}</div>}
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="font-display text-h1">{title}</h1>
        {description && <p className="mt-2 max-w-reading text-body-lg text-text-muted">{description}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
