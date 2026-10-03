// Structured logs: one JSON object per line on stderr (for journald, Docker and log shippers), or a readable line
// when a person is watching a terminal. stdout is kept for command output (status, init instructions).
export type Level = "debug" | "info" | "warn" | "error";
export type LogFormat = "json" | "pretty";

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(opts: { format?: LogFormat; level?: Level; write?: (line: string) => void } = {}): Logger {
  const format = opts.format ?? (process.stderr.isTTY ? "pretty" : "json");
  const min = ORDER[opts.level ?? "info"];
  const write = opts.write ?? ((line: string) => process.stderr.write(line + "\n"));
  const emit = (level: Level, msg: string, fields: Record<string, unknown> = {}) => {
    if (ORDER[level] < min) return;
    const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    if (format === "json") {
      write(JSON.stringify({ time: new Date().toISOString(), level, msg, ...clean }));
      return;
    }
    const extra = Object.entries(clean)
      .map(([k, v]) => `${k}=${typeof v === "string" ? (/\s/.test(v) ? JSON.stringify(v) : v) : JSON.stringify(v)}`)
      .join(" ");
    const tag = { debug: "DBG", info: "INF", warn: "WRN", error: "ERR" }[level];
    write(`${new Date().toISOString().slice(11, 19)} ${tag} ${msg}${extra ? "  " + extra : ""}`);
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
