import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PartyView } from "@/components/market/PartyView";

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  return { title: `Track record ${address.slice(0, 8)}…` };
}

export default async function PartyPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) notFound();
  return <PartyView address={address.toLowerCase()} />;
}
