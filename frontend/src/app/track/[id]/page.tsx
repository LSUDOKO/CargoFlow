import type { Metadata } from "next";
import { ShipmentDashboard } from "@/components/shipment/ShipmentDashboard";

export const metadata: Metadata = { title: "Shipment" };

export default async function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShipmentDashboard id={id.toLowerCase()} />;
}
