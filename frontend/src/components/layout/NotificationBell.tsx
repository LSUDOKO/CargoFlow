"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import { useAccount } from "wagmi";
import { signMessage } from "wagmi/actions";
import { Portal } from "@/components/ui/Portal";
import { Spinner } from "@/components/ui/Spinner";
import { cx } from "@/components/ui/cx";
import { useDialog } from "@/components/ui/useDialog";
import { ApiError } from "@/lib/api/client";
import { age } from "@/lib/api/market";
import { notificationHref, notificationsKey, notificationsReadMessage, postNotificationsRead, useNotifications, useNotificationStream, type Notification } from "@/lib/api/notifications";
import { wagmiConfig } from "@/lib/chain/config";
import { signatureError } from "@/lib/chain/errors";
import { useHydrated } from "@/lib/useHydrated";

/** How each kind reads at a glance: a tone for the dot and a short label. */
const KIND: Record<string, { tone: "danger" | "alert" | "verified" | "ink"; label: string }> = {
  PAUSED: { tone: "danger", label: "Paused" },
  HELD: { tone: "alert", label: "Waiting for place" },
  RECOVERY_READY: { tone: "verified", label: "Proof ready" },
  RELEASED: { tone: "verified", label: "Released" },
  RESUMED: { tone: "verified", label: "Resumed" },
  DISPUTED: { tone: "danger", label: "Dispute" },
  DELIVERED: { tone: "verified", label: "Delivered" },
  SETTLED: { tone: "verified", label: "Settled" },
  DEFAULTED: { tone: "danger", label: "Default" },
  CANCELLED: { tone: "ink", label: "Cancelled" },
  COVER_OFFERED: { tone: "ink", label: "Cover offered" },
  COVER_ACCEPTED: { tone: "verified", label: "Cover accepted" },
  COVER_RELEASED: { tone: "ink", label: "Cover released" },
  COVER_CLAIMED: { tone: "alert", label: "Cover paid out" },
  COVER_TRIGGERED: { tone: "alert", label: "Cover triggered" },
  OFFER_RECEIVED: { tone: "ink", label: "New offer" },
  OFFER_ACCEPTED: { tone: "verified", label: "Offer accepted" },
  TITLE_BOUND: { tone: "ink", label: "Title bound" },
};
const dot = { danger: "bg-danger", alert: "bg-alert", verified: "bg-verified", ink: "bg-ink" } as const;

/** The header bell: the connected wallet's notifications, refreshed every 30 s and on live events. */
export function NotificationBell() {
  const hydrated = useHydrated();
  const { address, isConnected } = useAccount();
  const on = hydrated && isConnected && !!address;
  const list = useNotifications(on ? address : undefined);
  useNotificationStream(on ? address : undefined);
  const [open, setOpen] = useState(false);
  if (!on || (list.isError && !list.data)) return null;
  const unread = list.data?.unread ?? 0;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full text-paper/80 ring-1 ring-paper/15 ring-inset transition-colors duration-(--duration-fast) ease-standard hover:bg-paper/8 hover:text-paper hover:ring-paper/30"
      >
        <svg viewBox="0 0 24 24" className="h-[1.125rem] w-[1.125rem]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9a6 6 0 1 1 12 0c0 4.5 1.5 6.5 2 7H4c.5-.5 2-2.5 2-7Z" />
          <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
        </svg>
        {unread > 0 && (
          <span className="num absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-signal px-1 text-overline font-bold text-ink ring-2 ring-ink" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && <NotificationSheet address={address!} onClose={() => setOpen(false)} />}
    </>
  );
}

function NotificationSheet({ address, onClose }: { address: `0x${string}`; onClose: () => void }) {
  const list = useNotifications(address);
  const qc = useQueryClient();
  const ref = useDialog(true, onClose);
  const titleId = useId();
  const [busy, setBusy] = useState<"sign" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = list.data?.notifications ?? [];
  const unread = list.data?.unread ?? 0;

  async function markAll() {
    setError(null);
    const issuedAt = Math.floor(Date.now() / 1000);
    let signature: string;
    try {
      setBusy("sign");
      signature = await signMessage(wagmiConfig, { account: address, message: notificationsReadMessage(address, [], issuedAt) });
    } catch (err) {
      setError(signatureError(err));
      setBusy(null);
      return;
    }
    try {
      setBusy("send");
      await postNotificationsRead({ address: address.toLowerCase(), issuedAt, signature });
      await qc.invalidateQueries({ queryKey: notificationsKey(address) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The notifications could not be marked read.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Portal>
      <div className="surface-light fixed inset-0 z-50 text-ink">
        <div className="absolute inset-0 animate-fade bg-ink/40 backdrop-blur-[2px] sm:bg-ink/10 sm:backdrop-blur-none" onClick={onClose} aria-hidden="true" />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] animate-rise flex-col overflow-hidden rounded-t-[28px] bg-paper shadow-[var(--shadow-lift)] sm:inset-x-auto sm:top-[4.75rem] sm:right-4 sm:bottom-auto sm:max-h-[min(78dvh,640px)] sm:w-[400px] sm:rounded-3xl sm:border sm:border-line md:right-8 xl:right-[max(2rem,calc((100vw-80rem)/2+2rem))]"
        >
          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-ink/15 sm:hidden" aria-hidden="true" />
          <header className="flex shrink-0 items-center gap-3 border-b border-line px-5 pt-3 pb-3 sm:pt-4">
            <h2 id={titleId} className="flex-1 font-display text-lg font-semibold">
              Notifications
              {unread > 0 && <span className="ml-2 rounded-full bg-signal px-2 py-0.5 align-middle font-sans text-xs font-bold">{unread} new</span>}
            </h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markAll()}
                disabled={busy !== null}
                className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold underline-offset-4 hover:bg-ink/5 hover:underline disabled:opacity-60"
              >
                {busy && <Spinner className="h-4 w-4" />}
                {busy === "sign" ? "Sign in your wallet…" : busy === "send" ? "Marking…" : "Mark all read"}
              </button>
            )}
            <button type="button" onClick={onClose} className="-mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-ink/6" aria-label="Close notifications">
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
            </button>
          </header>
          {error && <p role="alert" className="mx-5 mt-3 rounded-xl bg-danger/8 px-3 py-2 text-sm font-medium text-[#a1191e]">{error}</p>}
          <div className="min-h-0 flex-1 overflow-y-auto pb-[max(env(safe-area-inset-bottom),0.5rem)]">
            {list.isPending ? (
              <div className="flex justify-center py-10" role="status"><Spinner className="h-5 w-5" /><span className="sr-only">Loading notifications</span></div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center px-8 py-12 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-mist" aria-hidden="true">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 text-slate" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9a6 6 0 1 1 12 0c0 4.5 1.5 6.5 2 7H4c.5-.5 2-2.5 2-7Z" /><path d="M10 19.5a2.2 2.2 0 0 0 4 0" /></svg>
                </span>
                <p className="mt-3 font-semibold">You&apos;re all caught up</p>
                <p className="mt-1 text-sm text-slate">Pauses, releases, offers and recovery proofs for your shipments appear here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((n) => (
                  <Item key={n.id} n={n} onNavigate={onClose} />
                ))}
              </ul>
            )}
          </div>
          <p className="shrink-0 border-t border-line px-5 py-2.5 text-xs text-slate">Marking read is a free signature from this wallet.</p>
        </div>
      </div>
    </Portal>
  );
}

function Item({ n, onNavigate }: { n: Notification; onNavigate: () => void }) {
  const k = KIND[n.kind] ?? { tone: "ink" as const, label: n.kind.replace(/_/g, " ").toLowerCase() };
  const href = notificationHref(n);
  const unread = !n.readAt;
  const body = (
    <>
      <span className="mt-1.5 flex w-2.5 shrink-0 justify-center" aria-hidden="true">
        <span className={cx("h-2.5 w-2.5 rounded-full", dot[k.tone], !unread && "opacity-30")} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[0.6875rem] font-semibold tracking-wide text-slate uppercase">
          {k.label}
          <span aria-hidden="true">·</span>
          <time dateTime={n.createdAt} className="normal-case tracking-normal">{age(n.createdAt)}</time>
          {unread && <span className="sr-only">(unread)</span>}
        </span>
        <span className={cx("mt-0.5 block text-[0.9375rem] leading-snug", unread ? "font-semibold" : "font-medium text-ink/80")}>{n.title}</span>
        {n.body && <span className="mt-0.5 line-clamp-2 block text-sm text-slate">{n.body}</span>}
        {n.kind === "RECOVERY_READY" && href && <span className="mt-1.5 inline-block rounded-full bg-signal px-2.5 py-0.5 text-xs font-semibold">Review and sign</span>}
      </span>
    </>
  );
  const cls = cx("flex gap-3 px-5 py-3.5 transition-colors", unread && "bg-signal/[0.07]");
  return (
    <li>
      {href ? (
        href.startsWith("/") ? (
          <Link href={href} onClick={onNavigate} className={cx(cls, "hover:bg-ink/4")}>{body}</Link>
        ) : (
          <a href={href} target="_blank" rel="noreferrer" className={cx(cls, "hover:bg-ink/4")}>{body}</a>
        )
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}
