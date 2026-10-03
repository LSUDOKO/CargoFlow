import { PageHeader } from "@/components/ui/Section";

/** The header of each role portal: the shared app PageHeader with the portal's audience as the eyebrow. */
export function PortalHeader({ eyebrow, title, lede, actions }: { eyebrow: string; title: string; lede: string; actions?: React.ReactNode }) {
  return <PageHeader eyebrow={eyebrow} title={title} description={lede} actions={actions} />;
}
