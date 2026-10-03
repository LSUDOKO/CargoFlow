// Plain-language formatting for tool output: amounts in USDG, temperatures in °C, times in UTC.
import { CargoFlowApiError } from "@cargoflow/sdk";

export const USDG_DECIMALS = 6;

/** "20000000" (base units) -> "20 USDG"; "1234567" -> "1.234567 USDG". */
export function usdg(base: string | bigint | number | undefined | null): string {
  if (base === undefined || base === null || base === "") return "–";
  let v: bigint;
  try {
    v = BigInt(base);
  } catch {
    return `${String(base)} (base units)`;
  }
  const neg = v < 0n;
  if (neg) v = -v;
  const whole = v / 10n ** BigInt(USDG_DECIMALS);
  const frac = (v % 10n ** BigInt(USDG_DECIMALS)).toString().padStart(USDG_DECIMALS, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""} USDG`;
}

/** A decimal USDG amount ("40,000.5") in base units, or undefined when it is not a valid amount. */
export function parseUsdg(v: string): bigint | undefined {
  const t = v.trim().replace(/,/g, "");
  const m = t.match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!m) return undefined;
  return BigInt(m[1]!) * 10n ** 6n + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
}

export const temp = (x100: number | undefined) => (x100 === undefined ? "–" : `${(x100 / 100).toFixed(2)} °C`);
export const pct = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
export const humidity = (x100: number | undefined) => (x100 === undefined ? "–" : `${(x100 / 100).toFixed(1)}% RH`);
export const shock = (x100: number | undefined) => (x100 === undefined ? "–" : `${(x100 / 100).toFixed(2)} g`);
export const coord = (latE6: number, lonE6: number) => `${(latE6 / 1e6).toFixed(4)}, ${(lonE6 / 1e6).toFixed(4)}`;
export const unix = (sec: number) => (sec > 0 ? new Date(sec * 1000).toISOString().replace(".000Z", "Z") : "–");
export const km = (m: number) => (m >= 10_000 ? `${Math.round(m / 1000)} km` : `${(m / 1000).toFixed(1)} km`);

/** A tool result with text content. */
export const text = (...parts: string[]) => ({ content: parts.filter(Boolean).map((t) => ({ type: "text" as const, text: t })) });

/** A tool error: a plain sentence, no stack. */
export const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });

export const json = (v: unknown) => "```json\n" + JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2) + "\n```";

/** Turns any thrown error into a plain message for the model and the person reading it. */
export function errorMessage(e: unknown): string {
  if (e instanceof CargoFlowApiError) {
    if (e.code === "unreachable") return `${e.message} Check CARGOFLOW_API_URL and your network.`;
    if (e.code === "timeout" || (e.code === "http_error" && [502, 503, 504].includes(e.status)))
      return `The CargoFlow API is waking up (it sleeps when idle and takes up to a minute to start); try again in a moment. (${e.message})`;
    if (e.status === 404) return `Not found: ${e.message}`;
    if (e.code === "bad_response") return `The CargoFlow API answered in an unexpected shape (${e.path}). It may be a different version than this server expects.`;
    return `The CargoFlow API refused the request (${e.status} ${e.code}): ${e.message}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Wraps a tool handler so every failure comes back as a plain tool error instead of a protocol error. */
export function safe<A>(fn: (args: A) => Promise<ReturnType<typeof text> | ReturnType<typeof fail>>) {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (e) {
      return fail(errorMessage(e));
    }
  };
}

/** A user-facing refusal raised inside a handler (already worded for the person). */
export class Refusal extends Error {}
