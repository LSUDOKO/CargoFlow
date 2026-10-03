"use client";

// The bridge between the wallet UI and the Privy email login, which loads only when NEXT_PUBLIC_PRIVY_APP_ID is set.
// The UI reads this store; components/wallet/privy/PrivyBridge registers the real handlers once Privy is ready.
// Nothing here imports Privy.

import { useSyncExternalStore } from "react";
import { PRIVY_APP_ID } from "@/lib/chain/config";

export type EmbeddedState = { enabled: boolean; ready: boolean; busy: boolean; error: string | null };
type Handlers = { login: () => void; logout: () => Promise<void> };

let state: EmbeddedState = { enabled: !!PRIVY_APP_ID, ready: false, busy: false, error: null };
let handlers: Handlers | null = null;
const subs = new Set<() => void>();
const SERVER: EmbeddedState = { enabled: !!PRIVY_APP_ID, ready: false, busy: false, error: null };

export function setEmbeddedState(patch: Partial<EmbeddedState>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}

export function registerEmbedded(h: Handlers | null) {
  handlers = h;
  setEmbeddedState({ ready: !!h });
}

/** Opens the email login (or reconnects an already logged-in email wallet). */
export function loginWithEmail() {
  if (!handlers) return;
  setEmbeddedState({ busy: true, error: null });
  handlers.login();
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
    () => SERVER,
  );
}
