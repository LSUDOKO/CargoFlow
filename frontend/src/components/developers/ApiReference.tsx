"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api/client";

// Scalar's standalone API reference (MIT), loaded from jsDelivr only on this page so the app bundle stays small.
const SCALAR_SRC = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.4/dist/browser/standalone.js";

type ScalarGlobal = { createApiReference: (el: Element | string, config: Record<string, unknown>) => { destroy?: () => void } };

/**
 * Brand theme for Scalar, written against the design-system tokens (globals.css) so the reference shares the site's
 * fonts, radii, greys and focus colour instead of bringing its own. Scalar renders into this document, so the CSS
 * variables resolve. HTTP method colours use the darker "-fg" tones so they pass 4.5:1 on paper.
 */
const BRAND_CSS = `
.light-mode, .scalar-app, :root {
  --scalar-color-1: var(--color-text);
  --scalar-color-2: var(--color-neutral-600);
  --scalar-color-3: var(--color-text-muted);
  --scalar-color-accent: var(--color-ink);
  --scalar-color-ghost: var(--color-neutral-400);
  --scalar-background-1: var(--color-surface);
  --scalar-background-2: var(--color-paper);
  --scalar-background-3: var(--color-neutral-100);
  --scalar-background-4: var(--color-neutral-150);
  --scalar-background-accent: var(--color-signal-soft);
  --scalar-border-color: var(--color-border);
  --scalar-button-1: var(--color-ink);
  --scalar-button-1-color: var(--color-paper);
  --scalar-button-1-hover: var(--color-ink-800);
  --scalar-color-green: var(--color-success-fg);
  --scalar-color-red: var(--color-danger-fg);
  --scalar-color-yellow: var(--color-warning-fg);
  --scalar-color-blue: var(--color-info-fg);
  --scalar-color-orange: var(--color-warning-fg);
  --scalar-color-purple: #5b3aa8;
  --scalar-link-color: var(--color-ink);
  --scalar-font: var(--font-sans);
  --scalar-font-code: var(--font-mono);
  --scalar-radius: var(--radius-chip);
  --scalar-radius-lg: var(--radius-control);
  --scalar-radius-xl: var(--radius-card);
  --scalar-shadow-1: var(--shadow-1);
  --scalar-shadow-2: var(--shadow-2);
  /* no Scalar header row: the reference sits inside the page, under the site header */
  --scalar-custom-header-height: 0px;
  --scalar-sidebar-background-1: var(--color-paper);
  --scalar-sidebar-color-1: var(--color-text);
  --scalar-sidebar-color-2: var(--color-text-muted);
  --scalar-sidebar-border-color: var(--color-border);
  --scalar-sidebar-item-hover-background: var(--color-neutral-100);
  --scalar-sidebar-item-active-background: var(--color-signal-soft);
  --scalar-sidebar-color-active: var(--color-ink);
  --scalar-sidebar-search-background: var(--color-surface);
  --scalar-sidebar-search-border-color: var(--color-border-strong);
}
.scalar-app h1, .scalar-app h2, .scalar-app h3 { font-family: var(--font-display); letter-spacing: -0.02em; }
.scalar-app :focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
/* the sidebar sticks below the 64px site header */
.scalar-app .t-doc__sidebar { top: 64px; height: calc(100dvh - 64px); max-height: calc(100dvh - 64px); }
`;

let loading: Promise<ScalarGlobal> | null = null;
function loadScalar(): Promise<ScalarGlobal> {
  const w = window as unknown as { Scalar?: ScalarGlobal };
  if (w.Scalar) return Promise.resolve(w.Scalar);
  loading ??= new Promise<ScalarGlobal>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCALAR_SRC;
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onload = () => (w.Scalar ? resolve(w.Scalar) : reject(new Error("Scalar did not load")));
    s.onerror = () => {
      loading = null;
      reject(new Error("Scalar could not be downloaded"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** The live spec when the API answers within a few seconds, otherwise the copy bundled at build time. */
async function loadSpec(): Promise<{ spec: unknown; source: "live" | "bundled" }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`${API_URL}/v1/openapi.json`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (res.ok) return { spec: await res.json(), source: "live" };
  } catch {
    /* fall back */
  }
  const res = await fetch("/openapi.json", { cache: "force-cache" });
  if (!res.ok) throw new Error("No API specification is available.");
  return { spec: await res.json(), source: "bundled" };
}

export function ApiReference({ serverUrl }: { serverUrl: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; source: "live" | "bundled" } | { status: "error"; message: string }>({ status: "loading" });

  useEffect(() => {
    let live = true;
    let instance: { destroy?: () => void } | undefined;
    void (async () => {
      try {
        const [{ spec, source }, Scalar] = await Promise.all([loadSpec(), loadScalar()]);
        if (!live || !ref.current) return;
        // "try it" goes to the API this site talks to
        const content = { ...(spec as Record<string, unknown>), servers: [{ url: serverUrl, description: "CargoFlow API" }] };
        instance = Scalar.createApiReference(ref.current, {
          content,
          theme: "none",
          customCss: BRAND_CSS,
          forceDarkModeState: "light",
          hideDarkModeToggle: true,
          withDefaultFonts: false,
          hideClientButton: false,
          showDeveloperTools: "never",
          showSidebar: true,
          layout: "modern",
          defaultHttpClient: { targetKey: "js", clientKey: "fetch" },
          metaData: { title: "CargoFlow API reference" },
        });
        setState({ status: "ready", source });
      } catch (err) {
        if (live) setState({ status: "error", message: err instanceof Error ? err.message : "The reference could not load." });
      }
    })();
    return () => {
      live = false;
      instance?.destroy?.();
    };
  }, [serverUrl]);

  return (
    <div>
      {state.status === "loading" && (
        <div className="flex items-center gap-3 rounded-card border border-border bg-surface px-5 py-6 text-small text-text-muted" role="status">
          <span className="h-2.5 w-2.5 animate-pulse-dot rounded-full bg-ink" aria-hidden="true" />
          Loading the API reference…
        </div>
      )}
      {state.status === "error" && (
        <p role="alert" className="rounded-tile border border-danger-border bg-danger-bg px-5 py-4 text-small font-medium text-danger-fg">
          {state.message} The raw specification is at <a className="underline" href="/openapi.json">/openapi.json</a>.
        </p>
      )}
      {state.status === "ready" && state.source === "bundled" && (
        <p className="mb-3 rounded-tile border border-warning-border bg-warning-bg px-4 py-2 text-small text-warning-fg">The live API did not answer, so this shows the specification bundled with the site. It may trail the live API slightly.</p>
      )}
      <div ref={ref} className="scalar-host min-h-[60vh] overflow-clip rounded-card border border-border bg-surface shadow-1" />
    </div>
  );
}
