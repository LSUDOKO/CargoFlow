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

/** Top-level destinations, always visible from lg. */
export const primaryNav = [
  { href: "/shipments", label: "Fleet" },
  { href: "/market", label: "Market" },
];

type NavItem = { href: string; label: string; blurb: string; icon: string };

/** The developer surfaces, grouped under "Developers". */
export const developerLinks: NavItem[] = [
  { href: "/docs", label: "API reference", blurb: "Interactive OpenAPI reference and signing recipes", icon: "M5 4h10l4 4v12H5zM14 4v5h5M8.5 13h7M8.5 16.5h5" },
  { href: "/developers", label: "SDKs and tools", blurb: "TypeScript, Python, the gateway agent", icon: "m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5.5l-3 13" },
  { href: "/developers#claude", label: "Use with Claude", blurb: "Add CargoFlow as a connector (MCP)", icon: "M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.8 2.8M15.2 15.2 18 18M6 18l2.8-2.8M15.2 8.8 18 6" },
  { href: "/deployments", label: "Deployments", blurb: "Contracts with verified source, live services", icon: "M12 3.5 19.5 7.5v9L12 20.5 4.5 16.5v-9zM4.5 7.5 12 11.5l7.5-4M12 11.5v9" },
];

/** One portal per role, grouped under "Portals" so the bar stays calm from 1024 px up. */
export const portals: NavItem[] = [
  { href: "/exporter", label: "Exporters", blurb: "Register cargo and raise capital", icon: "M4 8h12l4 4v5h-2.5M4 8v9h2.5M9.5 17h5M4 8l2-3h8l2 3" },
  { href: "/financier", label: "Financiers", blurb: "Fund facilities, track your portfolio", icon: "M4 19.5h16M6 16.5V10M10 16.5V10M14 16.5V10M18 16.5V10M3.5 8 12 3.5 20.5 8z" },
  { href: "/buyer", label: "Buyers", blurb: "Confirm delivery and pay once", icon: "M5 12.5 9.5 17 19 7.5" },
  { href: "/arbiter", label: "Arbiters", blurb: "Resolve disputes and defaults", icon: "M12 4v16M7 20h10M5 7.5h14M5 7.5 2.5 13a2.5 2.5 0 0 0 5 0zM19 7.5 16.5 13a2.5 2.5 0 0 0 5 0z" },
  { href: "/ebl", label: "Carriers", blurb: "Issue and endorse bills of lading", icon: "M3.5 15h17l-2 4.5h-13zM6 15V9.5h12V15M10 9.5V6h4v3.5" },
];

export const nav = [...primaryNav, ...portals.map(({ href, label }) => ({ href, label })), { href: "/developers", label: "Developers" }];

const isActive = (path: string, href: string) => {
  const h = href.split("#")[0]!;
  return path === h || path.startsWith(`${h}/`);
};
const pill = (active: boolean) =>
  cx(
    "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-small font-semibold whitespace-nowrap",
    "transition-colors duration-(--duration-fast) ease-standard",
    active ? "bg-paper/12 text-paper" : "text-paper/75 hover:bg-paper/8 hover:text-paper",
  );

function Glyph({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx("h-[1.125rem] w-[1.125rem] shrink-0", className)} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/**
 * The global header. Widths are budgeted so it never overflows: below lg it is logo + search + bell + wallet (sm+)
 * + menu; the network chip only shows from xl (short label) and lives in the mobile drawer otherwise.
 */
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
  const close = () => setMenu(false);
  return (
    <>
      <header
        className={cx(
          "sticky top-0 z-(--z-header) border-b bg-ink text-paper transition-[border-color,box-shadow] duration-(--duration-base) ease-standard",
          scrolled ? "border-paper/10 shadow-2" : "border-transparent",
        )}
      >
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-(--z-overlay) focus:rounded-control focus:bg-signal focus:px-3 focus:py-2 focus:font-semibold focus:text-ink">
          Skip to content
        </a>
        <div className="surface-ink container-page flex h-16 items-center gap-3 lg:gap-6">
          <Link href="/" aria-label="CargoFlow home" className="-ml-1 shrink-0 rounded-control p-1">
            <Logo className="h-8 w-auto" />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-0.5 lg:flex">
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
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <div className="hidden xl:block">
              <HealthPill onDark short />
            </div>
            <CommandSearch />
            <NotificationBell />
            <div className="hidden sm:block">
              <WalletButton compact onDark />
            </div>
            <button
              type="button"
              onClick={() => setMenu(true)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-paper/85 ring-1 ring-paper/15 ring-inset transition-colors duration-(--duration-fast) ease-standard hover:bg-paper/8 hover:text-paper hover:ring-paper/30 lg:hidden"
              aria-label="Open menu"
              aria-expanded={menu}
              aria-haspopup="dialog"
            >
              <svg viewBox="0 0 20 20" className="h-[1.125rem] w-[1.125rem]" aria-hidden="true">
                <path d="M3.5 6.5h13M3.5 13.5h13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      {/* outside the navy header, so the drawer's text takes the page's ink colour rather than the header's paper */}
      <Drawer open={menu} onClose={close} title="Menu">
        <nav aria-label="Mobile" className="flex flex-col">
          <ul className="flex flex-col gap-0.5">
            {[{ href: "/", label: "Home" }, ...primaryNav].map((n) => {
              const on = n.href === "/" ? path === "/" : isActive(path, n.href);
              return (
                <li key={n.href}>
                  <Link href={n.href} onClick={close} aria-current={on ? "page" : undefined} className="flex h-12 items-center rounded-control px-3 font-display text-h3 transition-colors hover:bg-ink/5 aria-[current=page]:bg-ink/6">
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <DrawerGroup title="Portals" items={portals} path={path} onNavigate={close} />
          <DrawerGroup title="Developers" items={developerLinks} path={path} onNavigate={close} />
        </nav>
        <div className="mt-6 flex flex-col items-start gap-3 border-t border-border pt-5">
          <HealthPill />
          <WalletButton />
        </div>
      </Drawer>
    </>
  );
}

function DrawerGroup({ title, items, path, onNavigate }: { title: string; items: NavItem[]; path: string; onNavigate: () => void }) {
  return (
    <div className="mt-5">
      <p className="eyebrow px-3 pb-1.5">{title}</p>
      <ul className="flex flex-col gap-0.5">
        {items.map((n) => {
          const on = isActive(path, n.href) && !n.href.includes("#");
          return (
            <li key={n.href}>
              <Link href={n.href} onClick={onNavigate} aria-current={on ? "page" : undefined} className="flex items-center gap-3 rounded-control px-3 py-2.5 transition-colors hover:bg-ink/5 aria-[current=page]:bg-ink/6">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-surface text-ink ring-1 ring-border ring-inset">
                  <Glyph d={n.icon} />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{n.label}</span>
                  <span className="block text-small text-text-muted">{n.blurb}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A disclosure (not an ARIA menu): a button that shows a group of destinations as ordinary links. */
function NavMenu({ path, title, items, keepTitle }: { path: string; title: string; items: NavItem[]; keepTitle?: boolean }) {
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
        <svg viewBox="0 0 12 12" className={cx("h-3 w-3 opacity-70 transition-transform duration-(--duration-fast) ease-standard", open && "rotate-180")} aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div
        id={id}
        hidden={!open}
        className="surface-light absolute top-[calc(100%+0.625rem)] left-0 z-(--z-overlay) w-[22rem] animate-enter rounded-card border border-border bg-surface p-2 text-ink shadow-3"
      >
        <p className="eyebrow px-3 pt-2 pb-1.5">{title}</p>
        <ul>
          {items.map((p) => {
            const on = isActive(path, p.href) && !p.href.includes("#");
            return (
              <li key={p.href}>
                <Link
                  href={p.href}
                  aria-current={on ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cx("group flex items-start gap-3 rounded-control px-3 py-2.5 transition-colors duration-(--duration-fast)", on ? "bg-ink/6" : "hover:bg-ink/5")}
                >
                  <span className={cx("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-chip ring-1 ring-inset transition-colors", on ? "bg-ink text-signal ring-ink" : "bg-paper text-ink ring-border group-hover:ring-border-strong")}>
                    <Glyph d={p.icon} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-small font-semibold">{p.label}</span>
                    <span className="block text-small text-text-muted">{p.blurb}</span>
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
