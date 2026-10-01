import { useId } from "react";
import { cx } from "./cx";

type Props = React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null; suffix?: string };

/** A labelled text input with hint and inline error. */
export function Field({ label, hint, error, suffix, className, id, ...rest }: Props) {
  const auto = useId();
  const fid = id ?? auto;
  const describedBy = [hint && `${fid}-hint`, error && `${fid}-err`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={fid} className="mb-1.5 block text-sm font-semibold">{label}</label>
      <div className={cx("flex items-center rounded-2xl border-2 bg-white transition-colors focus-within:border-ink", error ? "border-danger" : "border-line")}>
        <input id={fid} aria-invalid={!!error || undefined} aria-describedby={describedBy} className="h-12 w-full min-w-0 rounded-2xl bg-transparent px-4 text-[0.98rem] outline-none" {...rest} />
        {suffix && <span className="pr-4 text-sm font-semibold text-slate">{suffix}</span>}
      </div>
      {hint && !error && <p id={`${fid}-hint`} className="mt-1.5 text-sm text-slate">{hint}</p>}
      {error && <p id={`${fid}-err`} className="mt-1.5 text-sm font-medium text-danger">{error}</p>}
    </div>
  );
}
