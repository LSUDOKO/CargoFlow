"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { Tone } from "@/lib/status";
import { CloseIcon } from "./CloseIcon";
import { cx } from "./cx";
import { StateIcon, type StateIconKind } from "./StateIcon";

export type ToastInput = {
  /** v1 status tone: verified (success), alert (warning), danger, ink (neutral, final), slate (neutral). */
  tone?: Tone | "info";
  title: string;
  body?: string;
  /** External link (opens in a new tab), e.g. the explorer. */
  href?: string | null;
  hrefLabel?: string;
  /** An in-app action, e.g. Undo or View. Dismisses the toast when pressed. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds before it hides; 0 keeps it until dismissed. Defaults: 7 s, 12 s for danger. */
  duration?: number;
};
type ToastItem = ToastInput & { id: number };

const Ctx = createContext<{ toast: (t: ToastInput) => number; dismiss: (id: number) => void } | null>(null);

const icon: Record<Tone | "info", StateIconKind> = { verified: "success", alert: "warning", ink: "success", danger: "danger", slate: "info", info: "info" };
const iconColor: Record<Tone | "info", string> = {
  verified: "text-success-fg-ink",
  alert: "text-warning-fg-ink",
  ink: "text-signal",
  danger: "text-danger-fg-ink",
  slate: "text-paper/70",
  info: "text-info-fg-ink",
};

/** Transient confirmation of something that already happened. Lives bottom-right (bottom on phones), newest last, four at most. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: ToastInput) => {
      const id = next.current++;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      const ms = t.duration ?? (t.tone === "danger" ? 12_000 : 7_000);
      if (ms > 0) setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed right-0 bottom-0 z-(--z-toast) flex w-full max-w-sm flex-col gap-2 p-4">
        {items.map((t) => {
          const tone = t.tone ?? "slate";
          return (
            <div key={t.id} className="surface-ink pointer-events-auto flex animate-enter items-start gap-3 rounded-tile bg-ink py-3 pr-1.5 pl-4 text-paper shadow-3 ring-1 ring-paper/10">
              <StateIcon kind={icon[tone]} className={cx("mt-0.5 h-4 w-4 shrink-0", iconColor[tone])} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.body && <p className="mt-0.5 text-small text-paper/75">{t.body}</p>}
                {(t.href || t.action) && (
                  <div className="mt-1.5 flex items-center gap-4">
                    {t.action && (
                      <button
                        type="button"
                        onClick={() => {
                          t.action!.onClick();
                          dismiss(t.id);
                        }}
                        className="text-small font-semibold text-signal underline underline-offset-2"
                      >
                        {t.action.label}
                      </button>
                    )}
                    {t.href && (
                      <a href={t.href} target="_blank" rel="noreferrer" className="text-small font-semibold text-signal underline underline-offset-2">
                        {t.hrefLabel ?? "View on explorer"}
                      </a>
                    )}
                  </div>
                )}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-paper/60 hover:bg-paper/10 hover:text-paper" aria-label="Dismiss">
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}
