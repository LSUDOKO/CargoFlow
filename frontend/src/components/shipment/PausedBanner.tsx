/** The guardian's circuit breaker (contracts v3): new risk is stopped, every exit still works. */
export const PAUSE_TEXT = "New facilities are paused by the protocol guardian; settlement, delivery and payouts still work.";

const TEXTS = {
  controller: PAUSE_TEXT,
  coverPool: "New cover offers and acceptances are paused by the protocol guardian; releases, payouts and withdrawals still work.",
  devices: "New device registrations are paused by the protocol guardian; existing devices keep reporting.",
} as const;

export function PausedBanner({ scope = "controller", className = "" }: { scope?: keyof typeof TEXTS; className?: string }) {
  return (
    <div role="status" className={`flex items-start gap-3 rounded-tile border border-alert/50 bg-alert/12 px-4 py-3 text-sm ${className}`}>
      <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" aria-hidden="true">
        <rect x="5" y="4" width="3.2" height="12" rx="1" fill="currentColor" />
        <rect x="11.8" y="4" width="3.2" height="12" rx="1" fill="currentColor" />
      </svg>
      <p><span className="font-semibold">Paused by the guardian.</span> {TEXTS[scope]}</p>
    </div>
  );
}
