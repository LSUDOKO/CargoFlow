"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useConnect, useConnectors, type Connector } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Portal } from "@/components/ui/Portal";
import { Spinner } from "@/components/ui/Spinner";
import { useDialog } from "@/components/ui/useDialog";
import { EMBEDDED_CONNECTOR_ID, wagmiConfig } from "@/lib/chain/config";
import { PASSKEYS_ENABLED, PASSKEY_CONNECTOR_ID } from "@/lib/passkey/env";
import { loadPasskey } from "@/lib/passkey/store";
import {
  resetEmailFlow,
  resumeEmail,
  retryEmailInit,
  sendEmailCode,
  useEmailAvailability,
  useEmbedded,
  verifyEmailCode,
} from "./embedded";
import { AnnouncedIcon, GenericWalletIcon, MailIcon, PasskeyIcon, PuzzleIcon, TestAccountIcon, WalletConnectIcon } from "./icons";
import { PASSKEY_EXPLAINER, PasskeyStep } from "./PasskeyStep";
import { orderWallets, type WalletOption } from "./walletList";
import { connectError } from "./walletErrors";

type RowState = { key: string; status: "connecting" } | { key: string; status: "error"; message: string };

/** Reads the last connector wagmi connected with (it persists the id in its storage). */
function useRecentConnector(open: boolean) {
  const [recent, setRecent] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void Promise.resolve(wagmiConfig.storage?.getItem("recentConnectorId")).then((id) => {
      if (live) setRecent(typeof id === "string" ? id : null);
    });
    return () => {
      live = false;
    };
  }, [open]);
  return recent;
}

function describe(c: Connector): WalletOption {
  if (c.type === "walletConnect") return { key: c.uid, connector: c, group: "more", name: "WalletConnect", hint: "Scan a QR code with a mobile wallet", icon: <WalletConnectIcon />, verb: "Opening WalletConnect…", waiting: "Scan the QR code with your phone" };
  if (c.type === "mock") return { key: c.uid, connector: c, group: "test", name: c.name, hint: "Local test account", icon: <TestAccountIcon />, verb: `Connecting ${c.name}…`, waiting: "Connecting to the local chain" };
  const announced = c.id !== "injected" && !!c.icon;
  return {
    key: c.uid,
    connector: c,
    group: "installed",
    name: c.id === "injected" ? "Browser wallet" : c.name,
    hint: announced ? "Installed in this browser" : "The wallet extension in this browser",
    icon: announced ? <AnnouncedIcon src={c.icon!} /> : <GenericWalletIcon />,
    verb: `Opening ${c.id === "injected" ? "your wallet" : c.name}…`,
    waiting: `Approve the connection in ${c.id === "injected" ? "your wallet" : c.name}`,
  };
}

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const connectors = useConnectors();
  const { connectAsync } = useConnect();
  const embedded = useEmbedded();
  const availability = useEmailAvailability();
  const recent = useRecentConnector(open);
  const [view, setView] = useState<"list" | "email" | "passkey">("list");
  const [row, setRow] = useState<RowState | null>(null);
  const attempt = useRef(0);

  const close = () => {
    attempt.current++;
    setRow(null);
    setView("list");
    if (embedded.step !== "connecting") resetEmailFlow();
    onClose();
  };
  const ref = useDialog(open, close);
  const titleId = useId();
  const descId = useId();
  if (!open) return null;

  const hasLegacyInjected = typeof window !== "undefined" && !!(window as { ethereum?: unknown }).ethereum;
  const options = orderWallets(
    connectors.filter((c) => c.id !== EMBEDDED_CONNECTOR_ID && c.id !== PASSKEY_CONNECTOR_ID).map(describe),
    { recent, hasLegacyInjected },
  );
  const installed = options.filter((o) => o.group === "installed");
  const more = options.filter((o) => o.group === "more");
  const tests = options.filter((o) => o.group === "test");

  async function choose(o: WalletOption) {
    const mine = ++attempt.current;
    setRow({ key: o.key, status: "connecting" });
    try {
      await connectAsync({ connector: o.connector });
      if (mine !== attempt.current) return;
      setRow(null);
      onClose();
    } catch (e) {
      if (mine !== attempt.current) return;
      if ((e as { name?: string })?.name === "ConnectorAlreadyConnectedError") return onClose();
      setRow({ key: o.key, status: "error", message: connectError(e, o.name === "Browser wallet" ? "your wallet" : o.name).message });
    }
  }

  function openEmail() {
    attempt.current++;
    setRow(null);
    if (availability.status === "ready" && embedded.authenticated) resumeEmail();
    setView("email");
  }

  // Arrow keys move between wallet rows (Tab still works as usual)
  function onKeyDown(e: React.KeyboardEvent) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const rows = Array.from(ref.current?.querySelectorAll<HTMLElement>("[data-wallet-row]:not(:disabled)") ?? []);
    if (!rows.length) return;
    e.preventDefault();
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : e.key === "ArrowDown" ? (i + 1) % rows.length : (i - 1 + rows.length) % rows.length;
    rows[next]?.focus();
  }

  function openPasskey() {
    attempt.current++;
    setRow(null);
    setView("passkey");
  }

  const emailRecent = recent === EMBEDDED_CONNECTOR_ID;
  const passkeyRecent = recent === PASSKEY_CONNECTOR_ID;
  // the first row takes initial focus
  const firstKey = installed[0]?.key ?? (availability.status !== "off" ? "email" : PASSKEYS_ENABLED ? "passkey" : (more[0]?.key ?? tests[0]?.key));

  return (
    <Portal>
      <div className="fixed inset-0 z-(--z-overlay) flex items-end justify-center sm:items-center sm:p-6">
        <div className="absolute inset-0 animate-fade bg-ink/45 backdrop-blur-[2px]" onClick={close} aria-hidden="true" />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          onKeyDown={onKeyDown}
          className="relative flex max-h-[92dvh] w-full animate-sheet-up flex-col overflow-hidden rounded-t-sheet bg-paper shadow-3 sm:max-h-[min(88dvh,760px)] sm:max-w-[26.25rem] sm:animate-enter sm:rounded-sheet"
        >
          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-ink/15 sm:hidden" aria-hidden="true" />
          <header className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-1 sm:px-6 sm:pt-6">
            {view !== "list" && (
              <button
                type="button"
                onClick={() => {
                  if (view === "email" && embedded.step !== "connecting") resetEmailFlow();
                  setView("list");
                }}
                className="-ml-2 grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-ink/6"
                aria-label="Back to all options"
              >
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" /></svg>
              </button>
            )}
            <div className="min-w-0 flex-1 pt-1">
              <h2 id={titleId} className="font-display text-h2">
                {view === "email" ? "Continue with email" : view === "passkey" ? "Continue with passkey" : "Connect a wallet"}
              </h2>
              <p id={descId} className="mt-1 text-small text-text-muted">
                {view === "email"
                  ? "A wallet is created for your email the first time you sign in."
                  : view === "passkey"
                    ? "No extension, no seed phrase: your device's passkey signs."
                    : "CargoFlow never holds your keys. You approve every step in your wallet."}
              </p>
            </div>
            <button type="button" onClick={close} className="-mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-ink/6" aria-label="Close">
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5 sm:px-6">
            {view === "email" ? (
              <EmailStep onUseWallet={() => setView("list")} />
            ) : view === "passkey" ? (
              <PasskeyStep onDone={onClose} />
            ) : (
              <>
                {installed.length > 0 ? (
                  <Section title="Installed">
                    {installed.map((o) => (
                      <Row key={o.key} option={o} state={row?.key === o.key ? row : null} recent={o.recent} onClick={() => choose(o)} autoFocus={firstKey === o.key} />
                    ))}
                  </Section>
                ) : (
                  <Section title="Browser wallet">
                    <NoWalletRow />
                  </Section>
                )}

                {(availability.status !== "off" || more.length > 0 || PASSKEYS_ENABLED) && (
                  <Section title="More options">
                    {PASSKEYS_ENABLED && <PasskeyRow recent={passkeyRecent} onClick={openPasskey} autoFocus={firstKey === "passkey"} />}
                    {availability.status !== "off" && (
                      <EmailRow availability={availability} authenticated={embedded.authenticated} recent={emailRecent} onClick={openEmail} autoFocus={firstKey === "email"} />
                    )}
                    {more.map((o) => (
                      <Row key={o.key} option={o} state={row?.key === o.key ? row : null} recent={o.recent} onClick={() => choose(o)} autoFocus={firstKey === o.key} />
                    ))}
                  </Section>
                )}

                {tests.length > 0 && (
                  <Section title="Test accounts · local chain">
                    {tests.map((o) => (
                      <Row key={o.key} option={o} state={row?.key === o.key ? row : null} recent={o.recent} onClick={() => choose(o)} autoFocus={firstKey === o.key} />
                    ))}
                  </Section>
                )}

                <details className="group mt-5 rounded-tile border border-border bg-neutral-25 px-4 py-3 text-sm open:bg-surface">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold [&::-webkit-details-marker]:hidden">
                    What is a wallet?
                    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-text-muted transition-transform duration-(--duration-base) group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
                  </summary>
                  <div className="mt-2 space-y-2 text-text-muted">
                    <p>A wallet is an app that holds your account&apos;s keys and signs on your behalf. CargoFlow never sees those keys: every financing step is a transaction you review and approve.</p>
                    <p>New to this? <span className="font-semibold text-ink">Continue with email</span> and a wallet is created for you, no extension needed.</p>
                    {PASSKEYS_ENABLED && <p><span className="font-semibold text-ink">Passkey account:</span> {PASSKEY_EXPLAINER}</p>}
                  </div>
                </details>
              </>
            )}
          </div>

          <footer className="shrink-0 border-t border-border bg-surface px-5 pt-3 pb-[max(env(safe-area-inset-bottom),0.875rem)] text-caption text-text-muted sm:px-6 sm:pb-4">
            By connecting you agree to use CargoFlow as a demo. It runs on a testnet only: no real funds, and test tokens have no value.
          </footer>
        </div>
      </div>
    </Portal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="eyebrow mb-2">{title}</h3>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

const rowClass =
  "group flex min-h-16 w-full items-center gap-3.5 rounded-tile border bg-surface px-3.5 py-2.5 text-left shadow-1 transition-[border-color,box-shadow,background-color,transform] duration-(--duration-fast) ease-standard hover:border-border-strong hover:shadow-2 active:translate-y-px focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-60";

function RecentBadge() {
  return <span className="shrink-0 rounded-full bg-signal-soft px-2 py-0.5 text-caption font-semibold text-signal-fg ring-1 ring-signal-2/60 ring-inset">Recent</span>;
}

function Chevron() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-neutral-400 transition-transform duration-(--duration-fast) group-hover:translate-x-0.5 group-hover:text-ink" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7.5 4.5 5.5 5.5-5.5 5.5" /></svg>
  );
}

function Row({ option, state, recent, onClick, autoFocus }: { option: WalletOption; state: RowState | null; recent?: boolean; onClick: () => void; autoFocus?: boolean }) {
  const connecting = state?.status === "connecting";
  const failed = state?.status === "error" ? state.message : null;
  return (
    <li>
      <button
        type="button"
        data-wallet-row
        data-autofocus={autoFocus || undefined}
        onClick={onClick}
        aria-busy={connecting || undefined}
        className={`${rowClass} ${failed ? "border-danger-border" : connecting ? "border-ink" : "border-border"}`}
      >
        {option.icon}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[0.9375rem] font-semibold">{connecting ? option.verb : option.name}</span>
            {recent && !connecting && !failed && <RecentBadge />}
          </span>
          <span className={`mt-0.5 block text-small ${failed ? "font-medium text-danger-fg" : "text-text-muted"}`} role={failed ? "alert" : undefined}>
            {failed ?? (connecting ? option.waiting : option.hint)}
          </span>
        </span>
        {connecting ? <Spinner className="h-5 w-5 shrink-0" /> : failed ? <span className="shrink-0 rounded-full border-2 border-ink px-3 py-1 text-xs font-semibold">Try again</span> : <Chevron />}
      </button>
    </li>
  );
}

function EmailRow({ availability, authenticated, recent, onClick, autoFocus }: { availability: ReturnType<typeof useEmailAvailability>; authenticated: boolean; recent: boolean; onClick: () => void; autoFocus?: boolean }) {
  const unavailable = availability.status === "unavailable";
  const loading = availability.status === "loading";
  return (
    <li>
      <button type="button" data-wallet-row data-autofocus={autoFocus || undefined} onClick={onClick} className={`${rowClass} border-border`}>
        <MailIcon />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[0.9375rem] font-semibold">Continue with email</span>
            {recent && !unavailable && <RecentBadge />}
          </span>
          <span className={`mt-0.5 block text-small ${unavailable ? "font-medium text-warning-fg" : "text-text-muted"}`}>
            {unavailable
              ? "Email login unavailable right now"
              : loading
                ? "Preparing secure sign-in…"
                : authenticated
                  ? "Signed in before: continue without a code"
                  : "No extension needed. We set up a wallet for you."}
          </span>
        </span>
        {loading ? <Spinner className="h-4 w-4 shrink-0 text-text-muted" /> : <Chevron />}
      </button>
    </li>
  );
}

function PasskeyRow({ recent, onClick, autoFocus }: { recent: boolean; onClick: () => void; autoFocus?: boolean }) {
  // a passkey remembered on this device reconnects without the passkey server; say so
  const known = typeof window !== "undefined" && !!loadPasskey();
  return (
    <li>
      <button type="button" data-wallet-row data-autofocus={autoFocus || undefined} onClick={onClick} className={`${rowClass} border-border`}>
        <PasskeyIcon />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[0.9375rem] font-semibold">Continue with passkey</span>
            {recent && <RecentBadge />}
          </span>
          <span className="mt-0.5 block text-small text-text-muted">
            {known ? "Use the passkey account on this device" : "Face ID, fingerprint or security key. Gas paid by CargoFlow."}
          </span>
        </span>
        <Chevron />
      </button>
    </li>
  );
}

function NoWalletRow() {
  return (
    <li className="flex items-start gap-3.5 rounded-tile border border-dashed border-border-strong bg-neutral-25 px-3.5 py-3">
      <PuzzleIcon />
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] font-semibold">No browser wallet found</p>
        <p className="mt-0.5 text-small text-text-muted">Install one, then reload this page. Or continue with email below.</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {[
            { name: "Get MetaMask", href: "https://metamask.io/download/" },
            { name: "Get Rabby", href: "https://rabby.io/" },
          ].map((l) => (
            <a
              key={l.name}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border-2 border-ink/80 px-3 py-1 text-xs font-semibold hover:bg-ink hover:text-paper"
            >
              {l.name}
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3.5h6.5V10M12.5 3.5 4 12" /></svg>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ))}
        </div>
      </div>
    </li>
  );
}

const inputClass =
  "h-12 w-full rounded-control border border-border-strong bg-surface px-4 text-base text-ink shadow-1 transition-[border-color,box-shadow] duration-(--duration-fast) placeholder:text-neutral-500 hover:border-neutral-400 focus:border-ink focus:ring-1 focus:ring-ink focus:outline-none disabled:opacity-60";

function EmailStep({ onUseWallet }: { onUseWallet: () => void }) {
  const s = useEmbedded();
  const availability = useEmailAvailability();
  const [email, setEmail] = useState(s.email);
  const [code, setCode] = useState("");
  const emailId = useId();
  const codeId = useId();
  const ready = availability.status === "ready";

  if (availability.status === "unavailable") {
    return (
      <div className="rounded-tile bg-warning-bg p-4 ring-1 ring-warning-border ring-inset" role="alert">
        <p className="font-semibold">Email login unavailable right now</p>
        <p className="mt-1 text-sm text-ink/75">{availability.reason}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={retryEmailInit}>Try again</Button>
          <Button size="sm" variant="ghost" onClick={onUseWallet}>Use a wallet instead</Button>
        </div>
      </div>
    );
  }

  if (s.step === "connecting") {
    return (
      <div className="flex flex-col items-center px-4 py-8 text-center" role="status">
        <span className="grid h-14 w-14 place-items-center rounded-tile bg-signal-soft text-signal-fg"><Spinner className="h-6 w-6" /></span>
        <p className="mt-4 font-semibold">Setting up your wallet…</p>
        <p className="mt-1 text-small text-text-muted">This takes a few seconds the first time.</p>
      </div>
    );
  }

  if (s.step === "code" || s.step === "verifying") {
    const submit = (value: string) => {
      if (value.length === 6 && s.step !== "verifying") verifyEmailCode(value);
    };
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(code);
        }}
      >
        <p className="text-sm text-text-muted">
          We sent a 6-digit code to <span className="font-semibold break-all text-ink">{s.email}</span>. It expires in a few minutes.
        </p>
        <label htmlFor={codeId} className="mt-4 mb-1.5 block text-sm font-semibold">Verification code</label>
        <input
          id={codeId}
          autoFocus
          value={code}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(v);
            submit(v);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          placeholder="000000"
          aria-invalid={!!s.error || undefined}
          aria-describedby={s.error ? `${codeId}-err` : undefined}
          disabled={s.step === "verifying"}
          className={`${inputClass} text-center font-mono text-2xl tracking-[0.5em] ${s.error ? "border-danger ring-1 ring-danger" : ""}`}
        />
        {s.error && <p id={`${codeId}-err`} className="mt-2 text-small font-medium text-danger-fg">{s.error}</p>}
        <Button type="submit" size="lg" className="mt-4 w-full" loading={s.step === "verifying"} disabled={code.length !== 6}>
          {s.step === "verifying" ? "Checking code…" : "Verify and continue"}
        </Button>
        <div className="mt-3 flex items-center justify-between text-sm">
          <button type="button" className="rounded-md font-semibold text-text-muted underline-offset-4 hover:text-ink hover:underline" onClick={resetEmailFlow}>
            Use a different email
          </button>
          <button
            type="button"
            className="rounded-md font-semibold underline-offset-4 hover:underline"
            onClick={() => {
              setCode("");
              sendEmailCode(s.email);
            }}
          >
            Resend code
          </button>
        </div>
      </form>
    );
  }

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && ready) sendEmailCode(email);
      }}
    >
      <label htmlFor={emailId} className="mb-1.5 block text-sm font-semibold">Email address</label>
      <input
        id={emailId}
        autoFocus
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        placeholder="you@company.com"
        aria-invalid={!!s.error || undefined}
        aria-describedby={s.error ? `${emailId}-err` : undefined}
        disabled={s.step === "sending"}
        className={`${inputClass} ${s.error ? "border-danger ring-1 ring-danger" : ""}`}
      />
      {s.error && <p id={`${emailId}-err`} className="mt-2 text-small font-medium text-danger-fg">{s.error}</p>}
      <Button type="submit" size="lg" className="mt-4 w-full" loading={s.step === "sending" || !ready} disabled={!valid}>
        {!ready ? "Preparing secure sign-in…" : s.step === "sending" ? "Sending code…" : "Send code"}
      </Button>
      <p className="mt-4 flex gap-2.5 rounded-tile bg-surface-sunken px-3.5 py-3 text-caption text-text-muted">
        <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 2.5 4 5v4.5c0 3.6 2.6 6.9 6 8 3.4-1.1 6-4.4 6-8V5l-6-2.5Z" /><path d="m7.5 10 1.8 1.8L12.8 8" /></svg>
        <span>Your wallet&apos;s keys are secured by Privy. CargoFlow never sees them and cannot move funds without your approval.</span>
      </p>
    </form>
  );
}
