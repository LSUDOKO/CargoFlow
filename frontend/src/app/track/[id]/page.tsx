import type { Metadata } from "next";
import { ShipmentDashboard } from "@/components/shipment/ShipmentDashboard";

export const metadata: Metadata = { title: "Shipment" };

export default async function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = decodeURIComponent(id);
  // a 0x id is canonicalised; anything else is an external reference the dashboard resolves
  return <ShipmentDashboard id={/^0x[0-9a-fA-F]{64}$/.test(raw) ? raw.toLowerCase() : raw} />;
}
