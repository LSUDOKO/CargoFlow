"use client";

import { useId, useState } from "react";
import { useConnect, useConnectors } from "wagmi";
import { Button } from "@/components/ui/Button";
import { PASSKEY_CONNECTOR_ID } from "@/lib/passkey/env";
import { isPasskeyCancel } from "@/lib/passkey/provider";
import { savePasskey } from "@/lib/passkey/store";

export const PASSKEY_EXPLAINER = "A smart account secured by your device's Face ID, fingerprint or security key. Gas is paid by CargoFlow when sponsorship is on.";

type Busy = "register" | "login" | null;

function passkeyError(err: unknown): string {
  if (isPasskeyCancel(err)) return "The passkey prompt was closed. Nothing was created or shared.";
  const text = err instanceof Error ? err.message : String(err);
  if (/InvalidStateError|already registered/i.test(text)) return "This device already has a CargoFlow passkey. Use “Sign in with an existing passkey”.";
  if (/fetch|network|Failed to fetch/i.test(text)) return "The passkey service could not be reached. Check your connection and try again.";
  return text || "The passkey account could not be opened.";
}

/** Create a passkey account, or sign in with a passkey this device (or its synced keychain) already holds. */
export function PasskeyStep({ onDone }: { onDone: () => void }) {
  const connectors = useConnectors();
  const { connectAsync } = useConnect();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const supported = typeof window !== "undefined" && "PublicKeyCredential" in window;
  const connector = connectors.find((c) => c.id === PASSKEY_CONNECTOR_ID);

  async function go(mode: "register" | "login") {
    if (!connector || busy) return;
    setError(null);
    setBusy(mode);
    try {
      const { obtainPasskey } = await import("@/lib/passkey/kernel");
      const passkey = await obtainPasskey(mode, name.trim() || `CargoFlow ${new Date().toLocaleDateString("en-GB", { dateStyle: "medium" })}`);
      savePasskey(passkey);
      await connectAsync({ connector });
      onDone();
    } catch (err) {
      savePasskey(null);
      setError(passkeyError(err));
    } finally {
      setBusy(null);
    }
  }

  if (!supported) {
    return (
      <div className="rounded-tile border bg-warning-bg ring-1 ring-warning-border ring-inset p-4" role="alert">
        <p className="font-semibold">Passkeys aren&apos;t available in this browser</p>
        <p className="mt-1 text-sm text-ink/75">Use a current Chrome, Safari, Edge or Firefox, or connect a wallet instead.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3 rounded-tile bg-ink p-4 text-paper surface-ink">
        <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-signal" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2.5 5 5.5v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5v-5l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
        <p className="text-sm leading-relaxed text-paper/85">{PASSKEY_EXPLAINER}</p>
      </div>

      <div>
        <label htmlFor={nameId} className="mb-1.5 block text-sm font-semibold">Account name <span className="font-normal text-text-muted">(optional)</span></label>
        <input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 48))}
          placeholder="e.g. Warehouse receiving, Lagos"
          autoComplete="off"
          disabled={busy !== null}
          className="h-12 w-full rounded-control border-2 border-border bg-white px-4 text-base text-ink transition-colors placeholder:text-slate/60 hover:border-ink/30 focus:border-ink focus:outline-none disabled:opacity-60"
        />
        <p className="mt-1.5 text-xs text-text-muted">Shown by your device when it asks for the passkey.</p>
      </div>

      {error && <p role="alert" className="rounded-control bg-danger-bg px-3.5 py-2.5 text-sm font-medium text-danger-fg">{error}</p>}

      <div className="flex flex-col gap-2">
        <Button size="lg" loading={busy === "register"} disabled={busy !== null || !connector} onClick={() => void go("register")}>
          {busy === "register" ? "Follow your device's prompt…" : "Create a passkey account"}
        </Button>
        <Button size="lg" variant="secondary" loading={busy === "login"} disabled={busy !== null || !connector} onClick={() => void go("login")}>
          {busy === "login" ? "Choose your passkey…" : "Sign in with an existing passkey"}
        </Button>
      </div>

      <ul className="space-y-1.5 text-xs leading-relaxed text-text-muted">
        <li>Your passkey never leaves your device. CargoFlow stores only its public key.</li>
        <li>The account is a ZeroDev Kernel smart account on Robinhood Chain Testnet; it is set up on chain with your first action.</li>
      </ul>
    </div>
  );
}
