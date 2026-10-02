"use client";

import { useId } from "react";
import { useDialog } from "./useDialog";

type Props = { open: boolean; onClose: () => void; title: string; children: React.ReactNode; description?: string; wide?: boolean };

export function Modal({ open, onClose, title, children, description, wide }: Props) {
  const ref = useDialog(open, onClose);
  const id = useId();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-end p-0 sm:place-items-center sm:p-6">
      <div className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className={`relative max-h-[92vh] w-full overflow-y-auto ${wide ? "max-w-2xl" : "max-w-md"} rounded-t-[var(--radius-card)] bg-paper p-6 shadow-[var(--shadow-lift)] sm:rounded-[var(--radius-card)]`}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id={id} className="font-display text-2xl font-semibold">{title}</h2>
            {description && <p className="mt-1 text-sm text-slate">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-2xl hover:bg-ink/5" aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
