import { Highlight } from "@/components/brand/Highlight";
import { HeroConsole } from "./HeroConsole";
import { TrackBar } from "./TrackBar";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="container-page pt-3 md:pt-5">
      <div className="surface-ink relative isolate overflow-hidden rounded-[2rem] bg-ink text-paper md:rounded-[2.5rem]">
        {/* a faint instrument grid behind the console only */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 -z-10 hidden w-1/2 opacity-60 lg:block [background-image:linear-gradient(to_right,rgb(247_249_244/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(247_249_244/0.05)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:linear-gradient(to_right,transparent,black_30%)]" />
        <div className="grid grid-cols-1 gap-10 px-5 pt-10 pb-24 sm:px-8 md:px-12 md:pt-16 md:pb-32 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center lg:gap-16">
          <div>
            <h1 id="hero-title" className="font-display text-[clamp(2.6rem,6.2vw,5.25rem)] leading-[1.02] font-bold tracking-[-0.045em]">
              Capital that <Highlight>moves</Highlight> with your cargo
            </h1>
            <p className="lede mt-6 text-paper/75 md:text-xl md:leading-relaxed">
              USDG working capital for physical trade. Each tranche is released only when the shipment&apos;s own sensor evidence,
              committed on Robinhood Chain, says the cargo is fine.
            </p>
          </div>
          <HeroConsole />
        </div>
      </div>
      <div className="relative z-20 mx-auto -mt-14 max-w-[60rem] px-2 md:-mt-20 md:px-8">
        <TrackBar />
      </div>
    </section>
  );
}
