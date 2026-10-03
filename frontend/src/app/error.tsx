"use client";

import { Button, LinkButton } from "@/components/ui/Button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container-page grid min-h-[60vh] place-items-center py-20 text-center">
      <div className="max-w-lg" role="alert">
        <h1 className="font-display text-h1">Something on this page failed to load</h1>
        <p className="mx-auto mt-4 max-w-md text-body-lg text-text-muted">{error.message || "An unexpected error occurred."} Nothing on-chain was changed.</p>
        {error.digest && <p className="mt-2 font-mono text-caption text-text-muted">Reference {error.digest}</p>}
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button variant="ink" onClick={reset}>Try again</Button>
          <LinkButton href="/" variant="secondary">Back to home</LinkButton>
        </div>
      </div>
    </div>
  );
}
