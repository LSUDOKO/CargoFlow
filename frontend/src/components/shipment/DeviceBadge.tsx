import { Badge } from "@/components/ui/Pill";
import { DEVICE_CLASS_HINT, DEVICE_CLASS_LABEL, type DeviceClassName } from "@/lib/devices";

/** A device's class (software key, passkey, secure element) and, when recorded, its on-chain registry entry. */
export function DeviceBadge({ deviceClass, onChain, revoked, compact }: { deviceClass: DeviceClassName; onChain?: boolean; revoked?: boolean; compact?: boolean }) {
  const variant = deviceClass === "secure_element" ? "success" : deviceClass === "passkey" ? "info" : "neutral";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span title={DEVICE_CLASS_HINT[deviceClass]} className="inline-flex">
        <Badge variant={variant} shape="square" icon={<ClassIcon c={deviceClass} />}>{DEVICE_CLASS_LABEL[deviceClass]}</Badge>
      </span>
      {revoked ? (
        <Badge variant="danger" shape="square">Revoked</Badge>
      ) : onChain ? (
        <span title="Recorded in the on-chain DeviceRegistry" className="inline-flex">
          <Badge variant="success" shape="square">{compact ? "On-chain ✓" : "On-chain registry ✓"}</Badge>
        </span>
      ) : null}
    </span>
  );
}

function ClassIcon({ c }: { c: DeviceClassName }) {
  if (c === "secure_element")
    return (
      <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0" aria-hidden="true">
        <rect x="3" y="3" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="6" y="6" width="4" height="4" fill="currentColor" />
      </svg>
    );
  if (c === "passkey")
    return (
      <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0" aria-hidden="true">
        <circle cx="5.5" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8.5 8h6M12.5 8v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0" aria-hidden="true">
      <path d="M5 4 2 8l3 4M11 4l3 4-3 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
