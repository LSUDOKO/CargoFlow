"use client";

import { useId } from "react";
import { CloseIcon } from "./CloseIcon";
import { cx } from "./cx";
import { Portal } from "./Portal";
import { useDialog } from "./useDialog";

export type ModalSize = "sm" | "md" | "lg";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  description?: string;
  /** v1: same as size="lg". */
  wide?: boolean;
  /** sm 400px (confirmations), md 448px (default, short forms), lg 672px (tables, uploads). */
  size?: ModalSize;
  /** Actions pinned to the bottom, right-aligned from sm, stacked full-width on phones. Primary action last. */
  footer?: React.ReactNode;
};

const widths: Record<ModalSize, string> = { sm: "sm:max-w-[25rem]", md: "sm:max-w-md", lg: "sm:max-w-2xl" };

/**
 * A centred dialog (a bottom sheet on phones). Focus is trapped, Escape and the backdrop close it,
 * focus returns to the trigger. Use it for a decision that blocks the flow; prefer inline UI or a Drawer otherwise.
 */
export function Modal({ open, onClose, title, children, description, wide, size, footer }: Props) {
  const ref = useDialog(open, onClose);
  const id = useId();
  if (!open) return null;
  const s = size ?? (wide ? "lg" : "md");
  return (
    <Portal>
      <div className="fixed inset-0 z-(--z-overlay) grid place-items-end p-0 sm:place-items-center sm:p-6">
        <div className="absolute inset-0 animate-fade bg-ink/45 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={id}
          aria-describedby={description ? `${id}-d` : undefined}
          className={cx(
            "relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-sheet bg-paper shadow-3 sm:rounded-sheet",
            "animate-sheet-up sm:animate-enter",
            widths[s],
          )}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
            <div className="min-w-0">
              <h2 id={id} className="font-display text-h2">{title}</h2>
              {description && <p id={`${id}-d`} className="mt-1 text-small text-text-muted">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="-mt-1 -mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink/70 transition-colors hover:bg-ink/6 hover:text-ink" aria-label="Close">
              <CloseIcon />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
          {footer && (
            <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface px-6 py-4 sm:flex-row sm:justify-end">{footer}</div>
          )}
        </div>
      </div>
    </Portal>
  );
}
