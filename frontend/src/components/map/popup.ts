// HTML for the map's tooltips (MapLibre popups take an HTML string). Every value that comes from the API is
// escaped; the markup is styled by map.css under .cf-pop.

import { explorerTx, ROBINHOOD_TESTNET_ID } from "@/lib/explorer";
import { formatKm, formatLatLon } from "@/lib/geo/route";
import type { SceneTrackPoint, SceneVessel } from "@/lib/geo/scene";
import { compass, type Band, type MilestoneMark, type TempClass } from "@/lib/geo/voyage";

export const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const utc = (s: number, withDay = true) =>
  new Date(s * 1000).toLocaleString("en-GB", { ...(withDay ? { day: "numeric", month: "short" } : {}), hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
export const when = (s: number) => `${utc(s)} UTC`;
const deg = (x100: number) => (x100 / 100).toFixed(1);

export const CLASS_LABEL: Record<TempClass, string> = { in: "In band", near: "Near limit", out: "Out of band" };

/** The explorer link for a transaction; the Robinhood testnet explorer when the chain is not known yet. */
export const txHref = (chainId: number | undefined, hash: string) => explorerTx(chainId ?? ROBINHOOD_TESTNET_ID, hash);

const row = (k: string, v: string) => `<div class="cf-pop__row"><dt>${k}</dt><dd>${v}</dd></div>`;

function evidenceLink(epochId: string, tx: string | undefined, chainId: number | undefined, label = "commit") {
  const href = tx ? txHref(chainId, tx) : null;
  if (href) return `<a class="cf-pop__link" href="${esc(href)}" target="_blank" rel="noreferrer">View ${label} transaction <span aria-hidden="true">↗</span></a>`;
  return `<button type="button" class="cf-pop__link" data-epoch="${esc(epochId)}">Open in the Evidence tab</button>`;
}

export function trackPopup(p: SceneTrackPoint, cls: TempClass, band: Band | null, alongKm: number | null, tx: string | undefined, chainId: number | undefined): string {
  const same = Math.floor(p.startTime / 86400) === Math.floor(p.endTime / 86400);
  const span = `${utc(p.startTime)} – ${utc(p.endTime, !same)} UTC`;
  const extras: string[] = [];
  if (typeof p.maxHumidityX100 === "number") extras.push(row("Humidity", `max ${(p.maxHumidityX100 / 100).toFixed(0)} %`));
  if (typeof p.maxShockX100 === "number") extras.push(row("Shock", `max ${(p.maxShockX100 / 100).toFixed(1)} g`));
  return `<div class="cf-pop">
  <div class="cf-pop__head"><span class="cf-pop__title">Batch #${p.sequence}${p.milestoneIndex !== 255 ? ` · Milestone ${p.milestoneIndex + 1}` : ""}</span><span class="cf-chip cf-chip--${cls}">${CLASS_LABEL[cls]}</span></div>
  <p class="cf-pop__sub">${esc(span)}</p>
  <dl>
    ${row("Temperature", `<b>${deg(p.minTempX100)} to ${deg(p.maxTempX100)} °C</b>${band ? ` <span class="cf-pop__muted">band ${deg(band.minX100)} to ${deg(band.maxX100)}</span>` : ""}`)}
    ${extras.join("")}
    ${row("Position", `${esc(formatLatLon([p.lon, p.lat], 2))}${alongKm !== null ? ` <span class="cf-pop__muted">· km ${Math.round(alongKm).toLocaleString("en-US")}</span>` : ""}`)}
    ${row("Policy", `<span class="cf-dot cf-dot--${p.pass ? "pass" : "fail"}"></span>${p.pass ? "Passed" : "Failed"} · ${p.committed ? "on chain" : "not yet on chain"}`)}
  </dl>
  ${evidenceLink(p.epochId, tx, chainId)}
</div>`;
}

const MS_LABEL = { released: "Released", paused: "Blocked: facility paused", next: "Awaiting evidence", pending: "Pending" } as const;

export function milestonePopup(m: MilestoneMark, amount: string | undefined, releaseTx: string | undefined, commitTx: string | undefined, chainId: number | undefined): string {
  const href = releaseTx ? txHref(chainId, releaseTx) : null;
  return `<div class="cf-pop">
  <div class="cf-pop__head"><span class="cf-pop__title">Milestone ${m.index + 1}</span><span class="cf-chip cf-chip--ms-${m.state}">${MS_LABEL[m.state]}</span></div>
  <dl>
    ${amount ? row("Releases", `<b>${esc(amount)} USDG</b>`) : ""}
    ${row("Where", m.planned ? `about km ${Math.round(m.alongKm).toLocaleString("en-US")} <span class="cf-pop__muted">(no evidence yet)</span>` : `km ${Math.round(m.alongKm).toLocaleString("en-US")} of the route`)}
    ${m.time ? row("Evidence", when(m.time)) : ""}
  </dl>
  ${href ? `<a class="cf-pop__link" href="${esc(href)}" target="_blank" rel="noreferrer">View release transaction <span aria-hidden="true">↗</span></a>` : m.epochId ? evidenceLink(m.epochId, commitTx, chainId) : ""}
</div>`;
}

export function pausePopup(reason: string, resumed: boolean, time: number | undefined, epochId: string | undefined, tx: string | undefined, chainId: number | undefined): string {
  return `<div class="cf-pop">
  <div class="cf-pop__head"><span class="cf-pop__title">Facility paused here</span><span class="cf-chip cf-chip--${resumed ? "in" : "near"}">${resumed ? "Resumed" : "Paused"}</span></div>
  <p class="cf-pop__body">${esc(humanReason(reason))}</p>
  ${time ? `<p class="cf-pop__sub">${when(time)}</p>` : ""}
  ${epochId ? evidenceLink(epochId, tx, chainId) : ""}
</div>`;
}

export function portPopup(name: string, code: string | undefined, role: string, alongKm: number, totalKm: number): string {
  const what = role === "origin" ? "Port of loading" : role === "destination" ? "Port of discharge" : "Transshipment stop";
  return `<div class="cf-pop">
  <div class="cf-pop__head"><span class="cf-pop__title">${esc(name)}</span>${code ? `<span class="cf-pop__code">${esc(code)}</span>` : ""}</div>
  <p class="cf-pop__sub">${what}</p>
  <dl>${row("Along route", role === "origin" ? "start" : `km ${Math.round(alongKm).toLocaleString("en-US")} of ${formatKm(totalKm)}`)}</dl>
</div>`;
}

/** Policy reason codes ("TEMPERATURE_OUT_OF_RANGE") as words ("Temperature out of range"); free text is kept. */
export function humanReason(r: string): string {
  if (!/^[A-Z0-9_,\s]+$/.test(r)) return r;
  return r
    .split(/\s*,\s*/)
    .map((c) => c.toLowerCase().replace(/_/g, " "))
    .join(", ")
    .replace(/^./, (ch) => ch.toUpperCase());
}

export function aisPopup(v: SceneVessel, link: "ok" | "warn" | "idle"): string {
  const check = link === "idle" ? "Not compared (the AIS report is too old or too far apart in time)" : link === "warn" ? "Disagrees with the logger" : "Agrees with the logger";
  return `<div class="cf-pop">
  <div class="cf-pop__head"><span class="cf-pop__title">${esc(v.name)}</span><span class="cf-pop__code">AIS</span></div>
  <p class="cf-pop__sub">MMSI ${esc(v.mmsi)} · ${v.live ? "live feed" : "last report"} ${when(v.timestamp)}</p>
  <dl>
    ${v.sogKn !== null ? row("Speed", `${v.sogKn.toFixed(1)} kn`) : ""}
    ${v.cogDeg !== null ? row("Course", `${Math.round(v.cogDeg)}° ${compass(v.cogDeg)}`) : ""}
    ${v.gapKm !== null ? row("To logger", formatKm(v.gapKm)) : ""}
    ${row("Cross-check", `<span class="cf-dot cf-dot--${link === "idle" ? "idle" : link === "warn" ? "fail" : "pass"}"></span>${check}`)}
  </dl>
</div>`;
}
