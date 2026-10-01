// Display formatting. USDG amounts arrive as decimal strings of base units (6 decimals) and are formatted with
// bigint arithmetic only, so no amount is ever rounded through a float.

const DECIMALS = 6n;
const SCALE = 10n ** DECIMALS;
const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function toBig(v: string | bigint): bigint {
  if (typeof v === "bigint") return v;
  const t = v.trim();
  return t === "" ? 0n : BigInt(t);
}

/** Formats USDG base units, e.g. "40000000000" -> "40,000"; `compact` gives "98.8K". */
export function formatUSDG(v: string | bigint, opts: { compact?: boolean } = {}): string {
  const n = toBig(v);
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  if (opts.compact && abs >= 1000n * SCALE) {
    const units: [string, bigint][] = [
      ["B", 10n ** 9n],
      ["M", 10n ** 6n],
      ["K", 10n ** 3n],
    ];
    const [label, size] = units.find(([, u]) => abs >= u * SCALE) ?? ["K", 10n ** 3n];
    const tenths = (abs * 10n) / (size * SCALE);
    const whole = tenths / 10n;
    const tenth = tenths % 10n;
    return `${sign}${whole}${tenth ? `.${tenth}` : ""}${label}`;
  }
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(Number(DECIMALS), "0").replace(/0+$/, "");
  return `${sign}${group(whole.toString())}${frac ? `.${frac}` : ""}`;
}

/** Basis points as a percentage with one decimal, e.g. 7800 -> "78.0%". */
export const formatBps = (bps: number) => `${(bps / 100).toFixed(1)}%`;

/** Temperature in hundredths of a degree, e.g. 1170 -> "11.7 °C". */
export const formatTempX100 = (v: number) => `${(v / 100).toFixed(1)} °C`;

/** Shortens a hex hash or address, keeping `head` characters after 0x and `tail` at the end. */
export const shortHash = (hex: string, head = 6, tail = 4) =>
  hex.length <= 2 + head + tail + 1 ? hex : `${hex.slice(0, 2 + head)}…${hex.slice(-tail)}`;
