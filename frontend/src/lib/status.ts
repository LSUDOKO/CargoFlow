export type Tone = "verified" | "alert" | "ink" | "danger" | "slate";

/** Colour tone for a facility or shipment status. */
export function statusTone(status: string | undefined | null): Tone {
  switch ((status ?? "").toUpperCase()) {
    case "ACTIVE":
    case "FINANCED":
      return "verified";
    case "PAUSED":
    case "DISPUTED":
      return "alert";
    case "SETTLED":
    case "DELIVERED":
      return "ink";
    case "DEFAULTED":
      return "danger";
    case "CANCELLED":
      return "slate";
    default:
      return "slate";
  }
}

/** Human label for a status code, e.g. "PAUSED" -> "Paused". */
export function statusLabel(status: string | undefined | null): string {
  const s = (status ?? "").toLowerCase();
  return s ? s[0]!.toUpperCase() + s.slice(1) : "Unknown";
}
