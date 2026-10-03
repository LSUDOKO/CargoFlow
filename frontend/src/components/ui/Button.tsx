import Link from "next/link";
import { forwardRef } from "react";
import { cx } from "./cx";
import { Spinner } from "./Spinner";

/**
 * The one button system for the app.
 * - primary: lime, the single main action of a view (at most one per view)
 * - ink: filled navy, the main action where lime would compete (a lime hero, a toolbar of filters)
 * - secondary: ink outline, the alternative next to the primary
 * - ghost: text-weight, tertiary actions and row links
 * - inverse: paper outline, secondary actions on navy surfaces
 * - danger: filled red, the confirm step of an irreversible action
 * - danger-outline: red outline, the trigger that opens that confirm step
 * Every variant carries a 2px border (transparent when filled) so heights, text baselines and icon spacing match.
 * Sizes: xs 28px (inline in tables), sm 36px, md 44px (default, meets the 44px touch target), lg 48px.
 */
export type ButtonVariant = "primary" | "ink" | "secondary" | "ghost" | "inverse" | "danger" | "danger-outline";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-signal text-ink hover:bg-signal-2",
  ink: "border-transparent bg-ink text-paper hover:bg-ink-700",
  secondary: "border-ink text-ink hover:bg-ink/6",
  ghost: "border-transparent text-ink hover:bg-ink/6",
  inverse: "border-paper/35 text-paper hover:border-paper/70 hover:bg-paper/8",
  danger: "border-transparent bg-danger-solid text-white hover:bg-danger-fg",
  "danger-outline": "border-danger/70 text-danger-fg hover:border-danger hover:bg-danger-bg",
};
const sizes: Record<ButtonSize, string> = {
  xs: "h-7 gap-1.5 px-3 text-xs",
  sm: "h-9 gap-2 px-4 text-sm",
  md: "h-11 gap-2 px-5 text-body",
  lg: "h-12 gap-2 px-6 text-base",
};
const iconSizes: Record<ButtonSize, string> = { xs: "h-7 w-7", sm: "h-9 w-9", md: "h-11 w-11", lg: "h-12 w-12" };

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string, iconOnly = false) {
  return cx(
    "relative inline-flex shrink-0 items-center justify-center rounded-full border-2 font-semibold whitespace-nowrap select-none",
    "transition-[background-color,border-color,color,transform] duration-(--duration-fast) ease-standard active:translate-y-px",
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    variants[variant],
    iconOnly ? cx(iconSizes[size], "p-0") : sizes[size],
    className,
  );
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button and sets aria-busy. The label stays so the width does not jump. */
  loading?: boolean;
  /** Optional text that replaces the label while loading, e.g. "Signing…". */
  loadingText?: string;
  /** Icon before the label (decorative; give it aria-hidden). */
  icon?: React.ReactNode;
  /** Icon after the label, e.g. an arrow. */
  iconEnd?: React.ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, loading, loadingText, icon, iconEnd, disabled, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner className={size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4"} /> : icon}
      {loading && loadingText ? loadingText : children}
      {!loading && iconEnd}
    </button>
  );
});

type IconButtonProps = Omit<ButtonProps, "icon" | "iconEnd" | "loadingText" | "children"> & {
  /** Required: the accessible name, also shown as the native tooltip. */
  label: string;
  children: React.ReactNode;
};

/** A round button holding only an icon. `label` is its accessible name. Defaults to the ghost variant. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "ghost", size = "md", loading, disabled, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={buttonClass(variant, size, className, true)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
});

type LinkButtonProps = {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: React.ReactNode;
  external?: boolean;
  icon?: React.ReactNode;
  iconEnd?: React.ReactNode;
};

export function LinkButton({ href, variant, size, className, children, external, icon, iconEnd }: LinkButtonProps) {
  const inner = (
    <>
      {icon}
      {children}
      {iconEnd}
    </>
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={buttonClass(variant, size, className)}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {inner}
    </Link>
  );
}

/** The open/closed marker of a disclosure row (Accordion): a 32px sunken disc whose plus turns into a cross. Decorative. */
export function ToggleIcon({ open, className }: { open: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-[transform,background-color,color] duration-(--duration-base) ease-standard",
        open ? "rotate-45 bg-ink text-signal" : "bg-surface-sunken text-ink group-hover:bg-neutral-150",
        className,
      )}
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
    </span>
  );
}
