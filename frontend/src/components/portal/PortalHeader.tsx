import { Character } from "@/components/cast/Cast";
import { CAST, type CharacterName } from "@/components/cast/data";

/**
 * The header of each role portal: the shared PageHeader layout (one h1, a one-sentence description, actions aligned
 * to the bottom of the title block), greeted by the person the portal belongs to: Meera for exporters, Daniel for
 * financiers, Wei Lin for buyers, the Arbiter, the Carrier on /ebl. The figure is decorative; the greeting is text.
 */
export function PortalHeader({ eyebrow, title, lede, actions, who, greeting }: { eyebrow: string; title: string; lede: string; actions?: React.ReactNode; who?: CharacterName; greeting?: string }) {
  const hello = greeting ?? (who ? `Hi, I'm ${CAST[who].name}` : undefined);
  return (
    <header className="mb-8 flex flex-col gap-5 md:mb-10 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 items-start gap-4 md:items-center md:gap-6">
        {who && (
          <span aria-hidden="true" className="block h-18 w-18 shrink-0 overflow-hidden rounded-card bg-mist ring-1 ring-border ring-inset md:h-24 md:w-24">
            <Character who={who} crop="portrait" gesture="wave" expression="happy" className="h-full w-full" />
          </span>
        )}
        <div className="min-w-0">
          <p className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="eyebrow">{eyebrow}</span>
            {hello && <span className="rounded-full bg-signal-soft px-2.5 py-0.5 text-caption font-semibold text-signal-fg">{hello}</span>}
          </p>
          <h1 className="font-display text-h1">{title}</h1>
          <p className="mt-2 max-w-reading text-body-lg text-text-muted">{lede}</p>
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
