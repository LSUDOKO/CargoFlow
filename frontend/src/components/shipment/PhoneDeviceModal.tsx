"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount } from "wagmi";
import { signMessage } from "wagmi/actions";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ApiError, apiPost, apiPostRaw } from "@/lib/api/client";
import { GatewaySource, IngestResult, type Shipment } from "@/lib/api/schemas";
import { wagmiConfig } from "@/lib/chain/config";
import { signatureError } from "@/lib/chain/errors";
import { createDevicePasskey, deviceFor, passkeyRequestHeaders, saveDevice, type DeviceRecord } from "@/lib/devicePasskey";
import { sourceAuthorizationMessage } from "@/lib/gateway";
import { isPasskeyCancel } from "@/lib/passkey/provider";

const SENSOR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function deviceError(err: unknown, fallback: string): string {
  if (isPasskeyCancel(err)) return "The passkey prompt was closed. Nothing was sent.";
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : fallback;
}

/**
 * A phone becomes a signed inspection device: a WebAuthn passkey on it is registered as an evidence gateway (class
 * "passkey", attested by the platform), and each manual reading is signed by that passkey (Face ID or fingerprint).
 */
export function PhoneDeviceModal({ open, onClose, shipment, isExporter }: { open: boolean; onClose: () => void; shipment: Shipment; isExporter: boolean }) {
  const [device, setDevice] = useState<DeviceRecord | null>(() => (typeof window === "undefined" ? null : deviceFor(shipment.id)));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={device ? "Signed inspection reading" : "Use a phone as a signed inspection device"}
      description={device ? `${device.label || "This device"} · sensor ${device.sensorId}` : "Open this page on the phone that inspects the cargo. Its passkey (Face ID, fingerprint or screen lock) signs every reading."}
    >
      {device ? (
        <ReadingForm shipment={shipment} device={device} onForget={() => setDevice(null)} />
      ) : (
        <RegisterForm shipment={shipment} isExporter={isExporter} onRegistered={setDevice} />
      )}
    </Modal>
  );
}

function RegisterForm({ shipment, isExporter, onRegistered }: { shipment: Shipment; isExporter: boolean; onRegistered: (d: DeviceRecord) => void }) {
  const { address } = useAccount();
  const qc = useQueryClient();
  const [label, setLabel] = useState("Inspector phone");
  const [sensorId, setSensorId] = useState("inspection-1");
  const [busy, setBusy] = useState<"passkey" | "sign" | "register" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sensorError = SENSOR.test(sensorId) ? null : "Letters, digits, dot, dash and underscore.";

  async function register() {
    if (!address || sensorError) return;
    setError(null);
    let reg;
    try {
      setBusy("passkey");
      reg = await createDevicePasskey(shipment.id, label.trim());
    } catch (err) {
      setError(deviceError(err, "The passkey could not be created."));
      setBusy(null);
      return;
    }
    const issuedAt = Math.floor(Date.now() / 1000);
    let signature: string;
    try {
      setBusy("sign");
      signature = await signMessage(wagmiConfig, { account: address, message: sourceAuthorizationMessage(shipment.id, reg.publicKey, [sensorId], issuedAt, "webauthn") });
    } catch (err) {
      setError(signatureError(err));
      setBusy(null);
      return;
    }
    try {
      setBusy("register");
      const src = await apiPost(
        `/v1/shipments/${shipment.id}/sources`,
        {
          label: label.trim(),
          publicKey: reg.publicKey,
          keyType: "webauthn",
          sensorIds: [sensorId],
          attestation: { format: "webauthn", attestationObject: reg.attestationObject, clientDataJSON: reg.clientDataJSON },
          issuedAt,
          signature,
        },
        GatewaySource,
      );
      const d: DeviceRecord = { shipmentId: shipment.id.toLowerCase(), sourceId: src.id, credentialId: reg.credentialId, sensorId, label: label.trim(), createdAt: Date.now() };
      saveDevice(d);
      await qc.invalidateQueries({ queryKey: ["gateways", shipment.id] });
      onRegistered(d);
    } catch (err) {
      setError(deviceError(err, "The device could not be registered."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void register();
      }}
    >
      <ol className="list-decimal space-y-1 pl-5 text-sm text-text-muted">
        <li>This phone creates a passkey for this shipment only.</li>
        <li>The exporter&apos;s wallet signs that the passkey may report the sensor below.</li>
        <li>Readings you take are then signed with the passkey and count as evidence (device class: passkey).</li>
      </ol>
      <Field label="Device name" value={label} onChange={(e) => setLabel(e.target.value.slice(0, 80))} maxLength={80} data-autofocus />
      <Field label="Sensor id" value={sensorId} onChange={(e) => setSensorId(e.target.value.trim())} error={sensorError} hint="How readings from this phone are labelled in the evidence." />
      {!isExporter && <p className="text-sm font-medium text-danger-fg">Connect the exporter&apos;s wallet ({shipment.exporter.slice(0, 8)}…) to authorize a device.</p>}
      {error && <p role="alert" className="text-sm font-medium text-danger-fg">{error}</p>}
      <Button type="submit" loading={busy !== null} disabled={!isExporter || !!sensorError}>
        {busy === "passkey" ? "Follow the passkey prompt…" : busy === "sign" ? "Waiting for the wallet signature…" : busy === "register" ? "Registering…" : "Create passkey and register device"}
      </Button>
    </form>
  );
}

function ReadingForm({ shipment, device, onForget }: { shipment: Shipment; device: DeviceRecord; onForget: () => void }) {
  const qc = useQueryClient();
  const [temp, setTemp] = useState("");
  const [humidity, setHumidity] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [busy, setBusy] = useState<"locate" | "sign" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const t = Number(temp);
  const la = Number(lat);
  const lo = Number(lon);
  const h = humidity.trim() === "" ? 0 : Number(humidity);
  const valid = temp.trim() !== "" && Number.isFinite(t) && t > -90 && t < 90 && lat.trim() !== "" && lon.trim() !== "" && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && Number.isFinite(h) && h >= 0 && h <= 100;

  function locate() {
    if (!navigator.geolocation) return setError("This browser cannot share its location; type the coordinates.");
    setBusy("locate");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(5));
        setLon(p.coords.longitude.toFixed(5));
        setBusy(null);
      },
      () => {
        setError("The location was not shared; type the coordinates.");
        setBusy(null);
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  async function send() {
    if (!valid) return;
    setError(null);
    setDone(null);
    setBusy("sign");
    try {
      const path = `/v1/shipments/${shipment.id.toLowerCase()}/telemetry`;
      const raw = JSON.stringify({
        points: [{ timestamp: Math.floor(Date.now() / 1000), sensorId: device.sensorId, temperatureX100: Math.round(t * 100), humidityX100: Math.round(h * 100), latitudeE6: Math.round(la * 1e6), longitudeE6: Math.round(lo * 1e6), shockX100: 0 }],
      });
      const headers = await passkeyRequestHeaders(device, "POST", path, raw);
      const out = await apiPostRaw(path, raw, headers, IngestResult);
      if (out.accepted > 0) {
        setDone(`Reading accepted: ${t.toFixed(1)} °C at ${la.toFixed(4)}, ${lo.toFixed(4)}, signed by this phone's passkey.`);
        setTemp("");
        void qc.invalidateQueries({ queryKey: ["telemetry", shipment.id] });
      } else setError(out.rejected[0] ? `Not accepted: ${out.rejected[0].reason.toLowerCase().replace(/_/g, " ")}.` : "The reading was not accepted.");
    } catch (err) {
      setError(deviceError(err, "The reading could not be sent."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Temperature" inputMode="decimal" suffix="°C" value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="4.2" data-autofocus />
        <Field label="Humidity (optional)" inputMode="decimal" suffix="%" value={humidity} onChange={(e) => setHumidity(e.target.value)} placeholder="65" />
        <Field label="Latitude" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="1.26475" />
        <Field label="Longitude" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="103.84000" />
      </div>
      <Button variant="secondary" size="sm" className="self-start" loading={busy === "locate"} onClick={locate}>Use this phone&apos;s location</Button>
      {error && <p role="alert" className="text-sm font-medium text-danger-fg">{error}</p>}
      {done && <p role="status" className="rounded-xl bg-verified/10 px-3 py-2 text-sm font-medium text-success-fg">{done}</p>}
      <p className="text-sm text-text-muted">The passkey signs this exact reading (time, position and values); the backend checks the signature against the registered device before it counts.</p>
      <Button type="submit" loading={busy === "sign"} disabled={!valid || busy !== null}>
        {busy === "sign" ? "Confirm with your passkey…" : "Sign reading with passkey"}
      </Button>
      <button type="button" onClick={onForget} className="self-start text-sm font-semibold text-text-muted underline-offset-4 hover:text-ink hover:underline">
        Register a different device
      </button>
    </form>
  );
}
