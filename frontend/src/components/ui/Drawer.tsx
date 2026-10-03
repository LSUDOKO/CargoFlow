"use client";

import { useId } from "react";
import { CloseIcon } from "./CloseIcon";
import { cx } from "./cx";
import { Portal } from "./Portal";
import { useDialog } from "./useDialog";

type Side = "right" | "left" | "bottom";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** right (default): detail panels. left: navigation. bottom: a phone sheet (see Sheet). */
  side?: Side;
  description?: string;
  /** Actions pinned to the bottom edge. */
  footer?: React.ReactNode;
  /** md 448px (default) or lg 640px wide; ignored for bottom sheets. */
  size?: "md" | "lg";
};

const place: Record<Side, string> = {
  right: "top-0 right-0 h-full w-full animate-sheet-right",
  left: "top-0 left-0 h-full w-full animate-sheet-left",
  bottom: "inset-x-0 bottom-0 max-h-[88dvh] w-full rounded-t-sheet animate-sheet-up",
};

/** A side panel over the page: detail without losing context. Same focus rules as Modal. */
export function Drawer({ open, onClose, title, children, side = "right", description, footer, size = "md" }: Props) {
  const ref = useDialog(open, onClose);
  const id = useId();
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-(--z-overlay)">
        <div className="absolute inset-0 animate-fade bg-ink/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={id}
          aria-describedby={description ? `${id}-d` : undefined}
          className={cx("absolute flex flex-col bg-paper shadow-3", place[side], side !== "bottom" && (size === "lg" ? "max-w-xl" : "max-w-md"))}
        >
          {side === "bottom" && <span className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-ink/15" aria-hidden="true" />}
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 id={id} className="font-display text-h3">{title}</h2>
              {description && <p id={`${id}-d`} className="mt-0.5 text-small text-text-muted">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="-mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink/70 transition-colors hover:bg-ink/6 hover:text-ink" aria-label="Close">
              <CloseIcon />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer && <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface px-5 py-4 sm:flex-row sm:justify-end">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

/** A bottom sheet: the phone pattern for pickers and short forms. */
export function Sheet(props: Omit<Props, "side" | "size">) {
  return <Drawer {...props} side="bottom" />;
}
