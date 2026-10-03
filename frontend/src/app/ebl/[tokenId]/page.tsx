import type { Metadata } from "next";
import { BillPage } from "@/components/ebl/BillPage";

export async function generateMetadata({ params }: { params: Promise<{ tokenId: string }> }): Promise<Metadata> {
  const { tokenId } = await params;
  return { title: `Bill of lading #${decodeURIComponent(tokenId).replace(/^#/, "")}` };
}

export default async function BillOfLadingPage({ params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params;
  return <BillPage raw={decodeURIComponent(tokenId)} />;
}
