import { Highlight } from "@/components/brand/Highlight";
import { Character } from "@/components/cast/Cast";
import { CAST, CAST_ORDER, type CharacterName } from "@/components/cast/data";
import type { CharacterProps } from "@/components/cast/Person";
import { Carousel } from "@/components/story/Carousel";
import { LazyMount } from "@/components/story/Lazy";
import { Reveal } from "@/components/story/Reveal";

/** How each person stands in their card: the film's signature pose for them. */
const POSE: Record<CharacterName, Omit<CharacterProps, "size">> = {
  meera: { prop: "tablet", gesture: "wave", expression: "happy" },
  daniel: { prop: "phone", expression: "confident", look: "right" },
  weilin: { prop: "invoice", expression: "happy", look: "left" },
  arbiter: { pose: "crossed", expression: "neutral" },
  insurer: { prop: "umbrella", expression: "relieved" },
  carrier: { prop: "bol", expression: "confident", look: "left" },
};

/**
 * "Meet the people": the six characters of the film, each with what they do in CargoFlow in one sentence. A swipe
 * carousel on phones and tablets, a staggered grid on desktop. Characters are decorative; the text carries meaning.
 */
export function MeetThePeople() {
  return (
    <section aria-labelledby="people-title" className="container-page mt-24 md:mt-32">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <p className="eyebrow">Meet the people</p>
          <h2 id="people-title" className="h-section mt-3">
            Six people, <Highlight>one shipment</Highlight>
          </h2>
        </div>
        <p className="lede max-w-md text-text-muted">
          Trade finance is easier to follow as a story. These are the people in it, and every screen on this site belongs to one of them.
        </p>
      </div>
      <Reveal className="mt-10">
        <Carousel label="The people of CargoFlow" itemLabel="person" gridFrom="lg" trackClassName="lg:grid-cols-3 lg:gap-5">
          {CAST_ORDER.map((who, i) => {
            const c = CAST[who];
            return (
              <li
                key={who}
                data-reveal
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${CAST_ORDER.length}: ${c.name}`}
                className="flex w-[80%] shrink-0 snap-start flex-col rounded-card border border-border bg-surface p-3 shadow-1 sm:w-[46%] md:w-[38%] lg:w-auto"
              >
                <div className="relative flex h-64 items-end justify-center overflow-hidden rounded-tile bg-mist pt-6 [@media(scripting:none)]:hidden">
                  <span aria-hidden="true" className="absolute inset-x-6 bottom-5 h-px bg-neutral-300" />
                  <LazyMount className="relative flex h-full items-end justify-center">
                    <Character who={who} {...POSE[who]} size={who === "insurer" ? 222 : 244} />
                  </LazyMount>
                </div>
                <div className="flex flex-1 flex-col px-2 pt-4 pb-2">
                  <h3 className="font-display text-h3">{c.name}</h3>
                  <p className="mt-0.5 text-small font-semibold text-ink-500">
                    {c.role} <span className="font-normal">· {c.where}</span>
                  </p>
                  <p className="mt-2.5 text-body text-text-muted">{c.sentence}</p>
                </div>
              </li>
            );
          })}
        </Carousel>
      </Reveal>
    </section>
  );
}
