import { LinkButton } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="container-page grid min-h-[60vh] place-items-center py-20 text-center">
      <div>
        <p className="font-mono text-sm text-slate">404</p>
        <h1 className="mt-3 font-display text-5xl font-bold">This page went overboard</h1>
        <p className="mx-auto mt-4 max-w-md text-lg text-slate">The address doesn&apos;t match any page. Shipments live under the fleet view.</p>
        <div className="mt-8 flex justify-center gap-3">
          <LinkButton href="/">Back to home</LinkButton>
          <LinkButton href="/shipments" variant="secondary">Open the fleet</LinkButton>
        </div>
      </div>
    </div>
  );
}
