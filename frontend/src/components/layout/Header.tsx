"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { Drawer } from "@/components/ui/Drawer";
import { cx } from "@/components/ui/cx";
import { WalletButton } from "@/components/wallet/WalletButton";
import { CommandSearch } from "./CommandSearch";
import { HealthPill } from "./HealthPill";
import { NotificationBell } from "./NotificationBell";

/** Top-level destinations, always visible. */
export const primaryNav = [
  { href: "/shipments", label: "Fleet" },
  { href: "/market", label: "Market" },
];

/** The developer surfaces, grouped under "Developers". */
export const developerLinks = [
  { href: "/docs", label: "API reference", blurb: "Interactive OpenAPI reference and signing recipes" },
  { href: "/developers", label: "SDKs and tools", blurb: "TypeScript, Python, the gateway agent" },
  { href: "/developers#claude", label: "Use with Claude", blurb: "Add CargoFlow as a connector (MCP)" },
  { href: "/deployments", label: "Deployments", blurb: "Contracts with verified source, live services" },
];

/** One portal per role, grouped under "Portals" so the bar stays calm from 1024 px up. */
export const portals = [
  { href: "/exporter", label: "Exporters", blurb: "Register cargo and raise capital" },
  { href: "/financier", label: "Financiers", blurb: "Fund facilities, track your portfolio" },
  { href: "/buyer", label: "Buyers", blurb: "Confirm delivery and pay once" },
  { href: "/arbiter", label: "Arbiters", blurb: "Resolve disputes and defaults" },
  { href: "/ebl", label: "Carriers", blurb: "Issue and endorse bills of lading" },
];

export const nav = [...primaryNav, ...portals.map(({ href, label }) => ({ href, label })), { href: "/developers", label: "Developers" }];

const isActive = (path: string, href: string) => {
  const h = href.split("#")[0]!;
  return path === h || path.startsWith(`${h}/`);
};
const pill = (active: boolean) =>
  cx("inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[0.9375rem] font-semibold whitespace-nowrap transition-colors", active ? "bg-paper/12 text-paper" : "text-paper/70 hover:bg-paper/8 hover:text-paper");

export function Header() {
  const path = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <>
      <header className={cx("sticky top-0 z-40 bg-ink text-paper transition-shadow duration-200", scrolled && "shadow-[0_8px_24px_-12px_rgb(11_27_43/0.6)]")}>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-signal focus:px-3 focus:py-2 focus:font-semibold">
          Skip to content
        </a>
        <div className="surface-ink container-page flex h-[4.5rem] items-center gap-4 lg:gap-6">
          <Link href="/" aria-label="CargoFlow home" className="shrink-0">
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {primaryNav.map((n) => {
              const active = isActive(path, n.href);
              return (
                <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={pill(active)}>
                  {n.label}
                </Link>
              );
            })}
            <NavMenu path={path} title="Portals" items={portals} />
            <NavMenu path={path} title="Developers" items={developerLinks} keepTitle />
          </nav>
          <div className="ml-auto flex items-center gap-2.5">
            <div className="hidden sm:block">
              <HealthPill />
            </div>
            <CommandSearch />
            <NotificationBell />
            <div className="hidden sm:block">
              <WalletButton compact onDark />
            </div>
            <button
              type="button"
              onClick={() => setMenu(true)}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-paper/35 text-paper transition-colors hover:border-paper/70 hover:bg-paper/8 lg:hidden"
              aria-label="Open menu"
              aria-expanded={menu}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      {/* outside the navy header, so the drawer's text takes the page's ink colour rather than the header's paper */}
      <Drawer open={menu} onClose={() => setMenu(false)} title="Menu">
        <div className="mb-4"><Logo tone="light" className="h-8 w-auto" /></div>
        <nav aria-label="Mobile" className="flex flex-col gap-1">
          <Link href="/" onClick={() => setMenu(false)} className="rounded-2xl px-4 py-3 font-display text-xl font-semibold hover:bg-ink/5">Home</Link>
          {primaryNav.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setMenu(false)} aria-current={isActive(path, n.href) ? "page" : undefined} className="rounded-2xl px-4 py-3 font-display text-xl font-semibold hover:bg-ink/5 aria-[current=page]:bg-ink/6">
              {n.label}
            </Link>
          ))}
          <p className="mt-4 px-4 pb-1 text-xs font-semibold tracking-wide text-slate uppercase">Portals</p>
          {portals.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setMenu(false)} aria-current={isActive(path, n.href) ? "page" : undefined} className="rounded-2xl px-4 py-2.5 hover:bg-ink/5 aria-[current=page]:bg-ink/6">
              <span className="block font-display text-lg font-semibold">{n.label}</span>
              <span className="block text-sm text-slate">{n.blurb}</span>
            </Link>
          ))}
          <p className="mt-4 px-4 pb-1 text-xs font-semibold tracking-wide text-slate uppercase">Developers</p>
          {developerLinks.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setMenu(false)} className="rounded-2xl px-4 py-2.5 hover:bg-ink/5">
              <span className="block font-display text-lg font-semibold">{n.label}</span>
              <span className="block text-sm text-slate">{n.blurb}</span>
            </Link>
          ))}
        </nav>
        <div className="mt-6 flex flex-col items-start gap-3 border-t border-line pt-6">
          <HealthPill />
          <WalletButton />
        </div>
      </Drawer>
    </>
  );
}

/** A disclosure (not an ARIA menu): a button that shows a group of destinations as ordinary links. */
function NavMenu({ path, title, items, keepTitle }: { path: string; title: string; items: { href: string; label: string; blurb: string }[]; keepTitle?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const active = items.some((p) => isActive(path, p.href));
  const current = keepTitle ? undefined : items.find((p) => isActive(path, p.href));
  // close when the route changes (a link was followed) without an effect-driven state cascade
  const [seenPath, setSeenPath] = useState(path);
  if (seenPath !== path) {
    setSeenPath(path);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button ref={btn} type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className={pill(active || open)}>
        {current ? current.label : title}
        <svg viewBox="0 0 12 12" className={cx("h-3 w-3 transition-transform duration-150", open && "rotate-180")} aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div
        id={id}
        hidden={!open}
        className="surface-light absolute top-[calc(100%+0.5rem)] left-0 z-50 w-80 animate-fade rounded-2xl border border-line bg-white p-2 text-ink shadow-[var(--shadow-lift)]"
      >
        <p className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-slate uppercase">{title}</p>
        <ul>
          {items.map((p) => {
            const on = isActive(path, p.href) && !p.href.includes("#");
            return (
              <li key={p.href}>
                <Link href={p.href} aria-current={on ? "page" : undefined} onClick={() => setOpen(false)} className={cx("flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors", on ? "bg-ink/6" : "hover:bg-ink/5")}>
                  <span className={cx("h-2 w-2 shrink-0 rounded-full", on ? "bg-signal ring-2 ring-ink" : "bg-ink/15")} aria-hidden="true" />
                  <span>
                    <span className="block font-semibold">{p.label}</span>
                    <span className="block text-sm text-slate">{p.blurb}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
