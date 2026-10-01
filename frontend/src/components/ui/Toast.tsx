"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { Tone } from "@/lib/status";
import { cx } from "./cx";

type ToastInput = { tone?: Tone; title: string; body?: string; href?: string | null; hrefLabel?: string };
type ToastItem = ToastInput & { id: number };

const Ctx = createContext<{ toast: (t: ToastInput) => void } | null>(null);

const bar: Record<Tone, string> = { verified: "bg-verified", alert: "bg-alert", ink: "bg-signal", danger: "bg-danger", slate: "bg-slate" };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: ToastInput) => {
      const id = next.current++;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === "danger" ? 12_000 : 7_000);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed right-0 bottom-0 z-[60] flex w-full max-w-sm flex-col gap-2 p-4">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex animate-rise overflow-hidden rounded-2xl bg-ink text-paper shadow-[var(--shadow-lift)]">
            <span className={cx("w-1.5 shrink-0", bar[t.tone ?? "slate"])} aria-hidden="true" />
            <div className="flex-1 px-4 py-3">
              <p className="font-semibold">{t.title}</p>
              {t.body && <p className="mt-0.5 text-sm text-paper/75">{t.body}</p>}
              {t.href && (
                <a href={t.href} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-semibold text-signal underline underline-offset-2">
                  {t.hrefLabel ?? "View on explorer"}
                </a>
              )}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} className="px-3 text-xl text-paper/60 hover:text-paper" aria-label="Dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}
