import type { Metadata } from "next";
import { ExporterPortal } from "@/components/portal/ExporterPortal";

export const metadata: Metadata = { title: "For exporters" };

export default function ExporterPage() {
  return <ExporterPortal />;
}
