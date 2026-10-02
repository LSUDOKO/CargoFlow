/* eslint-disable @next/next/no-img-element -- crisp vector logo; next/image adds nothing for small SVGs */

type Props = { variant?: "full" | "mark"; className?: string; tone?: "dark" | "light" };

/**
 * The CargoFlow logo: a hexagonal "C" wrapping container ribs and a forward arrow, with the wordmark.
 * `tone="dark"` (the default) is for navy surfaces, where "Cargo" is white; `tone="light"` is for light surfaces.
 */
export function Logo({ variant = "full", className, tone = "dark" }: Props) {
  if (variant === "mark") {
    return <img src="/brand/mark.svg" alt="CargoFlow" width={32} height={32} className={className ?? "h-8 w-8"} />;
  }
  return (
    <img
      src={tone === "dark" ? "/brand/logo-dark.svg" : "/brand/logo-light.svg"}
      alt="CargoFlow"
      width={160}
      height={40}
      className={className ?? "h-9 w-auto"}
    />
  );
}
