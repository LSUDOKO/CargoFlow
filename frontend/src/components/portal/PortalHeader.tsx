import { Highlight } from "@/components/brand/Highlight";
import { Illustration, type IllustrationName } from "@/components/brand/Illustration";

/** The shared hero band at the top of each role portal. */
export function PortalHeader({ title, mark, lede, art }: { title: string; mark: string; lede: string; art: IllustrationName }) {
  return (
    <div className="flex items-center justify-between gap-8 rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-card)] md:p-10">
      <div>
        <h1 className="font-display text-[clamp(2.2rem,5vw,3.8rem)] leading-[1] font-bold tracking-[-0.04em]">
          {title} <Highlight>{mark}</Highlight>
        </h1>
        <p className="mt-4 max-w-xl text-lg text-ink/75">{lede}</p>
      </div>
      <Illustration name={art} className="hidden h-36 w-36 shrink-0 md:block" decorative />
    </div>
  );
}
