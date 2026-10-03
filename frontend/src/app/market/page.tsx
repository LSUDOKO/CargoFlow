import type { Metadata } from "next";
import { MarketView } from "@/components/market/MarketView";

export const metadata: Metadata = { title: "Financing market" };

export default function MarketPage() {
  return <MarketView />;
}
