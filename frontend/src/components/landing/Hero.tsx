import { Highlight } from "@/components/brand/Highlight";
import { Illustration } from "@/components/brand/Illustration";
import { TrackBar } from "./TrackBar";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="container-page pt-3 md:pt-5">
      <div className="relative isolate overflow-hidden rounded-[2rem] bg-[#A7E2EF] md:rounded-[2.5rem]">
        <div className="relative z-10 px-6 pt-10 pb-6 md:px-12 md:pt-14 lg:max-w-[58rem] lg:pb-0">
          <h1 id="hero-title" className="font-display text-[clamp(2.6rem,7vw,5.4rem)] leading-[1.04] font-bold tracking-[-0.045em] text-balance text-ink">
            Capital that <Highlight>moves</Highlight>
            <br className="hidden md:block" /> with your cargo
          </h1>
          <p className="mt-6 max-w-[36rem] text-[1.08rem] leading-relaxed text-ink/80 md:text-xl">
            USDG working capital for physical trade. Each tranche is released only when the shipment&apos;s own sensor evidence,
            committed on Robinhood Chain, says the cargo is fine.
          </p>
        </div>
        <div className="relative lg:-mt-24">
          <Illustration name="hero" priority className="h-auto w-full" />
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#A7E2EF] to-transparent" aria-hidden="true" />
        </div>
      </div>
      <div className="relative z-20 mx-auto -mt-10 max-w-[60rem] px-2 md:-mt-20 md:px-8">
        <TrackBar />
      </div>
    </section>
  );
}
