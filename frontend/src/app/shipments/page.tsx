import type { Metadata } from "next";
import { FleetView } from "@/components/fleet/FleetView";

export const metadata: Metadata = { title: "Fleet" };

export default function ShipmentsPage() {
  return <FleetView />;
}
