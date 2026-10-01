import type { Metadata } from "next";
import { RolePortal } from "@/components/portal/RolePortal";

export const metadata: Metadata = { title: "For buyers" };

export default function BuyerPage() {
  return <RolePortal role="buyer" />;
}
