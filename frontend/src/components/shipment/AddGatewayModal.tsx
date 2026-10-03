"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount } from "wagmi";
import { signMessage } from "wagmi/actions";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { HashBadge } from "@/components/ui/HashBadge";
import { Modal } from "@/components/ui/Modal";
import { ApiError, apiPost } from "@/lib/api/client";
import { GatewaySource, type Shipment } from "@/lib/api/schemas";
import { wagmiConfig } from "@/lib/chain/config";
import { signatureError } from "@/lib/chain/errors";
import { downloadText } from "@/lib/download";
import { decodeKeyFile, encodeKeyFile, newGatewayKey, sourceAuthorizationMessage, type KeyFile } from "@/lib/gateway";

const SENSOR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function parseSensorList(raw: string): { sensors: string[]; error: string | null } {
  const sensors = raw.split(/[\s,]+/).filter(Boolean);
  if (sensors.length === 0) return { sensors, error: "Name at least one sensor." };
  if (sensors.length > 16) return { sensors, error: "A gateway can carry at most 16 sensors." };
  const bad = sensors.find((s) => !SENSOR.test(s));
  if (bad) return { sensors, error: `“${bad}” may use letters, digits, dot, dash and underscore.` };
  if (new Set(sensors).size !== sensors.length) return { sensors, error: "Each sensor id must be different." };
  return { sensors, error: null };
}

type Props = { open: boolean; onClose: () => void; shipment: Shipment; onCreated: (key: KeyFile) => void };

/**
 * The exporter authorizes a new evidence gateway: the browser generates its Ed25519 key, the exporter's wallet signs
 * the authorization, the backend binds the key to this shipment, and the key file is downloaded. The private key
 * never leaves the browser except in that file.
 */
export function AddGatewayModal({ open, onClose, shipment, onCreated }: Props) {
  const { address } = useAccount();
  const qc = useQueryClient();
  const minSensors = Math.max(1, shipment.policy.minSensors);
  const [label, setLabel] = useState("");
  const [sensorText, setSensorText] = useState(Array.from({ length: minSensors }, (_, i) => `probe-${i + 1}`).join(", "));
  const [busy, setBusy] = useState<"sign" | "register" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ source: GatewaySource; file: string } | null>(null);
  const { sensors, error: sensorError } = parseSensorList(sensorText);
  const isExporter = !!address && address.toLowerCase() === shipment.exporter.toLowerCase();
  const fileName = (id: string) => `cargoflow-gateway-${shipment.externalRef.replace(/[^A-Za-z0-9._-]+/g, "_")}-${id}.json`;

  const close = () => {
    setCreated(null);
    setError(null);
    setBusy(null);
    onClose();
  };

  async function register() {
    if (!address || sensorError || label.length > 80) return;
    setError(null);
    const key = newGatewayKey();
    const issuedAt = Math.floor(Date.now() / 1000);
    let signature: string;
    try {
      setBusy("sign");
      signature = await signMessage(wagmiConfig, { account: address, message: sourceAuthorizationMessage(shipment.id, key.publicKey, sensors, issuedAt) });
    } catch (err) {
      setError(signatureError(err));
      setBusy(null);
      return;
    }
    try {
      setBusy("register");
      const source = await apiPost(`/v1/shipments/${shipment.id}/sources`, { label: label.trim(), publicKey: key.publicKey, sensorIds: sensors, issuedAt, signature }, GatewaySource);
      const file = encodeKeyFile({ shipmentId: shipment.id, label: label.trim(), sensorIds: sensors, seed: key.seed });
      downloadText(fileName(source.id), file);
      setCreated({ source, file });
      await qc.invalidateQueries({ queryKey: ["gateways", shipment.id] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The gateway could not be registered.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={open} onClose={close} title={created ? "Gateway added" : "Add a sensor gateway"} description={created ? undefined : "A gateway is the logger or device whose readings count as evidence for this shipment."}>
      {created ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            <strong>{created.source.label || "The gateway"}</strong> can now report for {shipment.externalRef}. Its key file was saved to your downloads.
          </p>
          <div className="rounded-tile border-2 border-alert/60 bg-alert/10 p-4 text-sm">
            Keep the key file private. Anyone holding it can submit readings for this shipment, and CargoFlow cannot show it again. If it is lost, add a new gateway.
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-text-muted">Gateway id</dt>
            <dd><HashBadge value={created.source.id} /></dd>
            <dt className="text-text-muted">Sensors</dt>
            <dd className="font-mono">{created.source.sensorIds.join(", ")}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                onCreated(decodeKeyFile(created.file));
                close();
              }}
            >
              Submit readings with this gateway
            </Button>
            <Button variant="secondary" onClick={() => downloadText(fileName(created.source.id), created.file)}>
              Download the key file again
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void register();
          }}
        >
          <Field label="Name" placeholder="Reefer logger, container MSKU 123456-7" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} hint="Optional. Shown to every party on this shipment." data-autofocus />
          <Field
            label="Sensor ids"
            value={sensorText}
            onChange={(e) => setSensorText(e.target.value)}
            error={sensorText.trim() === "" ? null : sensorError}
            hint={`Exactly as they appear in your logger's export, separated by commas. Each evidence epoch needs readings from at least ${minSensors} sensor${minSensors > 1 ? "s" : ""}.`}
          />
          {!isExporter && <p className="text-sm font-medium text-danger-fg">Connect the exporter&apos;s wallet ({shipment.exporter.slice(0, 8)}…) to add a gateway.</p>}
          {error && <p role="alert" className="text-sm font-medium text-danger-fg">{error}</p>}
          <p className="text-sm text-text-muted">Your wallet will ask you to sign a message naming this shipment, the gateway&apos;s public key and its sensors. Signing costs no gas.</p>
          <Button type="submit" loading={busy !== null} disabled={!isExporter || !!sensorError}>
            {busy === "sign" ? "Waiting for your signature…" : busy === "register" ? "Registering…" : "Sign and add gateway"}
          </Button>
        </form>
      )}
    </Modal>
  );
}
