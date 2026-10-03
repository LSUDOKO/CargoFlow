import type { Metadata } from "next";
import { NewRequest } from "@/components/market/NewRequest";

export const metadata: Metadata = { title: "Request financing" };

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ shipment?: string | string[] }> }) {
  const { shipment } = await searchParams;
  return <NewRequest shipmentId={Array.isArray(shipment) ? shipment[0] : shipment} />;
}
