"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { HashBadge } from "@/components/ui/HashBadge";
import { Modal } from "@/components/ui/Modal";
import { ApiError, postReadings } from "@/lib/api/client";
import type { EpochOutcome, Shipment } from "@/lib/api/schemas";
import { batches, CSV_COLUMNS, detectColumns, OPTIONAL_FIELDS, parseReadingsCsv, readHeader, templateCsv, type ColumnMap, type DateOrder, type Field, type ParsedCsv } from "@/lib/csv";
import { downloadText } from "@/lib/download";
import { decodeKeyFile, type KeyFile } from "@/lib/gateway";
import { chainRejectedText } from "@/lib/chain/errors";
import { shortHash } from "@/lib/format";
import { distanceText, isHeld } from "@/lib/places";

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
  HELD_NOT_AT_PLACE: "Held: not at the place yet",
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
  const [csv, setCsv] = useState<{ name: string; text: string; nowSec: number } | null>(null);
  const [read, setRead] = useState<ReadOptions>(defaultRead);
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
    setCsv(null);
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
    const text = await file.text();
    setCsv({ name: file.name, text, nowSec: Math.floor(Date.now() / 1000) });
    // a new file starts from detection again; with other column names, optional fields the file lacks start as "not in the file"
    const d = detectColumns(readHeader(text));
    setRead(d.exact ? defaultRead : { ...defaultRead, mapping: { ...d.columns } });
  }

  const csvName = csv?.name ?? null;
  const parsed: ParsedCsv | null = useMemo(
    () =>
      csv && key
        ? parseReadingsCsv(csv.text, {
            nowSec: csv.nowSec,
            band: { minC: shipment.policy.minTempX100 / 100, maxC: shipment.policy.maxTempX100 / 100 },
            sensors: key.sensorIds,
            mapping: read.mapping,
            fahrenheit: read.fahrenheit,
            timeZone: read.timeZone,
            dateOrder: read.dateOrder,
            sensorId: read.sensorId,
          })
        : null,
    [csv, key, read, shipment.policy.minTempX100, shipment.policy.maxTempX100],
  );
  const detected = useMemo(() => (parsed ? detectColumns(parsed.header) : null), [parsed]);

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
            A CSV with the columns <code className="font-mono text-ink">timestamp, sensor_id, temperature_c, humidity_pct, latitude, longitude, shock_g</code>. Other column names, °F and local times can be mapped once the file is chosen.{" "}
            <button type="button" className="font-semibold text-ink underline" onClick={() => downloadText("cargoflow-readings-template.csv", templateCsv(key?.sensorIds ?? ["probe-1", "probe-2"]), "text/csv")}>
              Download a template
            </button>
          </p>
          <div className="mt-2 flex items-center gap-3">
            <label htmlFor={csvInput} aria-disabled={!key || undefined} className={buttonClass("secondary", "sm", key ? "cursor-pointer" : undefined)}>
              Choose CSV
            </label>
            <input id={csvInput} type="file" accept=".csv,text/csv" className="sr-only" disabled={!key} onChange={(e) => {
              void pickCsv(e.target.files?.[0]);
              e.target.value = "";
            }} aria-label="Readings CSV" />
            {csvName && <span className="truncate text-sm">{csvName}</span>}
          </div>

          {parsed && key && detected && (
            <ReadSettings parsed={parsed} exact={detected.exact} detectedF={detected.fahrenheit} sensors={key.sensorIds} value={read} onChange={setRead} />
          )}

          {parsed && parsed.errors.length > 0 && (
            <div role="alert" className="mt-3 rounded-2xl border-2 border-danger/40 p-3 text-sm">
              <p className="font-semibold text-danger">Fix {parsed.errors.length === 1 ? "this problem" : `these ${parsed.errors.length} problems`} (map the columns above, or correct the file and choose it again). Nothing has been sent.</p>
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
              <ReadNotes parsed={parsed} />
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
                          {e.skipped ? `Recorded, not evaluated (${e.skipped.toLowerCase().replace(/_/g, " ")})` : e.releaseTx ? "Passed: milestone released" : e.pauseTx ? "Failed: facility paused" : isHeld(e) ? <span className="font-semibold">Held: not at the place yet</span> : (ACTIONS[e.action] ?? e.action)}
                          {isHeld(e) && !e.releaseTx && !e.skipped && (
                            <span className="block text-xs text-slate">Passed the policy, but taken {e.distanceM ? `${distanceText(e.distanceM)} from` : "outside"} the milestone&apos;s place: it waits, nothing failed.</span>
                          )}
                          {!e.pass && e.reasons.length > 0 && <span className="block text-xs text-slate">{e.reasons.join(", ").toLowerCase().replace(/_/g, " ")}</span>}
                          {e.error && <span className="block text-xs text-danger">{chainRejectedText(e.error)}</span>}
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

// --- how the file is read: column mapping, unit, time zone and date order

type ReadOptions = { mapping?: Partial<ColumnMap>; fahrenheit?: boolean; timeZone: string; dateOrder?: DateOrder; sensorId?: string };
const defaultRead: ReadOptions = { timeZone: "UTC" };

const FIELD_LABELS: Record<Field, string> = {
  timestamp: "Time",
  sensor_id: "Sensor",
  temperature_c: "Temperature",
  humidity_pct: "Humidity",
  latitude: "Latitude",
  longitude: "Longitude",
  shock_g: "Shock",
};

function timeZones(): string[] {
  const local = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    /* older runtimes: UTC and the local zone only */
  }
  return [...new Set(["UTC", local, ...all.filter((z) => z !== "UTC")])];
}

const CHOOSE = "choose";
const selectClass = "h-10 w-full min-w-0 rounded-xl border-2 border-line bg-white px-3 text-sm outline-none focus:border-ink";

function ReadSettings({ parsed, exact, detectedF, sensors, value, onChange }: { parsed: ParsedCsv; exact: boolean; detectedF: boolean; sensors: string[]; value: ReadOptions; onChange: (v: ReadOptions) => void }) {
  const id = useId();
  const zones = useMemo(() => timeZones(), []);
  const cols = parsed.columns;
  const showMapping = !exact || !!value.mapping;
  const setField = (f: Field, v: string) => {
    const mapping: Partial<ColumnMap> = { ...cols, ...value.mapping, [f]: v === "" ? null : Number(v) };
    onChange({ ...value, mapping, sensorId: f === "sensor_id" && v === "" ? (value.sensorId ?? sensors[0]) : value.sensorId });
  };
  const fahrenheit = value.fahrenheit ?? detectedF;
  // "" means deliberately not in the file; CHOOSE means nothing matched yet
  const selectValue = (f: Field) => {
    const c = cols[f];
    if (c !== null) return String(c);
    if (f === "sensor_id") return value.mapping?.sensor_id === null && value.sensorId ? "" : CHOOSE;
    return OPTIONAL_FIELDS.includes(f) && value.mapping?.[f] === null ? "" : CHOOSE;
  };
  return (
    <div className="mt-3 rounded-2xl border-2 border-line p-4 text-sm">
      {showMapping && (
        <>
          <p className="font-semibold">Match the file&apos;s columns</p>
          <p className="mt-0.5 text-slate">The header does not use CargoFlow&apos;s column names, so we matched them by their usual names. Check each one.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {CSV_COLUMNS.map((f) => (
              <div key={f}>
                <label htmlFor={`${id}-${f}`} className="mb-1 block text-xs font-semibold text-slate">{FIELD_LABELS[f]}</label>
                <select id={`${id}-${f}`} value={selectValue(f)} onChange={(e) => setField(f, e.target.value)} className={selectClass}>
                  {selectValue(f) === CHOOSE && <option value={CHOOSE} disabled>Choose a column</option>}
                  {(OPTIONAL_FIELDS.includes(f) || f === "sensor_id") && <option value="">{f === "sensor_id" ? "Not in the file (one sensor)" : "Not in the file (sent as 0)"}</option>}
                  {parsed.header.map((h, i) => (
                    <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {cols.sensor_id === null && value.mapping?.sensor_id === null && value.sensorId && (
            <div className="mt-3 max-w-xs">
              <label htmlFor={`${id}-sensor`} className="mb-1 block text-xs font-semibold text-slate">Every row comes from</label>
              <select id={`${id}-sensor`} value={value.sensorId ?? sensors[0]} onChange={(e) => onChange({ ...value, sensorId: e.target.value })} className={selectClass}>
                {sensors.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
        </>
      )}
      <div className={`grid gap-3 sm:grid-cols-3 ${showMapping ? "mt-4 border-t border-line pt-4" : ""}`}>
        <div>
          <label htmlFor={`${id}-unit`} className="mb-1 block text-xs font-semibold text-slate">Temperature unit</label>
          <select id={`${id}-unit`} value={fahrenheit ? "F" : "C"} onChange={(e) => onChange({ ...value, fahrenheit: e.target.value === "F" })} className={selectClass}>
            <option value="C">°C</option>
            <option value="F">°F (converted to °C)</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-tz`} className="mb-1 block text-xs font-semibold text-slate">Time zone for times without one</label>
          <select id={`${id}-tz`} value={value.timeZone} onChange={(e) => onChange({ ...value, timeZone: e.target.value })} className={selectClass}>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
        {parsed.notes.dateOrder && (
          <div>
            <label htmlFor={`${id}-order`} className="mb-1 block text-xs font-semibold text-slate">Dates like 03/04</label>
            <select id={`${id}-order`} value={value.dateOrder ?? parsed.notes.dateOrder} onChange={(e) => onChange({ ...value, dateOrder: e.target.value as DateOrder })} className={selectClass}>
              <option value="dmy">Day first (3 April)</option>
              <option value="mdy">Month first (March 4)</option>
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

/** Plain statements of how the file was read, shown with the preview before anything is sent. */
function ReadNotes({ parsed }: { parsed: ParsedCsv }) {
  const n = parsed.notes;
  const lines: string[] = [];
  if (n.zoneless > 0) lines.push(`${n.zoneless.toLocaleString("en-US")} timestamp${n.zoneless === 1 ? " has" : "s have"} no time zone and ${n.zoneless === 1 ? "was" : "were"} read as ${n.timeZone === "UTC" ? "UTC" : `local time in ${n.timeZone}`}.`);
  if (n.milliseconds > 0) lines.push("13-digit timestamps were read as milliseconds since 1970.");
  if (n.fahrenheit) lines.push("Temperatures were converted from °F to °C.");
  if (n.dateOrder) lines.push(`Dates were read ${n.dateOrder === "dmy" ? "day first" : "month first"}${n.dateOrderAmbiguous ? "; no date in the file settles the order, so check it" : ""}.`);
  if (n.filled.includes("humidity_pct")) lines.push("Humidity is not in the file and is sent as 0.");
  if (n.filled.includes("shock_g")) lines.push("Shock is not in the file and is sent as 0.");
  if (n.filled.includes("sensor_id")) lines.push(`Every reading is attributed to ${parsed.points[0]?.sensorId ?? "one sensor"}.`);
  if (!lines.length) return null;
  return (
    <ul className="col-span-full list-disc space-y-0.5 pl-5 text-ink/80">
      {lines.map((l) => <li key={l}>{l}</li>)}
    </ul>
  );
}
