"use client";

import { useId } from "react";
import { Portal } from "./Portal";
import { useDialog } from "./useDialog";

type Props = { open: boolean; onClose: () => void; title: string; children: React.ReactNode; side?: "right" | "left" };

export function Drawer({ open, onClose, title, children, side = "right" }: Props) {
  const ref = useDialog(open, onClose);
  const id = useId();
  if (!open) return null;
  return (
    <Portal>
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={`absolute top-0 ${side === "right" ? "right-0" : "left-0"} flex h-full w-full max-w-md flex-col bg-paper shadow-[var(--shadow-lift)]`}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id={id} className="font-display text-xl font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full text-2xl hover:bg-ink/5" aria-label="Close">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
    </Portal>
  );
}
