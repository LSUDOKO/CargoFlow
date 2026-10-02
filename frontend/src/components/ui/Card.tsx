import { cx } from "./cx";

type Props = React.HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article"; tone?: "white" | "paper" | "ink"; padded?: boolean };

const tones = { white: "bg-white border border-line", paper: "bg-paper border border-line", ink: "bg-ink text-paper border border-ink-3" };

export function Card({ as: Tag = "div", tone = "white", padded = true, className, ...rest }: Props) {
  return <Tag className={cx("rounded-[var(--radius-card)] shadow-[var(--shadow-card)]", tones[tone], padded && "p-5 md:p-6", className)} {...rest} />;
}

/** Section heading inside a card: a title plus optional trailing content. */
export function CardHeader({ title, children, id }: { title: string; children?: React.ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
      <h2 id={id} className="shrink-0 font-display text-lg font-semibold">{title}</h2>
      {children}
    </div>
  );
}
