import { Command, Option } from "commander";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { resolveHome, writeFileAtomic } from "./fsutil.js";
import { Gateway, keyPath, loadKey, type ParseSettings } from "./gateway.js";
import { createLogger, type Level, type LogFormat, type Logger } from "./log.js";
import { detectVolumes, hasOnlyPdf, newestExport } from "./mount.js";
import { PRESETS, type PresetId } from "./parsers/presets.js";
import { DiskQueue } from "./queue.js";
import { DEFAULT_SITE_URL, registerKey, registeredSources, registrationMessage, shipmentPageUrl } from "./register.js";
import { DEFAULT_API_URL } from "./sender.js";
import { createLineParser, openSerialLines } from "./serial.js";
import { decodeKeyFile, encodeKeyFile, newSeed, type KeyFile } from "./signing.js";
import { GatewayState } from "./state.js";
import { watchFolder } from "./watch.js";

const VERSION = "0.1.0";

// `cargoflow-gateway status | head` closes stdout early; that is not an error
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});
const SENSOR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

interface Globals {
  home?: string;
  key?: string;
  api: string;
  preset: PresetId;
  tz?: string;
  fahrenheit?: boolean;
  celsius?: boolean;
  dateOrder?: "dmy" | "mdy";
  sensor?: string;
  sensorMap?: string;
  position?: string;
  delimiter?: string;
  dryRun?: boolean;
  logFormat?: LogFormat;
  logLevel: Level;
}

const program = new Command();
program
  .name("cargoflow-gateway")
  .description("Sign data-logger readings with this gateway's Ed25519 key and deliver them to CargoFlow, with a durable offline queue.")
  .version(VERSION)
  .option("--home <dir>", "data directory (key, state, queue); default $CARGOFLOW_GATEWAY_HOME or ~/.cargoflow-gateway")
  .option("--key <file>", "use this key file instead of <home>/key.json")
  .option("--api <url>", "CargoFlow API", process.env.CARGOFLOW_API_URL || DEFAULT_API_URL)
  .addOption(new Option("--preset <id>", "logger export format").choices(["auto", ...PRESETS.map((p) => p.id)]).default("auto"))
  .option("--tz <zone>", "time zone for timestamps written without one (IANA name, UTC or +05:30); default: from the export, else UTC")
  .option("--fahrenheit", "temperatures are in °F (default: detected from the header or preamble)")
  .option("--celsius", "temperatures are in °C even if the header suggests otherwise")
  .addOption(new Option("--date-order <order>", "for dates like 03/04/2027").choices(["dmy", "mdy"]))
  .option("--sensor <id>", "sensor id for exports without a sensor column")
  .option("--sensor-map <pairs>", "logger serial -> sensor id for single-probe exports, e.g. EF1234=probe-1,EF5678=probe-2")
  .option("--position <lat,lon>", "fixed position for loggers without GPS, e.g. 1.264,103.84")
  .option("--delimiter <char>", "column delimiter (default: detected; use 'tab' for tabs)")
  .option("--dry-run", "parse and sign but send nothing and change no state")
  .addOption(new Option("--log-format <format>", "log output").choices(["json", "pretty"]))
  .addOption(new Option("--log-level <level>", "minimum log level").choices(["debug", "info", "warn", "error"]).default("info"));

function globals(cmd: Command): Globals {
  return cmd.optsWithGlobals() as Globals;
}

function logger(g: Globals): Logger {
  return createLogger({ format: g.logFormat, level: g.logLevel });
}

function parseSettings(g: Globals): ParseSettings {
  const s: ParseSettings = { preset: g.preset, timeZone: g.tz, dateOrder: g.dateOrder, sensor: g.sensor };
  if (g.fahrenheit && g.celsius) throw new Error("Pass --fahrenheit or --celsius, not both.");
  if (g.fahrenheit) s.fahrenheit = true;
  if (g.celsius) s.fahrenheit = false;
  if (g.sensor && !SENSOR.test(g.sensor)) throw new Error(`--sensor "${g.sensor}" may use letters, digits, dot, dash and underscore.`);
  if (g.sensorMap) {
    s.sensorMap = {};
    for (const pair of g.sensorMap.split(",").filter(Boolean)) {
      const [serial, sensor] = pair.split("=").map((x) => x.trim());
      if (!serial || !sensor || !SENSOR.test(sensor)) throw new Error(`--sensor-map entry "${pair}" must look like SERIAL=sensor-id.`);
      s.sensorMap[serial] = sensor;
    }
  }
  if (g.position) {
    const [lat, lon] = g.position.split(",").map((x) => Number(x.trim()));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat!) > 90 || Math.abs(lon!) > 180) throw new Error("--position must be <lat,lon> in degrees, e.g. 1.264,103.84");
    s.position = { lat: lat!, lon: lon! };
  }
  if (g.delimiter) s.delimiter = g.delimiter === "tab" || g.delimiter === "\\t" ? "\t" : g.delimiter;
  return s;
}

async function openGateway(g: Globals): Promise<Gateway> {
  const home = resolveHome(g.home);
  return Gateway.open({ home, keyFile: g.key, apiUrl: g.api, log: logger(g), parse: parseSettings(g), dryRun: g.dryRun });
}

function onShutdown(fn: () => Promise<void>, log: Logger) {
  let stopping = false;
  const stop = (sig: string) => {
    if (stopping) process.exit(130);
    stopping = true;
    log.info("shutting down; queued readings are kept on disk", { signal: sig });
    fn().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

const out = (s = ""): void => void process.stdout.write(s + "\n");

function printKeySummary(key: KeyFile, file: string) {
  out(`  key file    ${file}`);
  out(`  shipment    ${key.shipmentId}`);
  out(`  source id   ${key.sourceId}`);
  out(`  public key  ${key.publicKey}`);
  out(`  sensors     ${key.sensorIds.join(", ") || "(none)"}`);
  if (key.label) out(`  label       ${key.label}`);
}

// --- init

program
  .command("init")
  .description("import a key file from the shipment page, or generate a new key and print how to register it")
  .addHelpText("after", "\nWith --key <file>: import that key file (downloaded from the shipment page's \"Add a sensor gateway\") into <home>.")
  .option("--shipment <id>", "shipment id (0x…, 32 bytes) for a newly generated key")
  .option("--sensors <ids>", "comma-separated sensor ids exactly as in the logger exports, e.g. probe-1,probe-2")
  .option("--label <name>", "name shown to the parties, e.g. \"Reefer logger MSKU 123456-7\"", "")
  .option("--site <url>", "CargoFlow website", process.env.CARGOFLOW_SITE_URL || DEFAULT_SITE_URL)
  .option("--force", "overwrite an existing key in <home>")
  .option("--offline", "do not ask the API whether the key is registered")
  .action(async (opts: { shipment?: string; sensors?: string; label: string; site: string; force?: boolean; offline?: boolean }, cmd: Command) => {
    const g = globals(cmd);
    const importFile = g.key;
    const home = resolveHome(g.home);
    const dest = keyPath(home);
    if (existsSync(dest) && !opts.force) {
      const existing = await loadKey(dest).catch(() => undefined);
      throw new Error(`A key already exists at ${dest}${existing ? ` (${existing.sourceId}, shipment ${existing.shipmentId})` : ""}. Pass --force to replace it (the old key stops being usable from this gateway).`);
    }
    let key: KeyFile;
    let text: string;
    if (importFile) {
      text = await fs.readFile(importFile, "utf8");
      key = decodeKeyFile(text);
    } else {
      if (!opts.shipment || !/^0x[0-9a-fA-F]{64}$/.test(opts.shipment)) throw new Error("Pass --key <file> to import a key, or --shipment <0x… 64 hex digits> and --sensors to generate one.");
      const sensors = (opts.sensors ?? "").split(/[\s,]+/).filter(Boolean);
      if (!sensors.length || sensors.length > 16) throw new Error("Name 1 to 16 sensors with --sensors, exactly as they appear in the logger's export.");
      const bad = sensors.find((s) => !SENSOR.test(s));
      if (bad) throw new Error(`Sensor id "${bad}" may use letters, digits, dot, dash and underscore.`);
      if (new Set(sensors).size !== sensors.length) throw new Error("Each sensor id must be different.");
      if (opts.label.length > 80) throw new Error("The label is at most 80 characters.");
      text = encodeKeyFile({ shipmentId: opts.shipment, label: opts.label.trim(), sensorIds: sensors, seed: newSeed() });
      key = decodeKeyFile(text);
    }
    if (g.dryRun) {
      out("Dry run: no key written.");
      printKeySummary(key, dest);
      return;
    }
    await writeFileAtomic(dest, text + (text.endsWith("\n") ? "" : "\n"), 0o600);
    out(importFile ? "Key imported." : "New gateway key generated.");
    printKeySummary(key, dest);
    out();
    let registered: boolean | undefined;
    if (!opts.offline) {
      try {
        registered = (await registeredSources(key.shipmentId, g.api)).some((s) => s.id === key.sourceId);
      } catch (err) {
        out(`(Could not check registration: ${(err as Error).message})`);
      }
    }
    if (registered) {
      out("This key is registered on the shipment. Next:");
      out(`  cargoflow-gateway watch /path/to/logger/exports`);
      return;
    }
    const page = shipmentPageUrl(key.shipmentId, opts.site);
    out(registered === false ? "This key is NOT registered on the shipment yet. To register it:" : "To register this key on the shipment:");
    out();
    out("  1. On this machine run");
    out("       cargoflow-gateway register");
    out("     It prints a message naming the shipment, this public key and the sensors. The shipment's exporter signs");
    out("     it with its wallet (\"Sign message\" / EIP-191 personal_sign; no gas, no transaction) and pastes the 0x…");
    out("     signature back within 10 minutes. With Foundry's cast, in one go:");
    out('       SIG=$(cast wallet sign --interactive "$(cargoflow-gateway register --print-message)")');
    out('       cargoflow-gateway register --signature "$SIG"');
    out();
    out(`  2. Or skip this key: open ${page}`);
    out('     with the exporter wallet, choose "Add a sensor gateway", download the key file it creates and run');
    out("       cargoflow-gateway init --key <downloaded file> --force");
    out();
    out(`  Check at any time with: cargoflow-gateway status`);
  });

// --- register

program
  .command("register")
  .description("register this gateway's key on its shipment with the exporter's wallet signature")
  .option("--print-message", "print only the message to sign (with a fresh issued-at time) and exit")
  .option("--issued-at <unix>", "the issued-at time of a message signed earlier (with --signature)")
  .option("--signature <hex>", "the exporter's 0x… signature of the message")
  .action(async (opts: { printMessage?: boolean; issuedAt?: string; signature?: string }, cmd: Command) => {
    const g = globals(cmd);
    const home = resolveHome(g.home);
    const key = await loadKey(g.key ?? keyPath(home));
    const pendingFile = path.join(home, "register-issued-at");
    if (opts.printMessage) {
      const issuedAt = Math.floor(Date.now() / 1000);
      await writeFileAtomic(pendingFile, String(issuedAt));
      process.stdout.write(registrationMessage(key, issuedAt));
      return;
    }
    let issuedAt = opts.issuedAt ? Number(opts.issuedAt) : undefined;
    let signature = opts.signature;
    if (signature && issuedAt === undefined) {
      const saved = await fs.readFile(pendingFile, "utf8").catch(() => "");
      issuedAt = saved ? Number(saved) : undefined;
      if (!issuedAt) throw new Error("Pass --issued-at with --signature (the time printed in the signed message's last line).");
    }
    if (!signature) {
      issuedAt = Math.floor(Date.now() / 1000);
      out("Sign this message with the shipment exporter's wallet (EIP-191 personal_sign):");
      out();
      out(registrationMessage(key, issuedAt));
      out();
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      signature = (await rl.question("Signature (0x…): ")).trim();
      rl.close();
    }
    if (!/^0x?[0-9a-fA-F]{20,}$/.test(signature)) throw new Error("That does not look like a hex signature.");
    if (g.dryRun) {
      out(`Dry run: would POST the registration for ${key.sourceId} (issued ${issuedAt}).`);
      return;
    }
    const src = await registerKey(key, issuedAt!, signature, g.api);
    await fs.rm(pendingFile, { force: true });
    out(`Registered ${src.id} for shipment ${src.shipmentId} (sensors ${src.sensorIds.join(", ")}).`);
  });

// --- watch

program
  .command("watch")
  .description("watch a folder: new or changed logger exports are parsed, de-duplicated, signed and sent")
  .argument("<folder>", "folder the logger software exports to")
  .option("--flush-interval <seconds>", "how often queued readings are retried", "15")
  .option("--poll", "poll the folder instead of using file-system events (network shares, some Docker mounts)")
  .option("--depth <n>", "sub-folder depth to watch", "2")
  .action(async (folder: string, opts: { flushInterval: string; poll?: boolean; depth: string }, cmd: Command) => {
    const g = globals(cmd);
    if (!existsSync(folder)) throw new Error(`No such folder: ${folder}`);
    const gw = await openGateway(g);
    gw.log.info("gateway started", { sourceId: gw.key.sourceId, shipmentId: gw.key.shipmentId, api: gw.apiUrl, dryRun: !!g.dryRun, version: VERSION });
    const h = watchFolder(gw, folder, { flushIntervalMs: Number(opts.flushInterval) * 1000, poll: opts.poll, depth: Number(opts.depth) });
    onShutdown(() => h.close(), gw.log);
  });

// --- mount

program
  .command("mount")
  .description("read the newest export from USB mass-storage loggers (detected volumes, or --volume)")
  .option("--volume <path...>", "volume(s) to read instead of detecting them")
  .option("--watch", "keep running: check for newly plugged loggers every --interval seconds")
  .option("--interval <seconds>", "check interval with --watch", "10")
  .option("--list", "only list the detected volumes")
  .action(async (opts: { volume?: string[]; watch?: boolean; interval: string; list?: boolean }, cmd: Command) => {
    const g = globals(cmd);
    const log = logger(g);
    const volumes = async () => (opts.volume?.length ? opts.volume.map((p) => ({ path: p, via: "--volume" })) : await detectVolumes());
    if (opts.list) {
      const v = await volumes();
      if (!v.length) out("No removable volumes detected.");
      for (const x of v) out(`${x.path}\t(${x.via})`);
      return;
    }
    const gw = await openGateway(g);
    const scan = async () => {
      const v = await volumes();
      if (!v.length) log.debug("no logger volume found");
      for (const vol of v) {
        const newest = await newestExport(vol.path);
        if (!newest) {
          if (await hasOnlyPdf(vol.path)) log.warn("volume holds only PDF reports; export the data as CSV/TXT with the vendor software", { volume: vol.path });
          continue;
        }
        const r = await gw.ingestFile(newest.file);
        if (r.skipped !== "unchanged") log.info("volume read", { volume: vol.path, file: newest.file, queued: r.queued, duplicate: r.duplicate });
      }
      const f = await gw.flush();
      if (f.sent || f.rejected || f.waiting) log.info("queue", { ...f });
    };
    await scan();
    if (!opts.watch) return finishOneShot(gw);
    const timer = setInterval(() => void scan().catch((e) => log.error("scan failed", { error: (e as Error).message })), Number(opts.interval) * 1000);
    onShutdown(async () => clearInterval(timer), log);
  });

// --- serial

program
  .command("serial")
  .description("read line-delimited CSV or JSON readings streamed over a serial port")
  .argument("<port>", "serial device, e.g. /dev/ttyUSB0 or COM3")
  .option("--baud <rate>", "baud rate", "9600")
  .option("--columns <list>", "header for headerless CSV streams, e.g. timestamp,sensor_id,temperature_c")
  .option("--flush-every <seconds>", "queue buffered readings at least this often", "10")
  .action(async (port: string, opts: { baud: string; columns?: string; flushEvery: string }, cmd: Command) => {
    const g = globals(cmd);
    const gw = await openGateway(g);
    const ps = parseSettings(g);
    const parser = createLineParser({
      nowSec: () => Math.floor(Date.now() / 1000),
      columns: opts.columns?.split(",").map((s) => s.trim()),
      sensors: gw.key.sensorIds,
      sensorId: gw.sensorFor({}),
      fahrenheit: ps.fahrenheit,
      timeZone: ps.timeZone,
      dateOrder: ps.dateOrder,
      position: ps.position,
    });
    let buffer: import("./parsers/generic.js").Reading[] = [];
    let chain = Promise.resolve();
    const drain = () => {
      chain = chain
        .then(async () => {
          if (buffer.length) {
            const take = buffer;
            buffer = [];
            await gw.queueReadings(take, `serial:${port}`);
          }
          await gw.flush();
        })
        .catch((e) => gw.log.error("serial queue failed", { error: (e as Error).message }));
      return chain;
    };
    const handle = await openSerialLines(
      port,
      Number(opts.baud),
      (line) => {
        const r = parser.push(line);
        if (r.header) gw.log.info("serial header", { columns: r.header });
        for (const e of r.errors) gw.log.warn("serial line skipped", { line: e.line, error: e.message });
        buffer.push(...r.points);
        if (buffer.length >= 500) void drain();
      },
      (err) => gw.log.error("serial port error", { error: err.message }),
    );
    gw.log.info("reading serial port", { port, baud: Number(opts.baud), sourceId: gw.key.sourceId });
    const timer = setInterval(() => void drain(), Number(opts.flushEvery) * 1000);
    onShutdown(async () => {
      clearInterval(timer);
      await handle.close();
      await drain();
    }, gw.log);
  });

// --- send

async function finishOneShot(gw: Gateway) {
  const left = await gw.queue.size();
  if (left.batches && !gw.opts.dryRun) {
    gw.log.warn("readings remain queued; they are sent by the next run (or `cargoflow-gateway flush`)", { batches: left.batches, readings: left.readings, lastError: left.lastError });
    process.exitCode = 2;
  }
}

program
  .command("send")
  .description("one-shot: parse export file(s), queue the new readings and send everything queued")
  .argument("<files...>", "CSV/TXT export(s)")
  .option("--force", "re-read files even if unchanged since the last run (duplicates are still dropped)")
  .action(async (files: string[], opts: { force?: boolean }, cmd: Command) => {
    const g = globals(cmd);
    const gw = await openGateway(g);
    let failed = false;
    for (const f of files) {
      const r = await gw.ingestFile(f, { force: opts.force });
      if (r.skipped === "empty") failed = true;
      if (r.skipped !== "unchanged") out(`${f}: ${r.parsed} readings (${r.preset}), ${r.queued} new${r.duplicate ? `, ${r.duplicate} already sent` : ""}${r.old ? `, ${r.old} out of order` : ""}${r.errors ? `, ${r.errors} rows skipped` : ""}`);
      else out(`${f}: unchanged since the last run`);
    }
    const res = await gw.flush(true);
    if (!g.dryRun) out(`sent ${res.readings} readings in ${res.sent} batch(es)${res.rejected ? `, ${res.rejected} refused (see dead/)` : ""}${res.waiting ? `, ${res.waiting} batch(es) still queued` : ""}`);
    await finishOneShot(gw);
    if (failed || res.rejected) process.exitCode = 1;
  });

// --- flush / retry-dead

program
  .command("flush")
  .description("send everything queued now, ignoring retry timers")
  .action(async (_o: unknown, cmd: Command) => {
    const gw = await openGateway(globals(cmd));
    const res = await gw.flush(true);
    out(`sent ${res.readings} readings in ${res.sent} batch(es); ${res.waiting} waiting; ${res.rejected} refused`);
    await finishOneShot(gw);
  });

program
  .command("retry-dead")
  .description("move batches the API refused back into the queue")
  .action(async (_o: unknown, cmd: Command) => {
    const g = globals(cmd);
    const n = await new DiskQueue(resolveHome(g.home)).retryDead();
    out(`${n} batch(es) re-queued`);
  });

// --- status

program
  .command("status")
  .description("key, registration, queue and delivery state")
  .option("--json", "machine-readable output")
  .option("--offline", "do not ask the API whether the key is registered")
  .action(async (opts: { json?: boolean; offline?: boolean }, cmd: Command) => {
    const g = globals(cmd);
    const home = resolveHome(g.home);
    const file = g.key ?? keyPath(home);
    const key = await loadKey(file).catch((e: Error) => e);
    const state = await GatewayState.load(home);
    const queue = new DiskQueue(home);
    const q = await queue.size();
    const dead = await queue.deadCount();
    let registered: boolean | string | undefined;
    if (!(key instanceof Error) && !opts.offline) {
      try {
        registered = (await registeredSources(key.shipmentId, g.api)).some((s) => s.id === key.sourceId);
      } catch (err) {
        registered = `unknown (${(err as Error).message})`;
      }
    }
    const report = {
      version: VERSION,
      home,
      api: g.api,
      key: key instanceof Error ? { error: key.message } : { file, sourceId: key.sourceId, shipmentId: key.shipmentId, publicKey: key.publicKey, sensors: key.sensorIds, label: key.label },
      registered,
      queue: { ...q, dead },
      lastSend: state.lastSend,
      totals: state.totals,
      watermarks: state.watermarks,
    };
    if (opts.json) return out(JSON.stringify(report, null, 2));
    out(`cargoflow-gateway ${VERSION}`);
    out(`  home        ${home}`);
    out(`  api         ${g.api}`);
    if (key instanceof Error) out(`  key         ${key.message}`);
    else {
      printKeySummary(key, file);
      out(`  registered  ${registered === undefined ? "not checked" : registered === true ? "yes" : registered === false ? "NO (run `cargoflow-gateway init` for the steps)" : registered}`);
    }
    out(`  queue       ${q.batches} batch(es), ${q.readings} readings${q.oldest ? `, oldest queued ${new Date(q.oldest).toISOString()}` : ""}`);
    if (q.lastError) out(`  last error  ${q.lastError}${q.nextAttemptAt ? ` (next attempt ${new Date(q.nextAttemptAt).toISOString()})` : ""}`);
    out(`  refused     ${dead} batch(es) in dead/`);
    const ls = state.lastSend;
    out(`  last send   ${ls ? `${new Date(ls.at).toISOString()} ${ls.ok ? "ok" : "failed"}${ls.status ? ` (${ls.status})` : ""}${ls.message ? ` ${ls.message}` : ""}` : "never"}`);
    out(`  totals      queued ${state.totals.queued}, sent ${state.totals.sent}, duplicates dropped ${state.totals.skippedDuplicate}, out of order dropped ${state.totals.skippedOld}`);
    const marks = Object.entries(state.watermarks);
    if (marks.length) {
      out("  newest reading queued per sensor:");
      for (const [k, ts] of marks) out(`    ${k.split("/")[1]}  ${new Date(ts * 1000).toISOString()}`);
    }
  });

// --- presets

program
  .command("presets")
  .description("list the logger export presets and their verification status")
  .action(() => {
    for (const p of PRESETS) {
      out(`${p.id.padEnd(9)} ${p.status === "experimental" ? "[experimental] " : ""}${p.name}`);
      out(`          ${p.description}`);
    }
  });

program.parseAsync(process.argv).catch((err: Error) => {
  process.stderr.write(`cargoflow-gateway: ${err.message}\n`);
  process.exit(1);
});
