"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, type ButtonVariant } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiGet } from "@/lib/api/client";
import { DocumentList, type AttestedDocument } from "@/lib/api/extras";
import type { AuditEntry, EpochSummary, ShipmentView } from "@/lib/api/schemas";
import { saveBlob } from "@/lib/documents";

type Props = { view: ShipmentView; epochs: EpochSummary[]; audit: AuditEntry[]; chainId?: number; variant?: ButtonVariant; className?: string };

/**
 * Builds the PDF in the browser (pdf-lib loads only when asked). Available in every state: it is titled
 * "Shipment record" until the invoice is settled, then "Settlement certificate".
 */
export function CertificateButton({ view, epochs, audit, chainId, variant = "inverse", className }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const settled = (view.facility?.status ?? view.shipment.status) === "SETTLED";

  async function download() {
    setBusy(true);
    try {
      const id = view.shipment.id;
      // the newest attested documents; a deployment without the endpoint simply yields none
      let documents: AttestedDocument[] = [];
      try {
        documents = (await qc.fetchQuery({ queryKey: ["documents", id], queryFn: () => apiGet(`/v1/shipments/${id}/documents`, DocumentList), staleTime: 15_000 })).documents;
      } catch {
        documents = [];
      }
      const { buildCertificate, certificateFileName } = await import("@/lib/certificate");
      const { bytes } = await buildCertificate({ view, epochs, audit, documents, chainId, generatedAt: new Date(), trackUrl: `${window.location.origin}/track/${id}` });
      saveBlob(certificateFileName(view), new Blob([bytes as BlobPart], { type: "application/pdf" }));
    } catch (err) {
      toast({ tone: "danger", title: "The PDF could not be created", body: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant={variant}
      className={className}
      loading={busy}
      onClick={() => void download()}
      title={settled ? "Settlement certificate (PDF)" : "Shipment record (PDF); it becomes the settlement certificate once the invoice is paid"}
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d="M8 2v8m0 0 3-3m-3 3L5 7M3 12.5h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {busy ? "Preparing PDF…" : "Download certificate"}
    </Button>
  );
}
