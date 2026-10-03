"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * Whether the page URL carries `?<name>=1` (or `true`). Read from window.location (empty during the server render),
 * so a client component can use it without a Suspense boundary, which useSearchParams would need on static pages.
 */
export function useSearchFlag(name: string): boolean {
  const search = useSyncExternalStore(noop, () => window.location.search, () => "");
  const v = new URLSearchParams(search).get(name);
  return v === "1" || v === "true";
}
