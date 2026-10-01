import Image from "next/image";

const art = {
  hero: { src: "/brand/illustrations/hero.webp", w: 1344, h: 768, alt: "A container ship docked under a gantry crane, its cargo marked as verified" },
  sensor: { src: "/brand/illustrations/sensor.svg", w: 240, h: 240, alt: "A temperature sensor fixed to a container door" },
  merkle: { src: "/brand/illustrations/merkle.svg", w: 240, h: 240, alt: "Readings hashed into a Merkle tree" },
  zk: { src: "/brand/illustrations/zk.svg", w: 240, h: 240, alt: "A shield over a sealed proof" },
  ai: { src: "/brand/illustrations/ai.svg", w: 240, h: 240, alt: "A monitor watching a telemetry chart" },
  vault: { src: "/brand/illustrations/vault.svg", w: 240, h: 240, alt: "An escrow vault holding USDG" },
  settle: { src: "/brand/illustrations/settle.svg", w: 240, h: 240, alt: "An invoice settling into two payouts" },
} as const;

export type IllustrationName = keyof typeof art;

type Props = { name: IllustrationName; className?: string; priority?: boolean; sizes?: string; decorative?: boolean };

export function Illustration({ name, className, priority, sizes, decorative }: Props) {
  const a = art[name];
  return (
    <Image
      src={a.src}
      width={a.w}
      height={a.h}
      alt={decorative ? "" : a.alt}
      priority={priority}
      sizes={sizes ?? (name === "hero" ? "(min-width: 1024px) 60vw, 100vw" : "160px")}
      className={className}
    />
  );
}
