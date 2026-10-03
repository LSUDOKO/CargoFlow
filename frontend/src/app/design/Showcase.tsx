"use client";

import { useState } from "react";
import { Banner, Callout } from "@/components/ui/Banner";
import { Button, IconButton, LinkButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { CopyField } from "@/components/ui/CopyField";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer, Sheet } from "@/components/ui/Drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { Kbd } from "@/components/ui/Kbd";
import { KeyValue } from "@/components/ui/KeyValue";
import { Modal } from "@/components/ui/Modal";
import { Badge, StatusPill } from "@/components/ui/Pill";
import { PageHeader, Section, SectionHeader } from "@/components/ui/Section";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { Sparkline } from "@/components/ui/Sparkline";
import { Stat } from "@/components/ui/Stat";
import { StateIcon } from "@/components/ui/StateIcon";
import { Stepper } from "@/components/ui/Stepper";
import { Tabs } from "@/components/ui/Tabs";
import { Timeline, type TimelineItem } from "@/components/ui/Timeline";
import { useToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/components/ui/cx";

/* ── contrast helper so every swatch states its ratio ─────────────────────── */
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h: string) => {
  const [r, g, b] = rgb(h).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

const NAV = [
  ["colour", "Colour"],
  ["type", "Type"],
  ["space", "Spacing & radius"],
  ["elevation", "Elevation"],
  ["motion", "Motion"],
  ["layout", "Layout"],
  ["buttons", "Buttons"],
  ["badges", "Badges"],
  ["forms", "Forms"],
  ["navigation", "Tabs & stepper"],
  ["data", "Data display"],
  ["table", "Data table"],
  ["timeline", "Timeline"],
  ["feedback", "Feedback"],
  ["overlays", "Overlays"],
  ["templates", "Page templates"],
] as const;

function Block({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border-t border-border pt-10">
      <SectionHeader id={`${id}-h`} title={title} description={description} />
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow mb-3">{children}</p>;
}

function Surface({ ink, children, className }: { ink?: boolean; children: React.ReactNode; className?: string }) {
  return <div className={cx("min-w-0 rounded-card p-5 md:p-6", ink ? "surface-ink bg-ink text-paper" : "border border-border bg-surface", className)}>{children}</div>;
}

function Swatch({ name, hex, on = "#ffffff", note }: { name: string; hex: string; on?: string; note?: string }) {
  const textOn = ratio(hex, "#0b1b2b") >= ratio(hex, "#f7f9f4") ? "#0b1b2b" : "#f7f9f4";
  const r = ratio(hex, on);
  return (
    <div className="min-w-0">
      <div className="flex h-16 items-end rounded-tile p-2 ring-1 ring-ink/8 ring-inset" style={{ background: hex, color: textOn }}>
        <span className="font-mono text-[0.6875rem] font-semibold">{hex}</span>
      </div>
      <p className="mt-1.5 truncate text-xs font-semibold">{name}</p>
      <p className="num text-caption text-text-muted">{note ?? `${r.toFixed(1)}:1 on ${on === "#ffffff" ? "white" : on}`}</p>
    </div>
  );
}

const BRAND = [
  ["ink", "#0b1b2b"],
  ["paper", "#f7f9f4"],
  ["signal", "#c6f432"],
  ["signal-2", "#b2e01c"],
  ["signal-soft", "#eefbc8"],
  ["signal-fg", "#3d5a00"],
] as const;
const INK = [
  ["ink-950", "#07131f"],
  ["ink-900", "#0b1b2b"],
  ["ink-800", "#13293d"],
  ["ink-700", "#1d3a55"],
  ["ink-600", "#2d4d6b"],
  ["ink-500", "#4a6680"],
  ["ink-400", "#7d93a8"],
  ["ink-300", "#b3c2cf"],
  ["ink-200", "#d5e3ec"],
  ["ink-100", "#e8eff4"],
] as const;
const NEUTRAL = [
  ["neutral-0", "#ffffff"],
  ["neutral-25", "#fbfcf9"],
  ["neutral-50 · paper", "#f7f9f4"],
  ["neutral-100 · mist", "#eef2ea"],
  ["neutral-150", "#e4eadf"],
  ["neutral-200 · line", "#dce3da"],
  ["neutral-300", "#c3ccc4"],
  ["neutral-400", "#8d9a97"],
  ["neutral-500 · slate", "#5b6b7b"],
  ["neutral-600", "#45556a"],
  ["neutral-700", "#2a3b4f"],
  ["neutral-900", "#0b1b2b"],
] as const;
const SEMANTIC = [
  { name: "success", bg: "#e3f6ea", fg: "#00733e", border: "#9fdcb9", solid: "#00804a", fgInk: "#7cf0b5" },
  { name: "warning", bg: "#fff2d6", fg: "#8a5300", border: "#f5cd7f", solid: "#ffb020", fgInk: "#ffc85c" },
  { name: "danger", bg: "#fde7e7", fg: "#a1191e", border: "#f2b3b5", solid: "#c8323a", fgInk: "#ffb4b6" },
  { name: "info", bg: "#e4eff9", fg: "#1d5c96", border: "#a9cbec", solid: "#1d5c96", fgInk: "#9fcbf5" },
] as const;

const TYPE = [
  ["text-display", "font-display text-display", "Capital that moves", "clamp 40→68 / 1.02 / −0.04em / 700"],
  ["text-h1", "font-display text-h1", "Fund cargo that proves itself", "clamp 32→44 / 1.08 / −0.03em / 700"],
  ["text-h2", "font-display text-h2", "Milestone releases", "24 / 1.2 / −0.02em / 600"],
  ["text-h3", "font-display text-h3", "Zero-knowledge recovery", "18 / 1.35 / −0.01em / 600"],
  ["text-h4", "font-display text-h4", "Evidence sources", "16 / 1.4 / 600"],
  ["text-body-lg", "text-body-lg", "Register the cargo, fix its cold-chain policy and name a financier.", "17 / 1.6"],
  ["text-body", "text-body", "Each release is a transaction you can check on the explorer.", "15 / 1.55"],
  ["text-small", "text-small text-text-muted", "Logger fix 36 min ago · 18.9° N, 73.0° E", "13 / 1.45"],
  ["text-caption", "text-caption text-text-muted", "Fixed at registration: no party can change these terms.", "12 / 1.35 / +0.01em"],
  ["eyebrow", "eyebrow", "Where the cargo is", "11 / 600 / +0.08em / uppercase"],
  ["text-metric num", "font-display text-metric num", "40,000.50", "clamp 28→36 / tabular"],
  ["font-mono", "font-mono text-sm", "0x8e6877…102f", "hashes, code, keys only"],
] as const;

const SPACE = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 24];
const RADII = [
  ["rounded-chip", "0.5rem", "hash chips, kbd"],
  ["rounded-control", "0.75rem", "inputs, selects"],
  ["rounded-tile", "0.75rem", "wells in a card"],
  ["rounded-card", "1.25rem", "cards, panels"],
  ["rounded-sheet", "1.5rem", "modals, heroes"],
  ["rounded-pill", "9999px", "buttons, tabs, badges"],
] as const;

type Shipment = { id: string; ref: string; status: string; drawn: number; facility: number; score: number; trend: number[]; updated: string };
const SHIPMENTS: Shipment[] = [
  { id: "0xc574", ref: "CF-LIVE-1791029236301", status: "SETTLED", drawn: 20, facility: 20, score: 100, trend: [92, 96, 100, 99, 100, 100], updated: "3 Oct, 12:08" },
  { id: "0x2a91", ref: "CF-2026-SG01-0142", status: "ACTIVE", drawn: 24_000, facility: 40_000, score: 94, trend: [88, 91, 90, 94, 93, 94], updated: "3 Oct, 11:56" },
  { id: "0x7f03", ref: "CF-2026-RTM-0087", status: "PAUSED", drawn: 8_000, facility: 32_500, score: 61, trend: [90, 84, 77, 70, 64, 61], updated: "2 Oct, 22:14" },
  { id: "0x11be", ref: "CF-2026-HAM-0311", status: "DISPUTED", drawn: 12_750, facility: 15_000, score: 72, trend: [80, 79, 81, 76, 74, 72], updated: "2 Oct, 09:31" },
];
const fmt = (n: number) => n.toLocaleString("en-US");
const COLUMNS: Column<Shipment>[] = [
  { key: "ref", header: "Shipment", primary: true, cell: (r) => r.ref },
  { key: "status", header: "Status", cell: (r) => <StatusPill status={r.status} /> },
  { key: "drawn", header: "Drawn (USDG)", numeric: true, sortable: true, cell: (r) => <>{fmt(r.drawn)}<span className="text-text-muted"> / {fmt(r.facility)}</span></> },
  { key: "score", header: "Evidence", numeric: true, sortable: true, cell: (r) => <span className="inline-flex items-center gap-2"><Sparkline values={r.trend} width={56} height={18} tone={r.score < 75 ? "warning" : "ink"} />{r.score}</span> },
  { key: "updated", header: "Updated", hideOnCard: true, cell: (r) => <span className="text-text-muted">{r.updated}</span> },
];

const JOURNEY: TimelineItem[] = [
  { id: "m1", eyebrow: "Milestone 1", title: "Checkpoint 1", state: "done", time: "3 Oct", meta: <span className="num text-small">4 USDG</span> },
  { id: "m2", eyebrow: "Milestone 2", title: "Checkpoint 2", state: "done", time: "3 Oct", meta: <span className="num text-small">4 USDG</span> },
  { id: "m3", eyebrow: "Milestone 3", title: "Checkpoint 3", state: "held", time: "Paused, awaiting proof", description: "One batch left the 2–8 °C band." },
  { id: "m4", eyebrow: "Milestone 4", title: "Checkpoint 4", state: "active", time: "In transit" },
  { id: "m5", eyebrow: "Delivery", title: "Buyer confirms arrival", state: "pending" },
  { id: "m6", eyebrow: "Payment", title: "Buyer pays the invoice", state: "failed", time: "Example of a failed step" },
];

const ArrowIcon = () => (
  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
);
const DownloadIcon = () => (
  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" /></svg>
);
const BoxIcon = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" /></svg>
);

export function Showcase() {
  const { toast } = useToast();
  const [tab, setTab] = useState("overview");
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [value, setValue] = useState(24_000);
  const [confirmKey, setConfirmKey] = useState(0);
  const [enterKey, setEnterKey] = useState(0);
  const [banner, setBanner] = useState(true);

  return (
    <div className="container-page py-(--space-page-y)">
      <PageHeader
        eyebrow="Internal"
        title="Design system v2"
        description="Every token and component CargoFlow pages are built from, on paper and ink, with their states. Resize the window to check 390, 768 and 1440."
        meta={
          <>
            <Badge variant="neutral" shape="square">Not linked publicly</Badge>
            <Badge variant="signal" dot>v2</Badge>
            <span className="text-small text-text-muted">
              Breakpoint: <span className="font-semibold text-ink sm:hidden">base (&lt;640)</span>
              <span className="hidden font-semibold text-ink sm:inline md:hidden">sm (640)</span>
              <span className="hidden font-semibold text-ink md:inline lg:hidden">md (768)</span>
              <span className="hidden font-semibold text-ink lg:inline xl:hidden">lg (1024)</span>
              <span className="hidden font-semibold text-ink xl:inline">xl (1280+)</span>
            </span>
          </>
        }
      />

      <nav aria-label="Design system sections" className="scroll-x fade-x-end sticky top-0 z-(--z-sticky) -mx-(--gutter) mb-10 border-b border-border bg-paper/90 px-(--gutter) py-3 backdrop-blur">
        <ul className="flex min-w-max gap-1">
          {NAV.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="inline-flex h-8 items-center rounded-full px-3 text-sm font-semibold text-ink/75 hover:bg-ink/6 hover:text-ink">{label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-14">
        {/* ── COLOUR ─────────────────────────────────────────────── */}
        <Block id="colour" title="Colour" description="Navy, paper and one lime accent. Semantic colours carry meaning only; every text pairing below clears 4.5:1.">
          <div>
            <Label>Brand</Label>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {BRAND.map(([n, h]) => <Swatch key={n} name={n} hex={h} on={n.startsWith("signal") && n !== "signal-fg" ? "#0b1b2b" : "#ffffff"} />)}
            </div>
          </div>
          <div>
            <Label>Ink scale</Label>
            <div className="grid grid-cols-5 gap-3 lg:grid-cols-10">
              {INK.map(([n, h]) => <Swatch key={n} name={n} hex={h} />)}
            </div>
          </div>
          <div>
            <Label>Neutrals (paper-tinted)</Label>
            <div className="grid grid-cols-4 gap-3 md:grid-cols-6 lg:grid-cols-12">
              {NEUTRAL.map(([n, h]) => <Swatch key={n} name={n} hex={h} />)}
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Surface>
              <Label>Semantic on light: bg / fg / border / solid</Label>
              <div className="flex flex-col gap-3">
                {SEMANTIC.map((s) => (
                  <div key={s.name} className="grid grid-cols-[6rem_1fr] items-center gap-3">
                    <span className="text-sm font-semibold">{s.name}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset" style={{ background: s.bg, color: s.fg, boxShadow: `inset 0 0 0 1px ${s.border}` }}>
                        {s.name}-fg on -bg · {ratio(s.fg, s.bg).toFixed(1)}:1
                      </span>
                      <span className="rounded-md px-2.5 py-1 text-xs font-semibold" style={{ background: s.solid, color: s.name === "warning" ? "#0b1b2b" : "#ffffff" }}>
                        solid · {ratio(s.solid, s.name === "warning" ? "#0b1b2b" : "#ffffff").toFixed(1)}:1
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Surface>
            <Surface ink>
              <Label>Semantic on ink: bg-ink / fg-ink / border-ink</Label>
              <div className="flex flex-col gap-3">
                {SEMANTIC.map((s) => (
                  <div key={s.name} className="grid grid-cols-[6rem_1fr] items-center gap-3">
                    <span className="text-sm font-semibold">{s.name}</span>
                    <span className="num text-xs font-semibold" style={{ color: s.fgInk }}>
                      {s.name}-fg-ink · {ratio(s.fgInk, "#0b1b2b").toFixed(1)}:1 on ink
                    </span>
                  </div>
                ))}
                <p className="text-small text-paper/70">Muted text on ink: text-on-ink-muted (paper at 70%) · 8.5:1</p>
              </div>
            </Surface>
          </div>
        </Block>

        {/* ── TYPE ───────────────────────────────────────────────── */}
        <Block id="type" title="Type" description="Space Grotesk for headings and big numerals, Inter for everything read, JetBrains Mono only for hashes, keys and code. Amounts use Inter with tabular numerals (.num).">
          <Surface className="divide-y divide-border p-0 md:p-0">
            {TYPE.map(([token, cls, sample, spec]) => (
              <div key={token} className="grid gap-1 px-5 py-4 md:grid-cols-[11rem_1fr_15rem] md:items-baseline md:gap-6 md:px-6">
                <code className="font-mono text-xs text-ink-500">{token}</code>
                <p className={cx(cls, "min-w-0 truncate")}>{sample}</p>
                <p className="num text-caption text-text-muted md:text-right">{spec}</p>
              </div>
            ))}
          </Surface>
        </Block>

        {/* ── SPACING & RADIUS ───────────────────────────────────── */}
        <Block id="space" title="Spacing and radius" description="A 4px base. Cards pad 16 → 24, stack 16 apart, sections 40 apart. Four radii; buttons, tabs and badges are pills.">
          <div className="grid gap-4 lg:grid-cols-2">
            <Surface>
              <Label>Spacing scale (Tailwind steps)</Label>
              <div className="flex flex-col gap-2">
                {SPACE.map((s) => (
                  <div key={s} className="flex items-center gap-3">
                    <code className="num w-10 font-mono text-xs text-ink-500">{s}</code>
                    <span className="h-3 rounded-sm bg-signal" style={{ width: `${s * 4}px` }} />
                    <span className="num text-caption text-text-muted">{s * 4}px</span>
                  </div>
                ))}
              </div>
              <div className="mt-5">
                <KeyValue dense items={[
                  { label: "--space-card", value: "24px (16px phones: --space-card-sm)" },
                  { label: "--space-stack", value: "16px between cards" },
                  { label: "--space-section", value: "40px between sections" },
                  { label: "--gutter", value: "16 · 24 (sm) · 32 (md)" },
                ]} />
              </div>
            </Surface>
            <Surface>
              <Label>Radius</Label>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {RADII.map(([cls, v, use]) => (
                  <div key={cls}>
                    <div className={cx("h-16 border-2 border-ink bg-mist", cls)} />
                    <p className="mt-2 font-mono text-xs">{cls}</p>
                    <p className="text-caption text-text-muted">{v} · {use}</p>
                  </div>
                ))}
              </div>
            </Surface>
          </div>
        </Block>

        {/* ── ELEVATION ──────────────────────────────────────────── */}
        <Block id="elevation" title="Elevation" description="Four levels, navy-tinted, one light source. Resting cards are level 1; level 3 is reserved for things above the page.">
          <div className="grid grid-cols-2 gap-4 rounded-card bg-mist p-5 md:grid-cols-4 md:p-8">
            {[
              ["shadow-0", "Flat: sections, rows, sunken wells"],
              ["shadow-1", "Resting: cards, controls, tiles"],
              ["shadow-2", "Raised: hover, menus, tooltips"],
              ["shadow-3", "Overlay: modals, drawers, toasts"],
            ].map(([s, d]) => (
              <div key={s} className={cx("rounded-card border border-border bg-surface p-4", s)}>
                <p className="font-mono text-xs font-semibold">{s}</p>
                <p className="mt-1 text-small text-text-muted">{d}</p>
              </div>
            ))}
          </div>
        </Block>

        {/* ── MOTION ─────────────────────────────────────────────── */}
        <Block id="motion" title="Motion" description="One language with three verbs. Enter: 200ms ease-enter, 6px rise and fade. Update: a 320ms lime wash when a live value changes, never on first paint. Confirm: a 320ms settle when an action succeeds. Reduced motion removes all of it.">
          <div className="grid gap-4 md:grid-cols-3">
            <Surface>
              <Label>Enter · animate-enter</Label>
              <div key={enterKey} className="animate-enter rounded-tile bg-mist p-4 text-sm">A panel arriving</div>
              <Button size="sm" variant="secondary" className="mt-4" onClick={() => setEnterKey((k) => k + 1)}>Replay</Button>
            </Surface>
            <Surface>
              <Label>Update · animate-update</Label>
              <Stat tile={false} label="Capital drawn" value={fmt(value)} unit="USDG" />
              <Button size="sm" variant="secondary" className="mt-4" onClick={() => setValue((v) => v + 4_000)}>Release 4,000</Button>
            </Surface>
            <Surface>
              <Label>Confirm · animate-confirm</Label>
              <div key={confirmKey} className={cx("inline-flex items-center gap-2 rounded-full bg-success-bg px-3 py-1.5 text-sm font-semibold text-success-fg", confirmKey > 0 && "animate-confirm")}>
                <StateIcon kind="success" /> Milestone 3 released
              </div>
              <div>
                <Button size="sm" variant="secondary" className="mt-4" onClick={() => setConfirmKey((k) => k + 1)}>Confirm</Button>
              </div>
            </Surface>
          </div>
          <KeyValue items={[
            { label: "--duration-fast · 120ms", value: "hover, press, focus" },
            { label: "--duration-base · 200ms", value: "enter, tab switch, toggles" },
            { label: "--duration-slow · 320ms", value: "sheets, value updates, confirm" },
            { label: "ease-standard / ease-enter / ease-exit", value: "state change / arriving / leaving" },
          ]} />
        </Block>

        {/* ── LAYOUT ─────────────────────────────────────────────── */}
        <Block id="layout" title="Layout" description="Pages sit in a 1280px container (max-w-page) with a 16/24/32 gutter. Inside, a 12-column grid with 16px gaps on phones and 24px from md.">
          <div className="grid-12" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="num grid h-12 place-items-center rounded-md bg-signal-soft text-caption font-semibold text-signal-fg ring-1 ring-signal-2/50 ring-inset">{i + 1}</div>
            ))}
          </div>
          <div className="grid-12" aria-hidden="true">
            <div className="col-span-12 rounded-tile bg-mist p-3 text-small md:col-span-8">8 · main column (detail page)</div>
            <div className="col-span-12 rounded-tile bg-mist p-3 text-small md:col-span-4">4 · aside</div>
            <div className="col-span-6 rounded-tile bg-mist p-3 text-small md:col-span-3">3 · stat</div>
            <div className="col-span-6 rounded-tile bg-mist p-3 text-small md:col-span-3">3 · stat</div>
            <div className="col-span-6 rounded-tile bg-mist p-3 text-small md:col-span-3">3 · stat</div>
            <div className="col-span-6 rounded-tile bg-mist p-3 text-small md:col-span-3">3 · stat</div>
          </div>
        </Block>

        {/* ── BUTTONS ────────────────────────────────────────────── */}
        <Block id="buttons" title="Buttons" description="One primary per view. Pills, 2px borders, four sizes. Loading keeps the width and sets aria-busy.">
          <Surface>
            <Label>Variants on paper</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Button>Finance a new shipment</Button>
              <Button variant="ink">API reference</Button>
              <Button variant="secondary">Post a shipment</Button>
              <Button variant="ghost">Dashboard</Button>
              <Button variant="danger-outline">Open a dispute</Button>
              <Button variant="danger">Declare default</Button>
            </div>
            <div className="mt-6"><Label>Sizes, icons and states</Label></div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="xs" variant="secondary">xs</Button>
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg" iconEnd={<ArrowIcon />}>Large</Button>
              <Button variant="secondary" icon={<DownloadIcon />}>Download certificate</Button>
              <Button loading>Deposit 40,000 USDG</Button>
              <Button variant="secondary" loading loadingText="Signing…">Sign and submit</Button>
              <Button disabled>Disabled</Button>
              <IconButton label="Download" variant="secondary"><DownloadIcon /></IconButton>
              <LinkButton href="#buttons" variant="ghost" iconEnd={<ArrowIcon />}>Link button</LinkButton>
            </div>
          </Surface>
          <Surface ink>
            <Label>On ink</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Button>Connect wallet</Button>
              <Button variant="inverse">Share</Button>
              <Button variant="inverse" icon={<DownloadIcon />}>Download certificate</Button>
              <Button variant="inverse" loading>Working</Button>
              <IconButton label="Close" variant="inverse"><StateIcon kind="danger" /></IconButton>
            </div>
          </Surface>
        </Block>

        {/* ── BADGES ─────────────────────────────────────────────── */}
        <Block id="badges" title="Badges" description="Short labels for state. Pill for status, square for categories and tags. Colour follows meaning; the dot repeats it for scanning.">
          <Surface>
            <div className="flex flex-wrap items-center gap-2">
              {(["success", "warning", "danger", "info", "neutral", "ink", "signal"] as const).map((v) => <Badge key={v} variant={v} dot>{v}</Badge>)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(["ACTIVE", "PAUSED", "DISPUTED", "SETTLED", "DEFAULTED", "CANCELLED"] as const).map((s) => <StatusPill key={s} status={s} />)}
              <Badge variant="neutral" shape="square" size="sm">Software key</Badge>
              <Badge variant="success" shape="square" size="sm">On-chain registry</Badge>
              <Badge variant="success" dot pulse>Live</Badge>
            </div>
          </Surface>
          <Surface ink>
            <div className="flex flex-wrap items-center gap-2">
              {(["success", "warning", "danger", "info", "neutral", "ink", "signal"] as const).map((v) => <Badge key={v} variant={v} dot onDark>{v}</Badge>)}
              <StatusPill status="SETTLED" onDark />
              <StatusPill status="PAUSED" onDark />
            </div>
          </Surface>
        </Block>

        {/* ── FORMS ──────────────────────────────────────────────── */}
        <Block id="forms" title="Forms" description="Labels above, help below, errors replace help and are announced through aria-describedby. One control height (44px) and radius.">
          <Surface>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Shipment reference" placeholder="CF-2026-SG01-…" help="Your own reference; it is shown to every party." />
              <Field label="Invoice value (USDG)" inputMode="decimal" defaultValue="100000" suffix="USDG" />
              <Field label="Total facility (USDG)" defaultValue="140000" suffix="USDG" error="The facility must not exceed the invoice value." />
              <Field label="Buyer address" placeholder="0x…" disabled help="Disabled until a wallet is connected." />
              <Select label="Sort" defaultValue="new">
                <option value="new">Newest first</option>
                <option value="amount">Largest amount</option>
              </Select>
              <Field label="Search shipments" hideLabel placeholder="Search reference or id" prefix={<svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>} />
              <Textarea label="Resolution reference" optional className="md:col-span-2" placeholder="Case number or a short note" />
            </div>
          </Surface>
        </Block>

        {/* ── NAVIGATION ─────────────────────────────────────────── */}
        <Block id="navigation" title="Tabs and stepper" description="Segmented tabs for filters, underline tabs for page sections; both scroll sideways on phones. The stepper is for wizards only.">
          <Surface>
            <Label>Segmented with counts</Label>
            <Tabs controls={false} idBase="ds-filter-" label="Filter shipments" value={filter} onChange={setFilter} tabs={[{ id: "transit", label: "In transit", count: 3 }, { id: "paused", label: "Paused", count: 1 }, { id: "settled", label: "Settled", count: 12 }, { id: "all", label: "All", count: 16 }]} />
            <div className="mt-6">
              <Label>Underline (page sections)</Label>
              <Tabs controls={false} idBase="ds-section-" variant="underline" label="Shipment sections" value={tab} onChange={setTab} tabs={[{ id: "overview", label: "Overview" }, { id: "evidence", label: "Evidence", count: 7 }, { id: "money", label: "Money" }, { id: "records", label: "Documents & alerts", count: 2 }, { id: "audit", label: "Audit trail", count: 77 }]} />
            </div>
            <div className="mt-6">
              <Label>Small, with a disabled tab</Label>
              <Tabs controls={false} idBase="ds-small-" size="sm" label="Range" value="7d" onChange={() => {}} tabs={[{ id: "24h", label: "24 h" }, { id: "7d", label: "7 days" }, { id: "all", label: "All time", disabled: true }]} />
            </div>
          </Surface>
          <div className="grid gap-4 md:grid-cols-2">
            <Surface>
              <Label>Stepper · horizontal</Label>
              <Stepper current={1} steps={[{ id: "a", label: "Shipment" }, { id: "b", label: "Cold chain" }, { id: "c", label: "Financing" }, { id: "d", label: "Review" }]} />
            </Surface>
            <Surface>
              <Label>Stepper · vertical</Label>
              <Stepper orientation="vertical" current={2} steps={[{ id: "a", label: "Shipment", description: "Reference, buyer, invoice" }, { id: "b", label: "Cold chain", description: "2.0–8.0 °C, two probes" }, { id: "c", label: "Financing", description: "Financier and facility" }]} />
            </Surface>
          </div>
        </Block>

        {/* ── DATA DISPLAY ───────────────────────────────────────── */}
        <Block id="data" title="Data display" description="Stat for one headline number, KeyValue for one record's fields, CopyField for anything people copy or check on the explorer.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Capital drawn" value="24,000" unit="USDG" hint="of 40,000 facility" chart={<Sparkline values={[4, 8, 12, 16, 20, 24]} label="Drawn per milestone, 4,000 to 24,000" area />} />
            <Stat label="Evidence score" value="94" delta={{ value: "+3", direction: "up", context: "since the last batch" }} hint="needs 75+" />
            <Stat label="Sensor conflict" value="1.7" unit="%" delta={{ value: "+0.4 pt", direction: "up", good: false, context: "since the last batch" }} hint="limit 30%" />
            <Stat label="Open requests" value="0" loading />
          </div>
          <Surface ink className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat onDark label="Invoice" value="30" unit="USDG" />
            <Stat onDark label="Financing" value="20" unit="USDG" delta={{ value: "0", direction: "flat" }} hint="fully drawn" />
            <Stat onDark label="Risk" value="4.3" unit="%" chart={<Sparkline values={[6, 5.5, 5, 4.8, 4.3]} tone="paper" />} />
          </Surface>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="What was agreed" description="Fixed at registration" />
              <KeyValue items={[
                { label: "Temperature", value: "2.0 °C to 8.0 °C" },
                { label: "Readings", value: "At least every 30 min, from 2+ probes" },
                { label: "To release money", value: "Evidence score 75+" },
                { label: "Financing fee", value: "3%", numeric: true },
                { label: "Principal back to the financier", value: "20 USDG", numeric: true, hint: "repaid on settlement" },
              ]} />
            </Card>
            <Card>
              <CardHeader title="Parties" />
              <KeyValue layout="grid" columns={2} items={[
                { label: "Exporter", value: <CopyField size="sm" value="0x8e6877a28d51a6c2b1699154cc17f3ebf682102f" chainId={46630} /> },
                { label: "Financier", value: <CopyField size="sm" value="0x2198ab4e7755510a6a94ee298cf70f44e0f86414" chainId={46630} /> },
                { label: "Buyer", value: <CopyField size="sm" value="0x6248101b50364011f12174cdb9d5305faf671d4a" chainId={46630} /> },
                { label: "Created", value: "3 Oct 2026, 12:07 UTC" },
              ]} />
              <div className="mt-5 flex flex-col gap-3">
                <CopyField label="Deployer" value="0xA6C05ec62A222b0fb65BD30B2d2f9B2fd378911b" chainId={46630} display="full" />
                <CopyField label="MCP URL" kind="text" value="https://cargoflow-mcp.adoranto737.workers.dev/mcp" />
              </div>
            </Card>
          </div>
          <Card tone="ink">
            <CardHeader title="On ink" />
            <div className="flex flex-wrap gap-3">
              <CopyField onDark label="exporter" size="sm" value="0x8e6877a28d51a6c2b1699154cc17f3ebf682102f" chainId={46630} />
              <CopyField onDark label="root" size="sm" kind="hash" value="0x1fc4cf00000000000000000000000000000000000000000000000000000c26d" />
            </div>
            <div className="mt-5">
              <KeyValue onDark layout="grid" columns={4} items={[{ label: "Invoice", value: "30 USDG", numeric: true }, { label: "Financing", value: "20 USDG", numeric: true }, { label: "Fee", value: "3%", numeric: true }, { label: "Status", value: <StatusPill status="SETTLED" onDark /> }]} />
            </div>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Surface>
              <Label>Keyboard and tooltip</Label>
              <p className="flex flex-wrap items-center gap-2 text-sm">Find a shipment <Kbd keys={["Ctrl", "K"]} /> · close <Kbd>Esc</Kbd></p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Tooltip content="Needs 75 or more to release the next tranche.">
                  <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border-strong px-3 text-sm font-semibold">Evidence score <span className="grid h-4 w-4 place-items-center rounded-full bg-ink/8 text-[0.625rem]" aria-hidden="true">?</span></button>
                </Tooltip>
                <Tooltip content="Below the button" side="bottom" align="start">
                  <Button size="sm" variant="secondary">Bottom tooltip</Button>
                </Tooltip>
              </div>
            </Surface>
            <Surface>
              <Label>Code</Label>
              <CodeBlock label="Claude Code · remote" code="claude mcp add --transport http cargoflow https://cargoflow-mcp.adoranto737.workers.dev/mcp" />
            </Surface>
          </div>
        </Block>

        {/* ── TABLE ──────────────────────────────────────────────── */}
        <Block id="table" title="Data table" description="Sticky header, numbers right-aligned in tabular figures, whole-row links, sortable columns, loading and empty states. Below 640px each row becomes a card.">
          <Card padded={false} className="overflow-hidden">
            <DataTable<Shipment> caption="Shipments" columns={COLUMNS} rows={SHIPMENTS} rowKey={(r) => r.id} rowHref={() => "#table"} maxHeight="22rem" />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card padded={false} className="overflow-hidden">
              <DataTable<Shipment> caption="Loading shipments" columns={COLUMNS.slice(0, 3)} rows={[]} rowKey={(r) => r.id} loading loadingRows={3} density="compact" />
            </Card>
            <Card padded={false} className="overflow-hidden">
              <DataTable<Shipment>
                caption="Filtered shipments"
                columns={COLUMNS.slice(0, 3)}
                rows={[]}
                rowKey={(r) => r.id}
                empty={<EmptyState frame="plain" size="sm" title="Nothing matches these filters" description="Try another status or clear the search." action={<Button size="sm" variant="secondary">Clear filters</Button>} />}
              />
            </Card>
          </div>
        </Block>

        {/* ── TIMELINE ───────────────────────────────────────────── */}
        <Block id="timeline" title="Timeline" description="Events and milestones with five states. Shape and colour both carry the state; screen readers hear it.">
          <Surface>
            <Label>Horizontal · journey</Label>
            <Timeline orientation="horizontal" label="Journey" items={JOURNEY} showState />
          </Surface>
          <div className="grid gap-4 md:grid-cols-2">
            <Surface>
              <Label>Vertical · milestone releases</Label>
              <Timeline label="Milestone releases" items={JOURNEY.slice(0, 4)} showState />
            </Surface>
            <Surface ink>
              <Label>Vertical on ink</Label>
              <Timeline onDark label="Recovery" showState items={[
                { id: "a", title: "Anomaly detected", state: "done", time: "11:02" },
                { id: "b", title: "Facility paused", state: "held", time: "11:02" },
                { id: "c", title: "Groth16 proof verified on-chain", state: "active", time: "now" },
                { id: "d", title: "Facility resumed", state: "pending" },
              ]} />
            </Surface>
          </div>
        </Block>

        {/* ── FEEDBACK ───────────────────────────────────────────── */}
        <Block id="feedback" title="Feedback" description="Callout for guidance inside content, Banner for a page-wide condition, Toast for something that just happened, EmptyState when a list has nothing, Skeleton while it loads.">
          {banner && (
            <div className="-mx-(--gutter) md:mx-0 md:overflow-hidden md:rounded-tile">
              <Banner variant="warning" live="polite" title="Wrong network" action={<Button size="sm" variant="secondary">Switch network</Button>} onDismiss={() => setBanner(false)}>
                Your wallet is on another chain. Switch to Robinhood Chain Testnet to sign.
              </Banner>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Callout variant="info" title="Designed around MLETR concepts">Exclusive control, singularity, integrity. Not a legal compliance claim.</Callout>
            <Callout variant="success" title="Groth16 proof verified on-chain">Eight hidden readings were proven to sit inside the agreed band.</Callout>
            <Callout variant="warning" title="Facility paused" action={<Button size="sm" variant="secondary">Prepare proof</Button>}>One batch left the 2–8 °C band.</Callout>
            <Callout variant="danger" title="The backend is not reachable" action={<Button size="sm" variant="secondary">Retry</Button>}>Live figures may be out of date.</Callout>
          </div>
          <Surface ink className="flex flex-col gap-3">
            <Callout variant="neutral" onDark>Neutral on ink: raw readings stay private; the chain holds only their fingerprints.</Callout>
            <Callout variant="success" onDark title="Groth16 proof verified on-chain">Facility resumed by zero-knowledge proof.</Callout>
            <Callout variant="warning" onDark title="Paused">Awaiting a recovery proof.</Callout>
            <Callout variant="danger" onDark title="Defaulted">The undrawn capital went back to the financier.</Callout>
          </Surface>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" size="sm" onClick={() => toast({ tone: "verified", title: "Milestone 3 released", body: "4 USDG reached the exporter.", href: "https://explorer.testnet.chain.robinhood.com" })}>Success toast</Button>
            <Button variant="secondary" size="sm" onClick={() => toast({ tone: "alert", title: "Facility paused", body: "A batch left the agreed band.", action: { label: "View evidence", onClick: () => {} } })}>Warning toast</Button>
            <Button variant="secondary" size="sm" onClick={() => toast({ tone: "danger", title: "The PDF could not be created", body: "Try again in a moment." })}>Danger toast</Button>
            <Button variant="secondary" size="sm" onClick={() => toast({ tone: "info", title: "Copied the shipment link" })}>Info toast</Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <EmptyState icon={<BoxIcon />} title="No open requests right now" description="When an exporter posts a registered shipment for financing, it appears here for every financier to price." action={<Button variant="secondary">Post a shipment</Button>} />
            <Surface>
              <Label>Skeleton</Label>
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1"><SkeletonText lines={2} /></div>
              </div>
              <Skeleton className="mt-5 h-24 w-full rounded-tile" />
              <SkeletonText className="mt-4" lines={3} />
            </Surface>
          </div>
        </Block>

        {/* ── OVERLAYS ───────────────────────────────────────────── */}
        <Block id="overlays" title="Overlays" description="Modal for a blocking decision, Drawer for detail beside the page, Sheet for phone pickers. Focus is trapped and returns to the trigger; Escape closes.">
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setModal(true)}>Open modal</Button>
            <Button variant="secondary" onClick={() => setDrawer(true)}>Open drawer</Button>
            <Button variant="secondary" onClick={() => setSheet(true)}>Open sheet</Button>
          </div>
          <Modal
            open={modal}
            onClose={() => setModal(false)}
            title="Close this request?"
            description="Financiers will no longer see it or be able to offer. The shipment itself is unaffected."
            size="sm"
            footer={<><Button variant="secondary" onClick={() => setModal(false)}>Keep it open</Button><Button variant="danger" onClick={() => setModal(false)}>Close request</Button></>}
          >
            <Callout variant="warning">This cannot be undone.</Callout>
          </Modal>
          <Drawer open={drawer} onClose={() => setDrawer(false)} title="CF-2026-SG01-0142" description="In transit · milestone 4 of 5" footer={<Button onClick={() => setDrawer(false)}>Open dashboard</Button>}>
            <KeyValue items={[{ label: "Drawn", value: "24,000 USDG", numeric: true }, { label: "Evidence score", value: "94", numeric: true }, { label: "Next to act", value: "Monitor" }]} />
            <div className="mt-6"><Timeline label="Journey" items={JOURNEY.slice(0, 4)} showState /></div>
          </Drawer>
          <Sheet open={sheet} onClose={() => setSheet(false)} title="Choose a wallet">
            <div className="flex flex-col gap-2">
              {["Browser wallet", "Passkey", "Email"].map((w) => <Button key={w} variant="secondary" className="w-full justify-start" onClick={() => setSheet(false)}>{w}</Button>)}
            </div>
          </Sheet>
        </Block>

        {/* ── TEMPLATES ──────────────────────────────────────────── */}
        <Block id="templates" title="Page templates" description="Three shapes cover every page: an app page header, a two-column detail and a dashboard grid. Full rules in docs/design/system.md.">
          <div className="rounded-sheet border border-dashed border-border-strong p-4 md:p-6">
            <Label>1 · App page header</Label>
            <PageHeader
              className="mb-0 md:mb-0"
              eyebrow="Financing market"
              title="Fund cargo that proves itself"
              description="Exporters post registered shipments with a locked cold-chain policy. Financiers offer a fee."
              actions={<><Button variant="secondary">How it works</Button><Button>Request financing</Button></>}
            />
          </div>
          <div className="rounded-sheet border border-dashed border-border-strong p-4 md:p-6">
            <Label>2 · Two-column detail (8 / 4 from lg)</Label>
            <div className="grid gap-4 lg:grid-cols-12">
              <div className="flex flex-col gap-4 lg:col-span-8">
                <Card><CardHeader title="Where it stands" /><SkeletonText lines={3} /></Card>
                <Card><CardHeader title="Route and position" /><Skeleton className="h-40 w-full rounded-tile" /></Card>
              </div>
              <div className="flex flex-col gap-4 lg:col-span-4">
                <Card><CardHeader title="Evidence" /><SkeletonText lines={4} /></Card>
                <Card><CardHeader title="What was agreed" /><SkeletonText lines={3} /></Card>
              </div>
            </div>
          </div>
          <div className="rounded-sheet border border-dashed border-border-strong p-4 md:p-6">
            <Label>3 · Dashboard grid</Label>
            <Section title="Fleet" description="Stats across the top, the main table below, at most one aside." actions={<Button size="sm">Finance a new shipment</Button>}>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="In transit" value="3" />
                <Stat label="Paused" value="1" />
                <Stat label="Capital drawn" value="44,750" unit="USDG" />
                <Stat label="Average evidence" value="81.8" />
              </div>
            </Section>
          </div>
        </Block>
      </div>
    </div>
  );
}
