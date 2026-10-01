"use client";

import { useState } from "react";

type Item = { id: string; title: string; body: React.ReactNode };

export function Accordion({ items }: { items: Item[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map((it) => {
        const expanded = open === it.id;
        return (
          <div key={it.id}>
            <h3>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`acc-${it.id}`}
                onClick={() => setOpen(expanded ? null : it.id)}
                className="flex w-full items-center justify-between gap-6 py-5 text-left font-display text-lg font-semibold md:text-xl"
              >
                {it.title}
                <span aria-hidden="true" className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-ink text-xl leading-none transition-transform ${expanded ? "rotate-45 bg-ink text-signal" : ""}`}>
                  +
                </span>
              </button>
            </h3>
            {expanded && (
              <div id={`acc-${it.id}`} className="max-w-[68ch] pb-6 text-[1.02rem] leading-relaxed text-ink/80">
                {it.body}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
