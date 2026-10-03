"use client";

import { useId, useMemo, useState } from "react";
import { countryName, findPort, searchPorts, type Port } from "@/lib/geo/ports";

type Props = {
  label: string;
  value: string | null;
  onChange: (code: string | null) => void;
  placeholder?: string;
  /** codes that may not be chosen (the other ends of the route) */
  exclude?: string[];
  error?: string | null;
  action?: React.ReactNode;
};

/** Port search over the bundled list, as an ARIA 1.2 combobox: type, move with the arrow keys, Enter to choose. */
export function PortCombobox({ label, value, onChange, placeholder = "Search ports", exclude = [], error, action }: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const selected = value ? findPort(value) : undefined;
  const [query, setQuery] = useState<string | null>(null); // null: show the selected port
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const options = useMemo(() => searchPorts(query ?? "", 8).filter((p) => !exclude.includes(p.code)), [query, exclude]);
  const shown = query ?? (selected ? `${selected.name}, ${countryName(selected.country)}` : "");

  const choose = (p: Port) => {
    onChange(p.code);
    setQuery(null);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      const p = options[active];
      if (p) choose(p);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery(null);
    }
  };

  return (
    <div className="relative">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-semibold">{label}</label>
        {action}
      </div>
      <div className={`flex items-center rounded-tile border-2 bg-white transition-colors focus-within:border-ink ${error ? "border-danger" : "border-line"}`}>
        <svg aria-hidden="true" viewBox="0 0 16 16" className="ml-4 h-4 w-4 shrink-0 text-text-muted" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" strokeLinecap="round" /></svg>
        <input
          id={id}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${id}-${options[active].code}` : undefined}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={shown}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={(e) => {
            e.target.select();
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            setQuery(null);
          }}
          onKeyDown={onKey}
          className="h-12 w-full min-w-0 rounded-tile bg-transparent px-3 text-body outline-none"
        />
        {selected && <span className="pr-4 font-mono text-xs font-semibold text-text-muted">{selected.code}</span>}
      </div>
      {error && <p id={`${id}-err`} className="mt-1.5 text-sm font-medium text-danger-fg">{error}</p>}
      <ul
        id={listId}
        role="listbox"
        aria-label="Matching ports"
        hidden={!open || options.length === 0}
        className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-72 overflow-y-auto rounded-tile border-2 border-line bg-white p-1.5 shadow-3"
      >
        {options.map((p, i) => (
          <li
            key={p.code}
            id={`${id}-${p.code}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()} // keep focus in the input so blur does not close first
            onClick={() => choose(p)}
            onMouseEnter={() => setActive(i)}
            className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm ${i === active ? "bg-mist" : ""}`}
          >
            <span className="min-w-0">
              <span className="font-semibold">{p.name}</span>
              <span className="text-text-muted">, {countryName(p.country)}</span>
            </span>
            <span className="shrink-0 font-mono text-xs text-text-muted">{p.code}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
