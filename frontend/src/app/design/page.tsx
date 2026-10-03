import type { Metadata } from "next";
import { Showcase } from "./Showcase";

// internal reference: linked from nowhere public, kept out of search engines
export const metadata: Metadata = {
  title: "Design system",
  description: "CargoFlow design system v2: tokens and components.",
  robots: { index: false, follow: false, nocache: true },
};

export default function DesignPage() {
  return <Showcase />;
}
