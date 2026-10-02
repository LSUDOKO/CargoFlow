import type { Metadata } from "next";
import { ArbiterConsole } from "@/components/portal/ArbiterConsole";

export const metadata: Metadata = { title: "For arbiters" };

export default function ArbiterPage() {
  return <ArbiterConsole />;
}
