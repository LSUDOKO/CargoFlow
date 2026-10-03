import type { Metadata } from "next";
import { EblPortal } from "@/components/ebl/EblPortal";

export const metadata: Metadata = { title: "For carriers" };

export default function EblPage() {
  return <EblPortal />;
}
