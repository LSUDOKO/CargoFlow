"use client";

// The bridge between the wallet UI and the Privy email login, which loads only when NEXT_PUBLIC_PRIVY_APP_ID is set.
// The UI reads this store; components/wallet/privy/PrivyBridge registers the real handlers once Privy is ready and
// pushes the email flow's progress back here. Nothing here imports Privy.

import { useEffect, useState, useSyncExternalStore } from "react";
import { PRIVY_APP_ID } from "@/lib/chain/config";

/** Where the inline email flow is: entering the address, entering the code, or setting up the wallet. */
export type EmailStep = "idle" | "sending" | "code" | "verifying" | "connecting";

export type EmbeddedState = {
  /** an app id is configured in this build */
  enabled: boolean;
  /** Privy has initialised and the handlers are registered */
  ready: boolean;
  /** Privy failed to start, with the reason; the email option shows this instead of loading forever */
  failure: string | null;
  /** a Privy session already exists in this browser, so no code is needed */
  authenticated: boolean;
  step: EmailStep;
  email: string;
  /** the last error of the email flow, shown inline */
  error: string | null;
  /** bumped by retryEmailInit(): the bridge remounts Privy with it as its key */
  attempt: number;
  /** when the current initialisation attempt began (ms since page load) */
  startedAt: number;
};

type Handlers = {
  sendCode: (email: string) => Promise<void>;
  verify: (code: string) => Promise<void>;
  resume: () => Promise<void>;
  logout: () => Promise<void>;
};

/** How long Privy may take to initialise before the option says it is unavailable (it still recovers if it loads later). */
export const EMAIL_READY_TIMEOUT_MS = 8_000;

const initial: EmbeddedState = {
  enabled: !!PRIVY_APP_ID,
  ready: false,
  failure: null,
  authenticated: false,
  step: "idle",
  email: "",
  error: null,
  attempt: 0,
  startedAt: 0,
};
let state: EmbeddedState = { ...initial, startedAt: typeof performance !== "undefined" ? performance.now() : 0 };
let handlers: Handlers | null = null;
const subs = new Set<() => void>();

export function setEmbeddedState(patch: Partial<EmbeddedState>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}

export function registerEmbedded(h: Handlers | null) {
  handlers = h;
  setEmbeddedState(h ? { ready: true, failure: null } : { ready: false });
}

/** Sends a one-time code to the address (step → "code"). */
export function sendEmailCode(email: string) {
  void handlers?.sendCode(email.trim());
}

/** Checks the code; on success the bridge creates or connects the embedded wallet (step → "connecting"). */
export function verifyEmailCode(code: string) {
  void handlers?.verify(code);
}

/** Reconnects an already logged-in email wallet without a code. */
export function resumeEmail() {
  void handlers?.resume();
}

/** Back to the address entry, clearing any error. */
export function resetEmailFlow() {
  setEmbeddedState({ step: "idle", error: null });
}

/** Restarts Privy after a failure or a timeout. */
export function retryEmailInit() {
  setEmbeddedState({ failure: null, ready: false, attempt: state.attempt + 1, startedAt: performance.now() });
}

/** Ends the Privy session too, so a disconnected email wallet does not silently reconnect. */
export async function logoutEmail() {
  await handlers?.logout().catch(() => {});
}

export function useEmbedded(): EmbeddedState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => initial,
  );
}

export type EmailAvailability = { status: "off" } | { status: "loading" } | { status: "ready" } | { status: "unavailable"; reason: string };

/**
 * What the email option can honestly say right now: loading for up to EMAIL_READY_TIMEOUT_MS, then unavailable with
 * a reason. A late initialisation still flips it to ready.
 */
export function useEmailAvailability(): EmailAvailability {
  const s = useEmbedded();
  const [expired, setExpired] = useState<number | null>(null); // the attempt whose deadline has passed
  const waiting = s.enabled && !s.ready && !s.failure;
  useEffect(() => {
    if (!waiting) return;
    const left = Math.max(0, s.startedAt + EMAIL_READY_TIMEOUT_MS - performance.now());
    const t = setTimeout(() => setExpired(s.attempt), left + 50);
    return () => clearTimeout(t);
  }, [waiting, s.startedAt, s.attempt]);
  if (!s.enabled) return { status: "off" };
  if (s.ready) return { status: "ready" };
  if (s.failure) return { status: "unavailable", reason: s.failure };
  if (expired === s.attempt) {
    return { status: "unavailable", reason: "The sign-in service (Privy) has not responded. A slow connection or a privacy blocker can stop it loading." };
  }
  return { status: "loading" };
}
