import type { Metadata } from "next";
import { RolePortal } from "@/components/portal/RolePortal";

export const metadata: Metadata = { title: "For financiers" };

export default function FinancierPage() {
  return <RolePortal role="financier" />;
}
