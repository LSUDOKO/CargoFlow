"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api/client";

// Scalar's standalone API reference (MIT), loaded from jsDelivr only on this page so the app bundle stays small.
const SCALAR_SRC = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.4/dist/browser/standalone.js";

type ScalarGlobal = { createApiReference: (el: Element | string, config: Record<string, unknown>) => { destroy?: () => void } };

/** Brand theme for Scalar: light only, navy text and accents, lime highlights. */
const BRAND_CSS = `
.light-mode, .scalar-app, :root {
  --scalar-color-1: #0b1b2b;
  --scalar-color-2: #3e4f60;
  --scalar-color-3: #5b6b7b;
  --scalar-color-accent: #0b1b2b;
  --scalar-background-1: #f7f9f4;
  --scalar-background-2: #eef2ea;
  --scalar-background-3: #e4eadf;
  --scalar-background-accent: #c6f43233;
  --scalar-border-color: #dce3da;
  --scalar-button-1: #0b1b2b;
  --scalar-button-1-color: #f7f9f4;
  --scalar-button-1-hover: #13293d;
  --scalar-color-green: #00a35a;
  --scalar-color-red: #c8323a;
  --scalar-color-yellow: #b37400;
  --scalar-color-blue: #1d5fa8;
  --scalar-color-orange: #c26a00;
  --scalar-color-purple: #6941c6;
  --scalar-font: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --scalar-font-code: var(--font-jetbrains), ui-monospace, monospace;
  --scalar-radius: 10px;
  --scalar-radius-lg: 16px;
  --scalar-custom-header-height: 72px;
}
.scalar-app .sidebar { --scalar-sidebar-background-1: #f7f9f4; --scalar-sidebar-item-active-background: #c6f43255; --scalar-sidebar-color-active: #0b1b2b; }
.scalar-app h1, .scalar-app h2, .scalar-app h3 { font-family: var(--font-space-grotesk), var(--scalar-font); }
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
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-5 py-6 text-sm text-slate" role="status">
          <span className="h-2.5 w-2.5 animate-pulse-dot rounded-full bg-ink" aria-hidden="true" />
          Loading the API reference…
        </div>
      )}
      {state.status === "error" && (
        <p role="alert" className="rounded-2xl bg-danger/8 px-5 py-4 text-sm font-medium text-[#a1191e]">
          {state.message} The raw specification is at <a className="underline" href="/openapi.json">/openapi.json</a>.
        </p>
      )}
      {state.status === "ready" && state.source === "bundled" && (
        <p className="mb-3 rounded-xl bg-alert/12 px-4 py-2 text-sm">The live API did not answer, so this shows the specification bundled with the site. It may trail the live API slightly.</p>
      )}
      <div ref={ref} className="scalar-host min-h-[60vh] overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper" />
    </div>
  );
}
