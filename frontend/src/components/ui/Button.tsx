import Link from "next/link";
import { cx } from "./cx";
import { Spinner } from "./Spinner";

/**
 * The one button system for the app.
 * - primary: lime, the single main action of a view
 * - secondary: ink outline, the alternative next to it
 * - ghost: text-weight, tertiary actions and row links
 * - inverse: paper outline, secondary actions on navy surfaces
 * - danger: filled red, the confirm step of an irreversible action
 * - danger-outline: red outline, the trigger that opens that confirm step
 * Every variant carries a 2px border (transparent when filled) so heights, text baselines and icon spacing match.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "inverse" | "danger" | "danger-outline";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-signal text-ink hover:bg-signal-2",
  secondary: "border-ink text-ink hover:bg-ink/6",
  ghost: "border-transparent text-ink hover:bg-ink/6",
  inverse: "border-paper/35 text-paper hover:border-paper/70 hover:bg-paper/8",
  danger: "border-transparent bg-danger text-white hover:bg-[#cf3c41]",
  "danger-outline": "border-danger/70 text-[#b4232a] hover:border-danger hover:bg-danger/6",
};
const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-[0.9375rem]",
  lg: "h-12 px-6 text-base",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cx(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border-2 font-semibold whitespace-nowrap select-none",
    "transition-[background-color,border-color,color,transform] duration-150 ease-out active:translate-y-px",
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    variants[variant],
    sizes[size],
    className,
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean };

export function Button({ variant, size, loading, disabled, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

type LinkButtonProps = { href: string; variant?: ButtonVariant; size?: ButtonSize; className?: string; children: React.ReactNode; external?: boolean };

export function LinkButton({ href, variant, size, className, children, external }: LinkButtonProps) {
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={buttonClass(variant, size, className)}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

/** A round icon button that toggles open/closed, drawn as a plus that turns into a cross. */
export function ToggleIcon({ open, className }: { open: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 transition-[transform,background-color,color] duration-200",
        open ? "rotate-45 border-ink bg-ink text-signal" : "border-ink text-ink",
        className,
      )}
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4"><path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
    </span>
  );
}
