"use client";

import { useConnect, useConnectors } from "wagmi";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { EMBEDDED_CONNECTOR_ID } from "@/lib/chain/config";
import { decodeRevert } from "@/lib/chain/errors";
import { loginWithEmail, useEmbedded } from "./embedded";

const blurb: Record<string, string> = {
  injected: "MetaMask, Rabby, Coinbase Wallet or any browser wallet",
  walletConnect: "Scan a QR code with a mobile wallet",
};

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const connectors = useConnectors();
  const { connect, isPending, variables, error, reset } = useConnect();
  const seen = new Set<string>();
  const email = useEmbedded();
  // the email wallet's connector is driven by the email option below, not listed as a wallet of its own
  const list = connectors.filter((c) => c.id !== EMBEDDED_CONNECTOR_ID && (seen.has(c.id) ? false : (seen.add(c.id), true)));
  // the header renders this inside its navy bar: reset the inherited paper text colour
  return (
    <div className="surface-light text-ink">
      <Modal open={open} onClose={() => { reset(); onClose(); }} title="Connect a wallet" description="CargoFlow never holds your keys. Every transaction is signed in your wallet.">
        {email.enabled && (
          <>
            <button
              type="button"
              onClick={() => {
                loginWithEmail();
                onClose(); // the email login opens its own dialog
              }}
              disabled={!email.ready || email.busy}
              className="flex w-full items-center gap-4 rounded-2xl border-2 border-ink bg-white px-4 py-3.5 text-left transition-colors hover:bg-ink/4 disabled:opacity-60"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-signal text-ink" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="h-5 w-5"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
              </span>
              <span className="flex-1">
                <span className="block font-semibold">Continue with email</span>
                <span className="block text-sm text-slate">No extension needed: a wallet is created for your email</span>
              </span>
              {(!email.ready || email.busy) && <Spinner />}
            </button>
            {email.error && <p className="mt-2 text-sm font-medium text-danger">{email.error}</p>}
            <p className="my-4 flex items-center gap-3 text-xs font-semibold tracking-wide text-slate uppercase">
              <span className="h-px flex-1 bg-line" aria-hidden="true" />or use a wallet<span className="h-px flex-1 bg-line" aria-hidden="true" />
            </p>
          </>
        )}
        <ul className="flex flex-col gap-2">
          {list.map((c) => {
            const busy = isPending && variables?.connector && "id" in variables.connector && variables.connector.id === c.id;
            return (
              <li key={c.uid}>
                <button
                  type="button"
                  onClick={() => connect({ connector: c }, { onSuccess: onClose })}
                  disabled={isPending}
                  className="flex w-full items-center gap-4 rounded-2xl border-2 border-line bg-white px-4 py-3.5 text-left transition-colors hover:border-ink disabled:opacity-60"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink font-display text-lg font-bold text-signal" aria-hidden="true">
                    {c.name.slice(0, 1)}
                  </span>
                  <span className="flex-1">
                    <span className="block font-semibold">{c.name === "Injected" ? "Browser wallet" : c.name}</span>
                    <span className="block text-sm text-slate">{blurb[c.type] ?? blurb[c.id] ?? "Test account on the local chain"}</span>
                  </span>
                  {busy && <Spinner />}
                </button>
              </li>
            );
          })}
        </ul>
        {error && <p className="mt-4 rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger">{decodeRevert(error)}</p>}
        {!process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID && (
          <p className="mt-4 text-xs text-slate">WalletConnect is off in this build (no project id set).</p>
        )}
      </Modal>
    </div>
  );
}
