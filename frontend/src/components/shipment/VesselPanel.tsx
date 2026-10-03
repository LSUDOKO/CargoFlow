"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount } from "wagmi";
import { signMessage } from "wagmi/actions";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Pill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import { ApiError, apiPost } from "@/lib/api/client";
import { Accepted, Vessel, ageText, isUnavailable, nowSec, useConfigExtras, useVessel, vesselMessage } from "@/lib/api/extras";
import type { Shipment } from "@/lib/api/schemas";
import { wagmiConfig } from "@/lib/chain/config";
import { signatureError } from "@/lib/chain/errors";
import { useHydrated } from "@/lib/useHydrated";

const MMSI = /^\d{9}$/;
const deg = (e6: number, pos: string, neg: string) => `${Math.abs(e6 / 1e6).toFixed(3)}° ${e6 >= 0 ? pos : neg}`;
const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`);

/**
 * The ship carrying the container. The exporter registers it by MMSI (signed); when the deployment has an AIS feed,
 * everyone sees whether the data logger's position agrees with the ship's broadcast position. A disagreement is
 * advisory only: it is recorded in the audit trail and never moves money.
 */
export function VesselPanel({ shipment, closed }: { shipment: Shipment; closed?: boolean }) {
  const hydrated = useHydrated();
  const { address } = useAccount();
  const vessel = useVessel(shipment.id);
  const extras = useConfigExtras();
  const [editing, setEditing] = useState(false);
  const isExporter = hydrated && !!address && address.toLowerCase() === shipment.exporter.toLowerCase();
  const aisFeed = extras.data?.ais ?? false;

  if (vessel.isPending) return <Skeleton className="h-20" />;
  if (vessel.isError) {
    return <p className="text-sm text-slate">{isUnavailable(vessel.error) ? "Vessel tracking is not available on this deployment yet." : "The vessel could not be loaded. It will retry shortly."}</p>;
  }
  const v = vessel.data;
  const canEdit = isExporter && !closed;

  return (
    <div className="flex flex-col gap-4">
      {v ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-lg leading-tight font-semibold [overflow-wrap:anywhere]">{v.name}</p>
              <p className="mt-0.5 text-sm text-slate">
                MMSI <span className="font-mono text-ink">{v.mmsi}</span>
              </p>
            </div>
            <Pill tone={v.live ? "verified" : "slate"} dot>{v.live ? "AIS live" : aisFeed ? "No recent AIS fix" : "No AIS feed"}</Pill>
          </div>
          <CrossCheck v={v} aisFeed={aisFeed} />
          {canEdit && !editing && (
            <Button size="sm" variant="ghost" className="self-start -ml-3" onClick={() => setEditing(true)}>Change vessel</Button>
          )}
        </>
      ) : (
        <p className="text-sm text-slate">
          {canEdit ? "Register the ship carrying this container so its AIS position can be checked against the data logger." : "No vessel registered yet. The exporter can add the ship carrying the container."}
        </p>
      )}
      {canEdit && (!v || editing) && <RegisterVessel shipment={shipment} initial={v} onDone={() => setEditing(false)} onCancel={v ? () => setEditing(false) : undefined} />}
    </div>
  );
}

function CrossCheck({ v, aisFeed }: { v: Vessel; aisFeed: boolean }) {
  if (!aisFeed && !v.live) {
    return (
      <div className="rounded-2xl bg-mist px-4 py-3 text-sm">
        <p className="font-semibold">No live AIS feed configured</p>
        <p className="mt-0.5 text-slate">Positions come from the data logger alone on this deployment.</p>
      </div>
    );
  }
  const c = v.crossCheck;
  return (
    <div className="flex flex-col gap-3">
      {c ? (
        <div className={`rounded-2xl px-4 py-3 text-sm ${c.agrees ? "bg-verified/10" : "bg-alert/15"}`}>
          <p className="font-semibold">{c.agrees ? "Logger and ship agree" : "Logger and ship disagree"}</p>
          <p className="mt-0.5 text-ink/75">
            {km(c.distanceM)} apart · AIS fix {ageText(c.ageSec)} old{c.agrees ? "" : ". Recorded as an advisory in the audit trail; it never moves money."}
          </p>
        </div>
      ) : (
        <p className="rounded-2xl bg-mist px-4 py-3 text-sm text-slate">{v.last ? "Waiting for a logger position to compare with." : "Waiting for the ship's first AIS position."}</p>
      )}
      {v.last && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div><dt className="text-slate">Position</dt><dd className="font-mono text-[0.8125rem]">{deg(v.last.latE6, "N", "S")}<br />{deg(v.last.lonE6, "E", "W")}</dd></div>
          <div><dt className="text-slate">Speed, course</dt><dd className="font-mono text-[0.8125rem]">{(v.last.sogKnotsX10 / 10).toFixed(1)} kn<br />{Math.round(v.last.cogDegX10 / 10)}°</dd></div>
        </dl>
      )}
    </div>
  );
}

function RegisterVessel({ shipment, initial, onDone, onCancel }: { shipment: Shipment; initial: Vessel | null; onDone: () => void; onCancel?: () => void }) {
  const { address } = useAccount();
  const qc = useQueryClient();
  const [mmsi, setMmsi] = useState(initial?.mmsi ?? "");
  const [ship, setShip] = useState(initial?.name ?? "");
  const [busy, setBusy] = useState<"sign" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mmsiError = mmsi && !MMSI.test(mmsi) ? "An MMSI is exactly 9 digits." : null;

  async function register() {
    if (!address || !MMSI.test(mmsi) || !ship.trim()) return;
    setError(null);
    const issuedAt = nowSec();
    let signature: string;
    try {
      setBusy("sign");
      signature = await signMessage(wagmiConfig, { account: address, message: vesselMessage(shipment.id, mmsi, issuedAt) });
    } catch (err) {
      setError(signatureError(err));
      setBusy(null);
      return;
    }
    try {
      setBusy("save");
      await apiPost(`/v1/shipments/${shipment.id}/vessel`, { mmsi, name: ship.trim(), issuedAt, signature }, Accepted);
      await qc.invalidateQueries({ queryKey: ["vessel", shipment.id] });
      onDone();
    } catch (err) {
      setError(isUnavailable(err) ? "Vessel tracking is not available on this deployment yet." : err instanceof ApiError ? err.message : "The vessel could not be registered.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        void register();
      }}
    >
      <Field label="MMSI" inputMode="numeric" autoComplete="off" placeholder="636092123" maxLength={9} value={mmsi} onChange={(e) => setMmsi(e.target.value.replace(/\D/g, ""))} error={mmsiError} />
      <Field label="Vessel" placeholder="MSC Aurora" maxLength={80} value={ship} onChange={(e) => setShip(e.target.value)} hint="As it appears on the bill of lading." />
      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={busy !== null} disabled={!MMSI.test(mmsi) || !ship.trim()}>
          {busy === "sign" ? "Waiting for your signature…" : busy === "save" ? "Saving…" : "Sign and save vessel"}
        </Button>
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}
