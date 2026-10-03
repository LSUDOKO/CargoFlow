import { cx } from "@/components/ui/cx";
import { Character, type CharacterName } from "./Cast";
import type { Expression, HeldItem } from "./rig";

type Props = {
  who: CharacterName;
  expression?: Expression;
  prop?: HeldItem;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  frame?: "dashed" | "plain";
  size?: "sm" | "md";
  className?: string;
  as?: "h2" | "h3" | "p";
};

/**
 * An empty state led by the person it belongs to (Meera for "No shipments yet", the Arbiter for an empty queue).
 * Same frame, type and spacing as ui/EmptyState; the character is decorative, the title and description carry the
 * meaning.
 */
export function CastEmptyState({ who, expression = "neutral", prop = "none", title, description, action, frame = "dashed", size = "md", className, as: H = "h3" }: Props) {
  return (
    <div
      className={cx(
        "flex flex-col items-center text-center",
        size === "sm" ? "px-4 pt-6 pb-8" : "px-6 pt-8 pb-12 md:pb-14",
        frame === "dashed" && "rounded-card border border-dashed border-border-strong bg-neutral-25",
        className,
      )}
    >
      <span className="mb-3 grid place-items-end overflow-hidden rounded-full bg-mist" style={{ width: size === "sm" ? 88 : 104, height: size === "sm" ? 88 : 104 }}>
        <Character who={who} crop="bust" expression={expression} prop={prop} size={size === "sm" ? 84 : 100} />
      </span>
      <H className={cx("font-display", size === "sm" ? "text-h4" : "text-h3")}>{title}</H>
      {description && <p className="mt-1.5 max-w-[42ch] text-small text-text-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
