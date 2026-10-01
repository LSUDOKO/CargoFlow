import Link from "next/link";
import { cx } from "./cx";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "dark" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-signal text-ink hover:bg-signal-2 active:translate-y-px shadow-[inset_0_-2px_0_rgb(11_27_43/0.18)]",
  secondary: "border-2 border-ink text-ink hover:bg-ink hover:text-paper",
  ghost: "text-ink hover:bg-ink/5",
  dark: "bg-ink text-paper hover:bg-ink-2",
  danger: "bg-danger text-white hover:brightness-95",
};
const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-[0.95rem]",
  lg: "h-14 px-7 text-base",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-[background,color,transform,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-55",
    variants[variant],
    sizes[size],
    className,
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean };

export function Button({ variant, size, loading, disabled, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

type LinkButtonProps = { href: string; variant?: Variant; size?: Size; className?: string; children: React.ReactNode; external?: boolean };

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
