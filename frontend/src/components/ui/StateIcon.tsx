export type StateIconKind = "success" | "warning" | "danger" | "info" | "pending" | "active" | "held";

/**
 * The state glyphs shared by Banner, Toast, Timeline and Stepper, drawn on one 16px grid at a 1.6 stroke.
 * Shape carries the meaning as well as colour, so the states read without colour vision.
 */
export function StateIcon({ kind, className = "h-4 w-4" }: { kind: StateIconKind; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "success" && (
        <>
          <circle cx="8" cy="8" r="6.5" />
          <path d="m5.2 8.2 1.9 1.9 3.7-4" />
        </>
      )}
      {kind === "warning" && (
        <>
          <path d="M7.1 2.6a1 1 0 0 1 1.8 0l5.4 9.9a1 1 0 0 1-.9 1.5H2.6a1 1 0 0 1-.9-1.5z" />
          <path d="M8 6.3v3" />
          <circle cx="8" cy="11.4" r="0.5" fill="currentColor" stroke="none" />
        </>
      )}
      {kind === "danger" && (
        <>
          <circle cx="8" cy="8" r="6.5" />
          <path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4" />
        </>
      )}
      {kind === "info" && (
        <>
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 7.3v3.6" />
          <circle cx="8" cy="5.1" r="0.5" fill="currentColor" stroke="none" />
        </>
      )}
      {kind === "pending" && <circle cx="8" cy="8" r="6.5" strokeDasharray="2.4 2.2" />}
      {kind === "active" && (
        <>
          <circle cx="8" cy="8" r="6.5" />
          <circle cx="8" cy="8" r="2.6" fill="currentColor" stroke="none" />
        </>
      )}
      {kind === "held" && (
        <>
          <circle cx="8" cy="8" r="6.5" />
          <path d="M6.4 5.6v4.8M9.6 5.6v4.8" />
        </>
      )}
    </svg>
  );
}
