import { useId } from "react";
import { cx } from "./cx";

/** The control shell: one height (44px), one radius, one border language for every input, select and textarea. */
export function controlClass({ error, disabled, className }: { error?: boolean; disabled?: boolean; className?: string } = {}) {
  return cx(
    "flex w-full items-center rounded-control border bg-surface shadow-1 transition-[border-color,box-shadow] duration-(--duration-fast) ease-standard",
    error ? "border-danger ring-1 ring-danger" : "border-border-strong hover:border-neutral-400 focus-within:border-ink focus-within:ring-1 focus-within:ring-ink",
    disabled && "cursor-not-allowed bg-mist opacity-70",
    className,
  );
}

type ShellProps = {
  label: string;
  /** Help text under the control; hidden while an error shows. `hint` is the v1 name. */
  help?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  /** Marks the label as optional instead of marking required ones. */
  optional?: boolean;
  /** Visually hide the label (it stays the accessible name). */
  hideLabel?: boolean;
  id?: string;
  className?: string;
  children: (a: { id: string; describedBy: string | undefined; invalid: boolean }) => React.ReactNode;
};

/** Label, control, help and error, wired with htmlFor, aria-describedby and aria-invalid. Render the control in `children`. */
export function FormField({ label, help, hint, error, optional, hideLabel, id, className, children }: ShellProps) {
  const auto = useId();
  const fid = id ?? auto;
  const helpText = help ?? hint;
  const describedBy = [helpText && !error && `${fid}-hint`, error && `${fid}-err`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={fid} className={cx("mb-1.5 flex items-baseline gap-2 text-sm font-semibold", hideLabel && "sr-only")}>
        {label}
        {optional && <span className="text-xs font-normal text-text-muted">Optional</span>}
      </label>
      {children({ id: fid, describedBy, invalid: !!error })}
      {helpText && !error && <p id={`${fid}-hint`} className="mt-1.5 text-small text-text-muted">{helpText}</p>}
      {error && (
        <p id={`${fid}-err`} className="mt-1.5 flex items-start gap-1.5 text-small font-medium text-danger-fg">
          <svg viewBox="0 0 16 16" className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.5" /><path d="M8 4.8v3.6" /><circle cx="8" cy="11" r="0.4" fill="currentColor" /></svg>
          {error}
        </p>
      )}
    </div>
  );
}

type FieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix"> & {
  label: string;
  hint?: React.ReactNode;
  help?: React.ReactNode;
  error?: string | null;
  /** Unit after the value, e.g. "USDG" or "°C". */
  suffix?: string;
  /** Text or icon before the value, e.g. a search glyph. */
  prefix?: React.ReactNode;
  optional?: boolean;
  hideLabel?: boolean;
  /** Classes for the <input> itself (className styles the wrapper), e.g. "font-mono" for an address field. */
  inputClassName?: string;
};

/** A labelled text input with help and inline error. */
export function Field({ label, hint, help, error, suffix, prefix, optional, hideLabel, className, inputClassName, id, disabled, ...rest }: FieldProps) {
  return (
    <FormField label={label} hint={hint} help={help} error={error} optional={optional} hideLabel={hideLabel} id={id} className={className}>
      {({ id: fid, describedBy, invalid }) => (
        <div className={controlClass({ error: invalid, disabled })}>
          {prefix && <span className="flex shrink-0 items-center pl-3.5 text-text-muted">{prefix}</span>}
          <input
            id={fid}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            className={cx("h-11 w-full min-w-0 rounded-control bg-transparent px-3.5 text-body outline-none placeholder:text-neutral-500 disabled:cursor-not-allowed", prefix ? "pl-2" : "", inputClassName)}
            {...rest}
          />
          {suffix && <span className="shrink-0 pr-3.5 text-sm font-semibold text-text-muted">{suffix}</span>}
        </div>
      )}
    </FormField>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  help?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  optional?: boolean;
  hideLabel?: boolean;
};

/** A native select in the control shell (native keeps phone pickers and keyboard behaviour). */
export function Select({ label, help, hint, error, optional, hideLabel, className, id, disabled, children, ...rest }: SelectProps) {
  return (
    <FormField label={label} help={help} hint={hint} error={error} optional={optional} hideLabel={hideLabel} id={id} className={className}>
      {({ id: fid, describedBy, invalid }) => (
        <div className={cx(controlClass({ error: invalid, disabled }), "relative")}>
          <select
            id={fid}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            className="h-11 w-full min-w-0 cursor-pointer appearance-none rounded-control bg-transparent pr-10 pl-3.5 text-body font-medium outline-none disabled:cursor-not-allowed"
            {...rest}
          >
            {children}
          </select>
          <svg viewBox="0 0 16 16" className="pointer-events-none absolute right-3.5 h-4 w-4 text-text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
        </div>
      )}
    </FormField>
  );
}

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  help?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  optional?: boolean;
  hideLabel?: boolean;
};

export function Textarea({ label, help, hint, error, optional, hideLabel, className, id, disabled, rows = 4, ...rest }: TextareaProps) {
  return (
    <FormField label={label} help={help} hint={hint} error={error} optional={optional} hideLabel={hideLabel} id={id} className={className}>
      {({ id: fid, describedBy, invalid }) => (
        <div className={controlClass({ error: invalid, disabled })}>
          <textarea
            id={fid}
            rows={rows}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            className="w-full min-w-0 resize-y rounded-control bg-transparent px-3.5 py-2.5 text-body leading-relaxed outline-none placeholder:text-neutral-500"
            {...rest}
          />
        </div>
      )}
    </FormField>
  );
}
