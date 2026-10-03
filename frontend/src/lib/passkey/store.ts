"use client";

// A small store shared by the passkey connector and the wallet UI: the remembered passkey (only its public parts,
// so a reload reconnects without a prompt) and whether CargoFlow's paymaster is sponsoring gas.
import { useSyncExternalStore } from "react";

/** The public half of a passkey: enough to rebuild the Kernel account. Never a secret. */
export type StoredPasskey = {
  pubX: string; // hex
  pubY: string; // hex
  authenticatorId: string;
  authenticatorIdHash: `0x${string}`;
  name: string;
  address?: `0x${string}`;
};

/** unknown until checked; on when the paymaster sponsors; off when it declines and the account pays its own gas. */
export type Sponsorship = "unknown" | "checking" | "on" | "off";

export type PasskeyState = { sponsorship: Sponsorship; deployed: boolean | null };

const KEY = "cargoflow.passkey";
const initial: PasskeyState = { sponsorship: "unknown", deployed: null };
let state = initial;
const subs = new Set<() => void>();

export function setPasskeyState(patch: Partial<PasskeyState>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}

export function usePasskeyState(): PasskeyState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => initial,
  );
}

export function loadPasskey(): StoredPasskey | null {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredPasskey;
    return v && typeof v.pubX === "string" && typeof v.authenticatorId === "string" ? v : null;
  } catch {
    return null;
  }
}

export function savePasskey(p: StoredPasskey | null) {
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the session still works until the tab closes */
  }
}
