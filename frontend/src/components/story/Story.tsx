import Link from "next/link";
import { Highlight } from "@/components/brand/Highlight";
import { LazyMount } from "./Lazy";
import { StoryScene } from "./scenes";
import { STEPS } from "./steps";
import { StoryMotion } from "./StoryMotion";
import s from "./story.module.css";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "How it works", told by the cast: one shipment of vaccines from Pune to Singapore in six steps. Captions are
 * server-rendered; the scenes mount on the client about a screen before the section (their boxes are reserved, so
 * nothing shifts) and StoryMotion pins and scrubs them where there is room. Without JavaScript the captions read as
 * a stacked list; under reduced motion the stacked list fades in, unpinned.
 */
export function Story() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="mt-24 scroll-mt-24 md:mt-32">
      <div className="container-page">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow">How it works</p>
            <h2 id="how-title" className="h-section mt-3">
              One shipment, <Highlight>start to finish</Highlight>
            </h2>
          </div>
          <div className="max-w-md">
            <p className="lede text-text-muted">Follow Meera&apos;s vaccines from Nhava Sheva to Singapore. Keep scrolling and each step plays out.</p>
            <Link href="/deployments" className="mt-3 inline-flex items-center gap-1.5 text-small font-semibold underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
              See the contracts behind each step
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </div>
      <StoryMotion>
        <div className="container-page mt-10 md:mt-12">
          <div data-story-pin className={s.pin}>
            <nav aria-label="Story steps" className={s.prog}>
              <ol className="grid grid-cols-6 gap-1.5">
                {STEPS.map((st, i) => (
                  <li key={st.id} className="min-w-0">
                    <a
                      href={`#story-${st.id}`}
                      data-story-goto={i}
                      className="group flex flex-col gap-1.5 rounded-chip py-1 text-caption font-semibold text-text-muted transition-colors duration-(--duration-fast) hover:text-ink aria-[current=step]:text-ink"
                    >
                      <span aria-hidden="true" className="block h-1 rounded-full bg-neutral-200 transition-colors duration-(--duration-base) group-aria-[current=step]:bg-ink" />
                      <span className="truncate">
                        <span className="num">{pad(i + 1)}</span>
                        <span className="hidden sm:inline"> {st.short}</span>
                        <span className="sr-only sm:hidden"> {st.short}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
              <div aria-hidden="true" className="mt-2 h-0.5 overflow-hidden rounded-full bg-neutral-150">
                <div data-story-bar className="h-full origin-left rounded-full bg-signal-2" style={{ transform: `scaleX(${1 / STEPS.length})` }} />
              </div>
            </nav>
            <div className={s.steps}>
              {STEPS.map((st, i) => {
                return (
                  <div key={st.id} id={`story-${st.id}`} data-story-step className={s.step}>
                    <div data-story-cap className={s.cap}>
                      <p className="eyebrow">
                        <span className="num">{pad(i + 1)}</span> · {st.eyebrow}
                      </p>
                      <h3 className="mt-2 font-display text-h2">{st.title}</h3>
                      <p className="mt-3 max-w-reading text-body-lg text-text-muted">{st.body}</p>
                      <p className="mt-3 flex max-w-reading gap-2 text-small text-text-subtle">
                        <span className="shrink-0 font-semibold text-ink">Under the hood</span>
                        <span>{st.hood}</span>
                      </p>
                    </div>
                    <div data-story-scene className={`${s.scene} overflow-hidden rounded-card border border-border bg-surface shadow-1`}>
                      <LazyMount className="h-full w-full">
                        <StoryScene index={i} />
                      </LazyMount>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </StoryMotion>
    </section>
  );
}
