"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { Drawer } from "@/components/ui/Drawer";
import { cx } from "@/components/ui/cx";
import { WalletButton } from "@/components/wallet/WalletButton";
import { CommandSearch } from "./CommandSearch";
import { HealthPill } from "./HealthPill";

export const nav = [
  { href: "/shipments", label: "Fleet" },
  { href: "/exporter", label: "Exporters" },
  { href: "/financier", label: "Financiers" },
  { href: "/buyer", label: "Buyers" },
  { href: "/demo", label: "Live demo" },
];

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
    <header className={cx("sticky top-0 z-40 transition-[background,box-shadow] duration-200", scrolled ? "bg-paper/85 shadow-[0_1px_0_var(--color-line)] backdrop-blur-md" : "bg-paper")}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-signal focus:px-3 focus:py-2 focus:font-semibold">
        Skip to content
      </a>
      <div className="container-page flex h-[4.5rem] items-center gap-6">
        <Link href="/" aria-label="CargoFlow home" className="shrink-0">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {nav.map((n) => {
            const active = path === n.href || path.startsWith(`${n.href}/`);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cx("rounded-full px-3.5 py-2 text-[0.95rem] font-semibold transition-colors", active ? "bg-ink text-paper" : "text-ink/75 hover:bg-ink/5 hover:text-ink")}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          <div className="hidden sm:block">
            <HealthPill />
          </div>
          <CommandSearch />
          <div className="hidden sm:block">
            <WalletButton compact />
          </div>
          <button
            type="button"
            onClick={() => setMenu(true)}
            className="grid h-11 w-11 place-items-center rounded-full border-2 border-ink lg:hidden"
            aria-label="Open menu"
            aria-expanded={menu}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <Drawer open={menu} onClose={() => setMenu(false)} title="Menu">
        <nav aria-label="Mobile" className="flex flex-col gap-1">
          <Link href="/" onClick={() => setMenu(false)} className="rounded-2xl px-4 py-3 font-display text-xl font-semibold hover:bg-ink/5">Home</Link>
          {nav.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setMenu(false)} className="rounded-2xl px-4 py-3 font-display text-xl font-semibold hover:bg-ink/5">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-6 flex flex-col items-start gap-3 border-t border-line pt-6">
          <HealthPill />
          <WalletButton />
        </div>
      </Drawer>
    </header>
  );
}
