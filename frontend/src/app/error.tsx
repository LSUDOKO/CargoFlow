"use client";

import { Button, LinkButton } from "@/components/ui/Button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container-page grid min-h-[60vh] place-items-center py-20 text-center">
      <div>
        <h1 className="font-display text-4xl font-bold">Something on this page failed to load</h1>
        <p className="mx-auto mt-4 max-w-md text-slate">{error.message || "An unexpected error occurred."} Nothing on-chain was changed.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <LinkButton href="/" variant="secondary">Back to home</LinkButton>
        </div>
      </div>
    </div>
  );
}
