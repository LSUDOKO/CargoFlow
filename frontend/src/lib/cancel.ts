// Facility cancellation (contracts v3, FinancingController.cancelFacility). A facility that never started transit can
// be closed by the exporter or the financier: while CREATED at any time, while FINANCED only once CANCEL_TIMEOUT has
// passed since the deposit. The vault returns the whole deposit to the financier and a bound bill of lading goes back
// to the exporter. Pure helpers so the button, the countdown and the tests share one definition.

/** The contract's CANCEL_TIMEOUT (14 days) when the chain read is not available yet. */
export const DEFAULT_CANCEL_TIMEOUT_SEC = 14 * 86_400;

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export type CancelState =
  /** not shown at all: not a party, or the facility is past the point where it can be cancelled */
  | { kind: "hidden" }
  /** may cancel now */
  | { kind: "ready"; refundsDeposit: boolean }
  /** FINANCED and the timeout has not passed yet; `remainingSec` until it may */
  | { kind: "waiting"; remainingSec: number; availableAt: number };

export type CancelInput = {
  status: string | undefined;
  exporter: string | undefined;
  financier: string | undefined;
  address: string | undefined;
  /** unix seconds of the deposit (FinancingController.financedAt), 0 or undefined when unknown */
  financedAt: number | bigint | undefined;
  /** CANCEL_TIMEOUT in seconds */
  timeoutSec?: number | bigint;
  /** unix seconds now */
  nowSec: number;
};

/** Whether `address` may cancel the facility now, must wait, or has no cancel action at all. */
export function cancelState(i: CancelInput): CancelState {
  if (!i.address || !(same(i.address, i.exporter) || same(i.address, i.financier))) return { kind: "hidden" };
  if (i.status === "CREATED") return { kind: "ready", refundsDeposit: false };
  if (i.status !== "FINANCED") return { kind: "hidden" };
  const financedAt = Number(i.financedAt ?? 0);
  const timeout = Number(i.timeoutSec ?? DEFAULT_CANCEL_TIMEOUT_SEC);
  // the deposit time is unknown (a backend-only view, or the read failed): offer it and let the contract decide
  if (!financedAt) return { kind: "ready", refundsDeposit: true };
  const availableAt = financedAt + timeout;
  if (i.nowSec >= availableAt) return { kind: "ready", refundsDeposit: true };
  return { kind: "waiting", remainingSec: availableAt - i.nowSec, availableAt };
}

/** "13 d 4 h", "5 h 12 min", "42 min", "under a minute" */
export function countdownText(sec: number): string {
  if (sec < 60) return "under a minute";
  const d = Math.floor(sec / 86_400), h = Math.floor((sec % 86_400) / 3_600), m = Math.floor((sec % 3_600) / 60);
  if (d > 0) return h ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}
