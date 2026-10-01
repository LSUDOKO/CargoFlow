type Props = { variant?: "full" | "mark"; className?: string; tone?: "ink" | "paper" };

/** The CargoFlow mark: a container whose middle ribs interlock as a chain link. Inline SVG for crisp colour. */
export function Logo({ variant = "full", className, tone = "ink" }: Props) {
  const word = tone === "ink" ? "#0B1B2B" : "#F7F9F4";
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <svg viewBox="0 0 64 64" className="h-8 w-8 shrink-0" aria-hidden="true">
        <rect width="64" height="64" rx="16" fill="#0B1B2B" />
        <rect x="11" y="17" width="42" height="30" rx="4" fill="#13293D" stroke="#C6F432" strokeWidth="2.5" />
        <path d="M19 22v20M45 22v20" stroke="#5B6B7B" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="23.5" y="23" width="10" height="18" rx="5" fill="none" stroke="#C6F432" strokeWidth="3" />
        <rect x="30.5" y="23" width="10" height="18" rx="5" fill="none" stroke="#C6F432" strokeWidth="3" />
      </svg>
      {variant === "full" && (
        <span className="font-display text-[1.35rem] font-bold tracking-[-0.03em]" style={{ color: word }}>
          CargoFlow
        </span>
      )}
      {variant === "mark" && <span className="sr-only">CargoFlow</span>}
    </span>
  );
}
