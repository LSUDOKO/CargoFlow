"use client";

import { useState } from "react";
import { cx } from "./cx";

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

/**
 * A dark code block with a copy button. `contain: inline-size` stops a long line from widening its grid or flex
 * parent (that pushed /docs 550px past a 390px screen); the code scrolls sideways inside the block instead.
 */
export function CodeBlock({ code, label, className }: { code: string; label?: string; className?: string }) {
  return (
    <div className={cx("surface-ink relative w-full max-w-full min-w-0 overflow-hidden rounded-tile bg-ink text-paper [contain:inline-size]", className)}>
      {label && <div className="border-b border-paper/10 px-4 py-2 font-mono text-[0.6875rem] tracking-wide text-paper/55 uppercase">{label}</div>}
      <div className="flex items-start gap-3 p-4">
        <pre tabIndex={0} aria-label={label ? `${label} code` : "Code"} className="min-w-0 flex-1 overflow-x-auto rounded-md font-mono text-[0.8125rem] leading-relaxed whitespace-pre"><code>{code}</code></pre>
        <CopyButton text={code} className="text-paper" />
      </div>
    </div>
  );
}
