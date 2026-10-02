"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { HashBadge } from "@/components/ui/HashBadge";
import { Modal } from "@/components/ui/Modal";
import { ApiError, postReadings } from "@/lib/api/client";
import type { EpochOutcome, Shipment } from "@/lib/api/schemas";
import { batches, parseReadingsCsv, templateCsv, type ParsedCsv } from "@/lib/csv";
import { downloadText } from "@/lib/download";
import { decodeKeyFile, type KeyFile } from "@/lib/gateway";
import { shortHash } from "@/lib/format";

const REASONS: Record<string, string> = {
  TIMESTAMP_OUT_OF_ORDER: "older than a reading already accepted from that sensor",
  REPLAYED_PACKET: "already submitted",
  CONFLICTING_DUPLICATE: "conflicts with an earlier reading for the same second",
  TEMPERATURE_OUT_OF_SENSOR_BOUNDS: "temperature outside what the sensor can measure",
  HUMIDITY_OUT_OF_RANGE: "humidity out of range",
  LATITUDE_OUT_OF_RANGE: "latitude out of range",
  LONGITUDE_OUT_OF_RANGE: "longitude out of range",
  SHOCK_OUT_OF_RANGE: "shock out of range",
};

const ACTIONS: Record<string, string> = {
  APPROVE_ADVANCE: "Passed: the milestone can be released",
  REQUEST_SECONDARY_PROOF: "Held: more evidence needed",
  PAUSE_FACILITY: "Failed: the facility pauses",
};

type Totals = { accepted: number; rejected: Record<string, number>; epochs: EpochOutcome[] };
type Props = { open: boolean; onClose: () => void; shipment: Shipment; initialKey?: KeyFile | null; chainId?: number };

const time = (s: number) => new Date(s * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** Submit a data logger's CSV export as evidence, signed in the browser with a gateway key file. */
export function UploadReadings({ open, onClose, shipment, initialKey, chainId }: Props) {
  const qc = useQueryClient();
  const keyInput = useId();
  const csvInput = useId();
  const [key, setKey] = useState<KeyFile | null>(initialKey ?? null);
  const [keyError, setKeyError] = useState<{ message: string; shipmentId?: string } | null>(null);
  const [csvName, setCsvName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastInitial, setLastInitial] = useState(initialKey);
  if (initialKey !== lastInitial) {
    // a key created a moment ago in this browser replaces whatever was picked before
    setLastInitial(initialKey);
    if (initialKey) setKey(initialKey);
  }

  const band = { minC: shipment.policy.minTempX100 / 100, maxC: shipment.policy.maxTempX100 / 100 };

  async function pickKey(file: File | undefined) {
    setKeyError(null);
    setParsed(null);
    setCsvName(null);
    setTotals(null);
    if (!file) return;
    try {
      const k = decodeKeyFile(await file.text());
      if (k.shipmentId !== shipment.id.toLowerCase()) {
        setKey(null);
        setKeyError({ message: `This key belongs to shipment ${shortHash(k.shipmentId, 10, 6)}, not this one.`, shipmentId: k.shipmentId });
        return;
      }
      setKey(k);
    } catch (err) {
      setKey(null);
      setKeyError({ message: err instanceof Error ? err.message : "The key file could not be read." });
    }
  }

  async function pickCsv(file: File | undefined) {
    setTotals(null);
    setSendError(null);
    if (!file || !key) return;
    setCsvName(file.name);
    setParsed(parseReadingsCsv(await file.text(), { nowSec: Math.floor(Date.now() / 1000), band, sensors: key.sensorIds }));
  }

  async function send() {
    if (!key || !parsed || parsed.errors.length || !parsed.points.length) return;
    const groups = batches(parsed.points);
    const t: Totals = { accepted: 0, rejected: {}, epochs: [] };
    setSendError(null);
    setProgress({ done: 0, total: groups.length });
    try {
      for (let i = 0; i < groups.length; i++) {
        const r = await postReadings(key, groups[i] ?? []);
        t.accepted += r.accepted;
        for (const x of r.rejected) t.rejected[x.reason] = (t.rejected[x.reason] ?? 0) + 1;
        t.epochs.push(...r.epochs);
        setProgress({ done: i + 1, total: groups.length });
        setTotals({ ...t, rejected: { ...t.rejected }, epochs: [...t.epochs] });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "The readings could not be sent.";
      setSendError(`${msg} Readings already accepted are kept; sending the same file again skips them.`);
    } finally {
      setProgress(null);
      await qc.invalidateQueries();
    }
  }

  const sensorsCovered = parsed ? Object.keys(parsed.summary.perSensor).length : 0;
  const ready = !!key && !!parsed && parsed.errors.length === 0 && parsed.points.length > 0;
  const sent = !!totals && !sendError && !progress;

  return (
    <Modal open={open} onClose={onClose} wide title="Submit readings" description={`Readings for ${shipment.externalRef}, signed in this browser with a gateway key.`}>
      <ol className="flex flex-col gap-6">
        <li>
          <h3 className="font-semibold">1. Gateway key</h3>
          {key ? (
            <div className="mt-2 flex flex-wrap items-center gap-3 rounded-2xl bg-mist p-3 text-sm">
              <span className="font-semibold">{key.label || "Gateway"}</span>
              <HashBadge value={key.sourceId} />
              <span className="font-mono text-slate">{key.sensorIds.join(", ")}</span>
              <label htmlFor={keyInput} className="ml-auto cursor-pointer font-semibold underline">Use another key</label>
            </div>
          ) : (
            <p className="mt-1 text-sm text-slate">
              Choose the key file you downloaded when you added the gateway.{" "}
              <label htmlFor={keyInput} className="cursor-pointer font-semibold text-ink underline">Choose key file</label>
            </p>
          )}
          <input id={keyInput} type="file" accept=".json,application/json" className="sr-only" onChange={(e) => {
              void pickKey(e.target.files?.[0]);
              e.target.value = ""; // choosing the same file again must fire again
            }} aria-label="Gateway key file" />
          {keyError && (
            <p role="alert" className="mt-2 text-sm font-medium text-danger">
              {keyError.message}{" "}
              {keyError.shipmentId && <Link href={`/track/${keyError.shipmentId}`} className="underline">Open that shipment</Link>}
            </p>
          )}
        </li>

        <li>
          <h3 className="font-semibold">2. Logger export</h3>
          <p className="mt-1 text-sm text-slate">
            A CSV with the columns <code className="font-mono text-ink">timestamp, sensor_id, temperature_c, humidity_pct, latitude, longitude, shock_g</code>. Timestamps in unix seconds or ISO 8601.{" "}
            <button type="button" className="font-semibold text-ink underline" onClick={() => downloadText("cargoflow-readings-template.csv", templateCsv(key?.sensorIds ?? ["probe-1", "probe-2"]), "text/csv")}>
              Download a template
            </button>
          </p>
          <div className="mt-2 flex items-center gap-3">
            <label htmlFor={csvInput} className={`inline-flex h-10 items-center rounded-full border-2 px-4 text-sm font-semibold ${key ? "cursor-pointer border-ink hover:bg-ink hover:text-paper" : "cursor-not-allowed border-line text-slate"}`}>
              Choose CSV
            </label>
            <input id={csvInput} type="file" accept=".csv,text/csv" className="sr-only" disabled={!key} onChange={(e) => {
              void pickCsv(e.target.files?.[0]);
              e.target.value = "";
            }} aria-label="Readings CSV" />
            {csvName && <span className="truncate text-sm">{csvName}</span>}
          </div>

          {parsed && parsed.errors.length > 0 && (
            <div role="alert" className="mt-3 rounded-2xl border-2 border-danger/40 p-3 text-sm">
              <p className="font-semibold text-danger">Fix {parsed.errors.length === 1 ? "this problem" : `these ${parsed.errors.length} problems`} and choose the file again. Nothing has been sent.</p>
              <ul className="mt-2 max-h-48 overflow-y-auto font-mono text-xs leading-relaxed">
                {parsed.errors.slice(0, 50).map((e) => (
                  <li key={`${e.line}-${e.message}`}>Line {e.line}: {e.message}</li>
                ))}
              </ul>
              {parsed.errors.length > 50 && <p className="mt-1 text-xs text-slate">and {parsed.errors.length - 50} more</p>}
            </div>
          )}

          {ready && parsed && (
            <dl className="mt-3 grid grid-cols-2 gap-3 rounded-2xl bg-mist p-4 text-sm sm:grid-cols-4">
              <div><dt className="text-slate">Readings</dt><dd className="font-mono text-lg font-semibold">{parsed.summary.count.toLocaleString("en-US")}</dd></div>
              <div><dt className="text-slate">Sensors</dt><dd className="font-mono text-lg font-semibold">{sensorsCovered}</dd></div>
              <div className="col-span-2"><dt className="text-slate">Time span</dt><dd className="font-semibold">{time(parsed.summary.from ?? 0)} to {time(parsed.summary.to ?? 0)}</dd></div>
              {parsed.summary.outOfBand > 0 && (
                <p className="col-span-full font-medium">
                  {parsed.summary.outOfBand} reading{parsed.summary.outOfBand > 1 ? "s are" : " is"} outside the shipment&apos;s {band.minC} to {band.maxC} °C band. They are evidence too: an epoch that contains them can pause the facility.
                </p>
              )}
              {sensorsCovered < shipment.policy.minSensors && (
                <p className="col-span-full font-medium">The policy needs {shipment.policy.minSensors} sensors per epoch and this file has {sensorsCovered}; its epochs will not pass on their own.</p>
              )}
            </dl>
          )}
        </li>

        <li>
          <h3 className="font-semibold">3. Send</h3>
          <p className="mt-1 text-sm text-slate">Readings go in signed batches of up to 500. Readings group into evidence epochs of 8 per sensor; each closed epoch is scored and committed on chain, and can release or pause money.</p>
          <Button className="mt-3" disabled={!ready || !!progress || sent} loading={!!progress} onClick={() => void send()}>
            {sent ? "Sent" : progress ? `Sending batch ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : parsed && ready ? `Send ${parsed.summary.count.toLocaleString("en-US")} readings` : "Send readings"}
          </Button>
          {sendError && <p role="alert" className="mt-2 text-sm font-medium text-danger">{sendError}</p>}
        </li>
      </ol>

      {totals && (
        <section aria-live="polite" className="mt-6 border-t border-line pt-5">
          <h3 className="font-display text-xl font-semibold">Result</h3>
          <p className="mt-1 text-sm">
            {totals.accepted.toLocaleString("en-US")} reading{totals.accepted === 1 ? "" : "s"} accepted
            {Object.keys(totals.rejected).length > 0 && (
              <>
                {", "}
                {Object.entries(totals.rejected)
                  .map(([r, n]) => `${n} quarantined (${REASONS[r] ?? r})`)
                  .join(", ")}
              </>
            )}
            .
          </p>
          {totals.epochs.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate">
                  <tr><th className="py-1 pr-3 font-medium">Epoch</th><th className="py-1 pr-3 font-medium">Score</th><th className="py-1 pr-3 font-medium">Outcome</th><th className="py-1 font-medium">Transaction</th></tr>
                </thead>
                <tbody>
                  {totals.epochs.map((e) => {
                    const tx = e.releaseTx || e.pauseTx || e.commitTx;
                    return (
                      <tr key={e.epochId} className="border-t border-line">
                        <td className="py-2 pr-3 font-mono">#{e.sequence}{e.milestoneIndex !== 255 && ` (milestone ${e.milestoneIndex + 1})`}</td>
                        <td className="py-2 pr-3 font-mono">{e.score}</td>
                        <td className="py-2 pr-3">
                          {e.skipped ? `Recorded, not evaluated (${e.skipped.toLowerCase().replace(/_/g, " ")})` : e.releaseTx ? "Passed: milestone released" : e.pauseTx ? "Failed: facility paused" : (ACTIONS[e.action] ?? e.action)}
                          {!e.pass && e.reasons.length > 0 && <span className="block text-xs text-slate">{e.reasons.join(", ").toLowerCase().replace(/_/g, " ")}</span>}
                          {e.error && <span className="block text-xs text-danger">{e.error}</span>}
                        </td>
                        <td className="py-2">{tx ? <HashBadge value={tx} chainId={chainId} compact /> : "–"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate">No epoch closed yet: an epoch closes once each sensor has 8 readings in it.</p>
          )}
        </section>
      )}
    </Modal>
  );
}
