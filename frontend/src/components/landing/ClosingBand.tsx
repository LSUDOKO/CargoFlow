import { LinkButton } from "@/components/ui/Button";

// a container stack, bottom row first, drawn in outline; the one financed box is lime
const stack = [
  [false, false, true, false],
  [false, false, false],
  [false, false],
];

export function ClosingBand() {
  return (
    <section aria-labelledby="close-title" className="container-page mt-24 md:mt-32">
      <div className="surface-ink relative overflow-hidden rounded-[2rem] bg-ink px-6 py-14 text-paper md:rounded-[2.5rem] md:px-14 md:py-20">
        <div className="relative z-10 max-w-2xl xl:max-w-[36rem]">
          <h2 id="close-title" className="h-section">Put your next shipment on evidence</h2>
          <p className="lede mt-5 text-paper/75">
            Open a facility as the exporter, have your financier fund it from their own wallet, and let the cargo&apos;s readings decide every release.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/exporter" size="lg">Start as an exporter</LinkButton>
            <LinkButton href="/shipments" size="lg" variant="inverse">Browse the fleet</LinkButton>
          </div>
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute right-10 bottom-0 hidden flex-col-reverse items-end gap-1.5 xl:flex xl:right-14">
          {stack.map((row, r) => (
            <div key={r} className="flex gap-1.5">
              {row.map((lit, i) => (
                <span key={i} className={`relative h-14 w-28 rounded-md border lg:h-16 lg:w-32 ${lit ? "border-signal bg-signal" : "border-paper/20 bg-ink-2"}`}>
                  <span className="absolute inset-y-2.5 left-3 flex gap-2">
                    {[0, 1, 2, 3, 4].map((k) => <span key={k} className={`w-px ${lit ? "bg-ink/25" : "bg-paper/15"}`} />)}
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
