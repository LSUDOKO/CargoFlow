import { LinkButton } from "@/components/ui/Button";

// a stack of containers, bottom row first; none in lime so they stand out on the lime band
const stack = [
  ["bg-ink", "bg-[#0E6E8C]", "bg-alert", "bg-ink"],
  ["bg-verified", "bg-ink", "bg-[#0E6E8C]"],
  ["bg-alert", "bg-ink"],
];

export function ClosingBand() {
  return (
    <section aria-labelledby="close-title" className="container-page mt-24 md:mt-32">
      <div className="relative overflow-hidden rounded-[2rem] bg-signal px-6 py-14 md:rounded-[2.5rem] md:px-14 md:py-20">
        <div className="relative z-10 max-w-2xl xl:max-w-[34rem]">
          <h2 id="close-title" className="font-display text-[clamp(2.4rem,5.4vw,4.4rem)] leading-[0.98] font-bold tracking-[-0.045em] text-ink">
            Put your next shipment on evidence
          </h2>
          <p className="mt-5 max-w-lg text-lg text-ink/80">
            Open a facility as the exporter, have your financier fund it from their own wallet, and let the cargo&apos;s readings decide every release.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/exporter" size="lg" variant="dark">Start as an exporter</LinkButton>
            <LinkButton href="/shipments" size="lg" variant="secondary">Browse the fleet</LinkButton>
          </div>
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute right-10 bottom-0 hidden flex-col-reverse items-end gap-1.5 xl:flex xl:right-14">
          {stack.map((row, r) => (
            <div key={r} className="flex gap-1.5">
              {row.map((c, i) => (
                <span key={i} className={`relative h-14 w-28 rounded-md ${c} lg:h-16 lg:w-32`}>
                  <span className="absolute inset-y-2 left-3 flex gap-2">
                    {[0, 1, 2, 3, 4].map((k) => <span key={k} className="w-1 rounded-full bg-white/18" />)}
                  </span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
