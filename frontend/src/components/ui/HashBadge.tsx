"use client";

import { useState } from "react";
import { explorerAddress, explorerTx } from "@/lib/explorer";
import { shortHash } from "@/lib/format";
import { cx } from "./cx";

type Props = { value: string; chainId?: number; kind?: "tx" | "address" | "hash"; label?: string; className?: string; compact?: boolean };

/** A shortened, copyable hash that links to the block explorer where one exists. */
export function HashBadge({ value, chainId, kind = "hash", label, className, compact }: Props) {
  const [copied, setCopied] = useState(false);
  const href = kind === "tx" ? explorerTx(chainId, value) : kind === "address" ? explorerAddress(chainId, value) : null;
  const text = compact ? shortHash(value, 4, 4) : shortHash(value);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable: the full value is still in the title */
    }
  };
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-lg bg-ink/5 py-0.5 pl-2 font-mono text-[0.8rem] whitespace-nowrap", compact ? "pr-2" : "pr-0.5", className)} title={value}>
      {label && <span className="font-sans text-xs text-slate">{label}</span>}
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="underline decoration-ink/25 underline-offset-2 hover:decoration-ink">
          {text}
        </a>
      ) : (
        <span>{text}</span>
      )}
      <button type="button" onClick={copy} hidden={compact} className="rounded-md px-1.5 py-0.5 font-sans text-[0.7rem] font-semibold text-slate hover:bg-ink/10 hover:text-ink" aria-label={copied ? "Copied" : `Copy ${value}`}>
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
