"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { API_URL } from "@/lib/api/client";
import { downloadText } from "@/lib/download";

/** The shipment as a GS1 EPCIS 2.0 JSON-LD document, for ERPs and traceability systems. */
export function EpcisDownload({ shipmentId, reference }: { shipmentId: string; reference: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `${API_URL}/v1/shipments/${shipmentId}/epcis`;

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { headers: { Accept: "application/ld+json, application/json" }, cache: "no-store" });
      if (res.status === 404 || res.status === 501) throw new Error("EPCIS export is not available on this deployment yet.");
      if (!res.ok) throw new Error(`The export failed (status ${res.status}).`);
      const text = await res.text();
      downloadText(`cargoflow-${reference.replace(/[^A-Za-z0-9._-]+/g, "_")}-epcis.jsonld`, text, "application/ld+json");
    } catch (err) {
      setError(err instanceof TypeError ? "The CargoFlow backend could not be reached." : err instanceof Error ? err.message : "The export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">
        Every event of this shipment in the GS1 EPCIS 2.0 standard: commissioning, shipping, one sensor report per evidence batch (temperature, humidity and shock aggregates with the Merkle root and commit transaction), financing events and receiving. Raw readings are not included.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void download()}>
          Download EPCIS 2.0 (JSON-LD)
        </Button>
        <a href={url} target="_blank" rel="noreferrer" className="text-sm font-semibold underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
          Open the API endpoint<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
      {error && <p role="alert" className="text-sm font-medium text-danger-fg">{error}</p>}
    </div>
  );
}
