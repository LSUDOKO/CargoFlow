"use client";

import { useMemo, useState } from "react";
import { cx } from "./cx";
import { type TokenKind, tokenize } from "./highlight";

/** Copies text to the clipboard, saying "Copied" for a moment. */
export function CopyButton({ text, label = "Copy", className, big }: { text: string; label?: string; className?: string; big?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* the text stays selectable */
        }
      }}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-semibold transition-colors",
        big ? "h-12 bg-signal px-6 text-base text-ink hover:bg-signal-2" : "h-8 border border-current/25 px-3 text-xs hover:border-current/60",
        className,
      )}
      aria-live="polite"
    >
      <svg viewBox="0 0 16 16" className={big ? "h-4 w-4" : "h-3.5 w-3.5"} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        {copied ? <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" /> : <><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></>}
      </svg>
      {copied ? "Copied" : label}
    </button>
  );
}

const TONE: Record<TokenKind, string | undefined> = {
  plain: undefined,
  comment: "text-text-muted italic", // #5B6B7B, 5.3:1 on the code background (#FBFCF9)
  string: "text-success-fg", // #00733E, 5.8:1
  number: "text-warning-fg", // #8A5300, 6.2:1
  keyword: "text-info-fg", // #1D5C96, 6.8:1
  key: "text-ink-700", // #1D3A55, 11.4:1
};

/**
 * A light code block (paper background, ink text, restrained syntax colours that each clear 4.5:1) with a copy
 * button. `contain: inline-size` stops a long line from widening its grid or flex parent (that pushed /docs 550px
 * past a 390px screen); the code scrolls sideways inside the block instead.
 */
export function CodeBlock({ code, label, className }: { code: string; label?: string; className?: string }) {
  const tokens = useMemo(() => tokenize(code), [code]);
  return (
    <div className={cx("relative w-full max-w-full min-w-0 overflow-hidden rounded-tile border border-border bg-neutral-25 text-ink [contain:inline-size]", className)}>
      {label && <div className="border-b border-border bg-surface px-4 py-2 font-mono text-micro tracking-wide text-text-muted uppercase">{label}</div>}
      <div className="flex items-start gap-3 p-4">
        <pre tabIndex={0} aria-label={label ? `${label} code` : "Code"} className="min-w-0 flex-1 overflow-x-auto rounded-md font-mono text-small leading-relaxed whitespace-pre">
          <code>
            {tokens.map((t, i) => (TONE[t.kind] ? <span key={i} className={TONE[t.kind]}>{t.text}</span> : t.text))}
          </code>
        </pre>
        <CopyButton text={code} className="bg-surface text-ink" />
      </div>
    </div>
  );
}
