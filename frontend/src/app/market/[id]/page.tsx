import type { Metadata } from "next";
import { RequestDetail } from "@/components/market/RequestDetail";

export const metadata: Metadata = { title: "Financing request" };

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RequestDetail id={decodeURIComponent(id)} />;
}
