import { LinkButton } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="container-page grid min-h-[60vh] place-items-center py-20 text-center">
      <div className="max-w-lg">
        <p className="num font-mono text-small text-text-muted">404</p>
        <h1 className="mt-3 font-display text-h1">This page went overboard</h1>
        <p className="mx-auto mt-4 max-w-md text-body-lg text-text-muted">The address doesn&apos;t match any page. Shipments live under the fleet view.</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <LinkButton href="/" variant="ink">Back to home</LinkButton>
          <LinkButton href="/shipments" variant="secondary">Open the fleet</LinkButton>
        </div>
      </div>
    </div>
  );
}
