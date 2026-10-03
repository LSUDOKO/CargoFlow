import { Highlight } from "@/components/brand/Highlight";
import { Illustration } from "@/components/brand/Illustration";
import { LinkButton } from "@/components/ui/Button";
import { TrackBar } from "./TrackBar";

const Arrow = () => (
  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);

/**
 * The landing hero: one navy panel holding the copy and the port scene in its own frame, and the track bar docked
 * into the panel's bottom padding (so it never covers the image). Phones stack copy, scene, then the bar.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="container-page pt-3 md:pt-5">
      <div className="surface-ink relative isolate overflow-hidden rounded-sheet bg-ink text-paper">
        {/* a restrained light source behind the scene: one radial wash, no mesh */}
        <div aria-hidden="true" className="pointer-events-none absolute -top-1/3 right-[-10%] -z-10 h-[140%] w-[70%] bg-[radial-gradient(closest-side,rgb(198_244_50/0.10),transparent)]" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-paper/20 to-transparent" />
        <div className="grid grid-cols-1 gap-8 px-5 pt-8 pb-6 sm:px-8 md:gap-10 md:px-10 md:pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-12 lg:px-12 lg:pt-14 lg:pb-28">
          <div className="max-w-[36rem]">
            <p className="inline-flex items-center gap-2 rounded-full bg-paper/8 py-1 pr-3 pl-2 text-caption font-semibold text-paper/85 ring-1 ring-paper/15 ring-inset">
              <span className="h-1.5 w-1.5 rounded-full bg-signal" aria-hidden="true" />
              Live on Robinhood Chain Testnet
            </p>
            <h1 id="hero-title" className="mt-5 font-display text-display">
              Capital that <Highlight>moves</Highlight> with your cargo
            </h1>
            <p className="mt-5 max-w-[32rem] text-body-lg text-paper/75 md:text-lg md:leading-relaxed">
              USDG working capital for physical trade. Each tranche is released only when the shipment&apos;s own sensor evidence,
              committed on Robinhood Chain, says the cargo is fine.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <LinkButton href="/exporter" size="lg" iconEnd={<Arrow />}>Start as an exporter</LinkButton>
              <LinkButton href="/financier" size="lg" variant="inverse">Fund a facility</LinkButton>
            </div>
          </div>
          {/* the scene in its own frame: a hairline, the sheet-in-sheet radius and a faint inner light */}
          <div className="relative min-w-0 rounded-card bg-paper/5 p-1.5 ring-1 ring-paper/10 ring-inset">
            <div className="relative aspect-[16/10] overflow-hidden rounded-[calc(var(--radius-card)-0.375rem)] bg-ink-800">
              <Illustration name="hero" priority sizes="(min-width: 1280px) 620px, (min-width: 1024px) 50vw, 100vw" className="h-full w-full object-cover object-[30%_50%]" />
              <div aria-hidden="true" className="absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_rgb(247_249_244/0.12)]" />
            </div>
          </div>
        </div>
      </div>
      <div className="relative z-10 mx-auto mt-4 max-w-[56rem] lg:-mt-16 lg:px-8">
        <TrackBar />
      </div>
    </section>
  );
}
