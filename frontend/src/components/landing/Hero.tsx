import { Highlight } from "@/components/brand/Highlight";
import { Illustration } from "@/components/brand/Illustration";
import { TrackBar } from "./TrackBar";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="container-page pt-3 md:pt-5">
      <div className="surface-ink relative isolate overflow-hidden rounded-[2rem] bg-ink text-paper md:rounded-[2.5rem]">
        {/* the port scene fills the right half; a navy wash on its left edge keeps the headline readable over it */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 hidden w-[58%] lg:block">
          <Illustration name="hero" priority className="h-full w-full object-cover object-left" />
          <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/55 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink to-transparent" />
        </div>
        <div className="relative grid grid-cols-1 gap-8 px-5 pt-10 pb-24 sm:px-8 md:px-12 md:pt-16 md:pb-32 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-end">
          <div className="max-w-[34rem]">
            <h1 id="hero-title" className="font-display text-[clamp(2.6rem,6.2vw,5.25rem)] leading-[1.02] font-bold tracking-[-0.045em]">
              Capital that <Highlight>moves</Highlight> with your cargo
            </h1>
            <p className="lede mt-6 text-paper/75 md:text-xl md:leading-relaxed">
              USDG working capital for physical trade. Each tranche is released only when the shipment&apos;s own sensor evidence,
              committed on Robinhood Chain, says the cargo is fine.
            </p>
          </div>
          {/* on phones and tablets the scene sits below the copy instead of behind it */}
          <div className="-mx-5 -mb-24 overflow-hidden sm:-mx-8 md:-mx-12 md:-mb-32 lg:hidden">
            <Illustration name="hero" priority className="h-auto w-full" />
          </div>
        </div>
      </div>
      <div className="relative z-20 mx-auto -mt-14 max-w-[60rem] px-2 md:-mt-20 md:px-8">
        <TrackBar />
      </div>
    </section>
  );
}
