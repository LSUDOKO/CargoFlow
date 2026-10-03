"use client";

import { useState } from "react";
import { explorerAddress, explorerTx } from "@/lib/explorer";
import { shortHash } from "@/lib/format";
import { cx } from "./cx";

type Props = {
  value: string;
  /** Visible label before the value, e.g. "Exporter" or "Deployer". */
  label?: string;
  kind?: "address" | "tx" | "hash" | "text";
  chainId?: number;
  /** full: the whole value (wraps); short: 0x1234…abcd (default for addresses and hashes). */
  display?: "full" | "short";
  onDark?: boolean;
  /** md: a 40px field for forms and headers; sm: an inline chip for tables. */
  size?: "sm" | "md";
  className?: string;
};

/**
 * A value people copy or check: an address, a transaction, a key, a URL. Shows it in mono, offers Copy (announced
 * to screen readers) and, for on-chain values, an explorer link. HashBadge stays for v1 call sites.
 */
export function CopyField({ value, label, kind = "address", chainId, display, onDark, size = "md", className }: Props) {
  const [copied, setCopied] = useState(false);
  const href = kind === "tx" ? explorerTx(chainId, value) : kind === "address" ? explorerAddress(chainId, value) : null;
  const short = (display ?? (kind === "text" ? "full" : "short")) === "short";
  const text = short ? shortHash(value) : value;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the value stays selectable */
    }
  };
  const sm = size === "sm";
  return (
    <span
      className={cx(
        "inline-flex max-w-full min-w-0 items-center gap-1 rounded-chip ring-1 ring-inset",
        sm ? "h-7 pl-2 text-[0.75rem]" : "h-10 pl-3 text-[0.8125rem]",
        onDark ? "bg-paper/8 text-paper ring-paper/15" : "bg-surface text-ink ring-border",
        className,
      )}
    >
      {label && <span className={cx("shrink-0 font-sans text-xs font-medium", onDark ? "text-paper/70" : "text-text-muted")}>{label}</span>}
      <span title={value} className={cx("min-w-0 font-mono", short ? "whitespace-nowrap" : "truncate")}>
        {text}
      </span>
      <span className={cx("ml-auto flex shrink-0 items-center", sm ? "pr-0.5" : "pr-1")}>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : `Copy ${label ? `${label} ` : ""}${value}`}
          className={cx(
            "grid place-items-center rounded-md transition-colors duration-(--duration-fast)",
            sm ? "h-6 w-6" : "h-8 w-8",
            onDark ? "text-paper/75 hover:bg-paper/12 hover:text-paper" : "text-text-muted hover:bg-ink/6 hover:text-ink",
            copied && (onDark ? "text-success-fg-ink" : "text-success-fg"),
          )}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {copied ? <path d="m3.5 8.5 3 3 6-7" /> : <><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></>}
          </svg>
        </button>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={`View ${label ? `${label} ` : ""}on the explorer (opens in a new tab)`}
            className={cx(
              "grid place-items-center rounded-md transition-colors duration-(--duration-fast)",
              sm ? "h-6 w-6" : "h-8 w-8",
              onDark ? "text-paper/75 hover:bg-paper/12 hover:text-paper" : "text-text-muted hover:bg-ink/6 hover:text-ink",
            )}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
            </svg>
          </a>
        )}
      </span>
      <span className="sr-only" aria-live="polite">{copied ? "Copied" : ""}</span>
    </span>
  );
}
