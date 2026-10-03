# @cargoflow/gateway

The CargoFlow evidence gateway. It runs next to your temperature loggers (a Raspberry Pi in a warehouse, a laptop at
a packing station, a container on a server), turns their exports into readings, signs every request with the
gateway's own Ed25519 key and delivers them to the CargoFlow API. Readings that cannot be sent right away wait in a
durable queue on disk and go out, in order, when the network comes back, also after a restart or a power cut.

```
logger export / USB logger / serial stream
        │  parse (generic CSV or vendor preset), validate, convert units
        ▼
de-duplicate by (sensor, timestamp)  ── state.json survives restarts
        │
        ▼
durable queue (≤ 500 readings per batch, one file each)  ── queue/
        │  sign at send time: X-Source-Id, X-Timestamp, X-Signature
        ▼
POST /v1/shipments/{id}/telemetry   (retries with exponential backoff)
```

Node 18.17 or later on Linux (x64, arm64 incl. Raspberry Pi), macOS and Windows.

## Install

```sh
npm install -g @cargoflow/gateway
cargoflow-gateway --help
```

`serialport` is an optional dependency, needed only for `serial` mode. It ships prebuilt binaries for the common
platforms; if it fails to install, everything else still works.

## Quick start

1. **Get a key.** Either import the key file the website creates (shipment page, **Add a sensor gateway**,
   signed by the exporter's wallet), or generate a key on the gateway and register it from there:

   ```sh
   # import a key file downloaded from the shipment page
   cargoflow-gateway init --key ~/Downloads/cargoflow-gateway-CF-0411-src-1d959c814185668d.json

   # or generate one here; it prints the public key and the registration steps
   cargoflow-gateway init --shipment 0x<shipment id> --sensors probe-1,probe-2 --label "Reefer logger MSKU 123456-7"
   cargoflow-gateway register        # prints the message for the exporter's wallet to sign, then asks for the signature
   ```

   Registration is a wallet *signature* (EIP-191 `personal_sign`, no gas, no transaction) by the shipment's
   exporter over this message, within 10 minutes of its `issued` time:

   ```
   CargoFlow evidence source
   shipment: 0x…
   public key: <base64url Ed25519 public key>
   sensors: probe-1,probe-2
   issued: <unix seconds>
   ```

   With Foundry's `cast`, in one go:

   ```sh
   SIG=$(cast wallet sign --interactive "$(cargoflow-gateway register --print-message)")
   cargoflow-gateway register --signature "$SIG"
   ```

2. **Send readings.**

   ```sh
   cargoflow-gateway send trip-0411.csv            # one shot
   cargoflow-gateway watch ~/logger-exports        # keep running; new and changed exports are sent
   cargoflow-gateway status                        # key, registration, queue, last delivery
   ```

The key file is the gateway's identity: anyone holding it can submit readings for that shipment. `init` stores it as
`<home>/key.json` with mode 0600; the backend keeps only the public key. The key file format is the website's
(`kind: cargoflow-gateway-key`), so the same file works in the browser and here.

## Commands

| Command | What it does |
| --- | --- |
| `init [--key <file>]` | Import a key file, or generate a key (`--shipment`, `--sensors`, `--label`) and print the public key, source id and the exact registration steps (including the link to the shipment page). Checks whether the key is already registered (`--offline` to skip). |
| `register [--print-message] [--signature <hex> [--issued-at <unix>]]` | Register this key on its shipment with the exporter's wallet signature (`POST /v1/shipments/{id}/sources`). |
| `watch <folder>` | Watch a folder (2 levels deep) for `.csv`, `.txt` and `.tsv` exports. Each new or changed file is read once it has stopped growing, parsed, de-duplicated, queued and sent. Unchanged files are recognised by content hash and skipped. `--poll` for network shares; `--flush-interval` (default 15 s) for retries. |
| `mount [--watch] [--volume <path…>] [--list]` | Find USB mass-storage loggers (Linux: `/proc/mounts` and `/media/$USER`, `/run/media/$USER`; macOS: `/Volumes`; Windows: drive letters D–Z) and read the newest export on each. `--watch` checks every `--interval` seconds (default 10). |
| `serial <port> [--baud 9600] [--columns …]` | Read line-delimited readings from a logger or bridge that streams over USB serial: JSON objects (`{"sensor":"probe-1","temp":4.2}` or the API's integer form `{"timestamp":…,"sensorId":…,"temperatureX100":…}`) or CSV rows after a header line (`--columns` for headerless streams). Rows without a clock are stamped on arrival. Buffered and queued every `--flush-every` seconds (default 10) or every 500 readings. |
| `send <files…> [--force]` | One shot: parse, queue and send everything queued now. Exit code 0 when all was delivered, 2 when readings remain queued (offline), 1 on parse errors or refused batches. |
| `flush` | Send everything queued now, ignoring retry timers. |
| `retry-dead` | Put batches the API refused (in `dead/`) back into the queue. |
| `status [--json] [--offline]` | Key, registration, queue size and last error, last delivery, totals, newest reading per sensor. |
| `presets` | The logger presets and their verification status. |

Global options (before or after the command):

| Option | Meaning |
| --- | --- |
| `--home <dir>` | Data directory: key, state, queue. Default `$CARGOFLOW_GATEWAY_HOME` or `~/.cargoflow-gateway`. |
| `--key <file>` | Use this key file instead of `<home>/key.json` (with `init`: the file to import). |
| `--api <url>` | API base URL. Default `$CARGOFLOW_API_URL` or `https://cargoflow-api-75ul.onrender.com`. |
| `--preset <id>` | `auto` (default), `generic`, `temptale`, `elitech`, `elpro`. |
| `--tz <zone>` | Time zone for timestamps written without one: IANA name (`Asia/Kolkata`), `UTC` or an offset (`+05:30`). Default: the zone named in the export's preamble, else UTC. |
| `--fahrenheit` / `--celsius` | Force the temperature unit (default: detected from the header or preamble). |
| `--date-order dmy\|mdy` | For dates like `03/04/2026`. Default: inferred from the values; day first, except month first for TempTale. |
| `--sensor <id>` | Sensor id for exports without a sensor column. |
| `--sensor-map SERIAL=id,…` | Map logger serial numbers (read from the export's preamble) to sensor ids. Without it, a serial that is itself one of the key's sensors is used as is, and a one-sensor key needs nothing. |
| `--position <lat,lon>` | Fixed position for loggers without GPS (the API needs a position on every reading). |
| `--delimiter <char>` | Column delimiter (`tab` for tabs). Default: detected among `,` `;` and tab. |
| `--dry-run` | Parse and sign, log what would be sent, send nothing, change no state. |
| `--log-format json\|pretty` | Default: `pretty` on a terminal, `json` otherwise (systemd, Docker). |
| `--log-level debug\|info\|warn\|error` | Default `info`. |

## Parsing

The generic parser is a port of the website's (`frontend/src/lib/csv.ts`), so a file gives the same readings in
both places:

- **Columns by name.** `timestamp`/`time`/`date`/`datetime`/`unix`…, `sensor_id`/`sensor`/`probe`/`serial`…,
  `temperature`/`temp`/`t` in °C or °F (`Temp (°F)`), `humidity`/`RH`, `latitude`/`lat`, `longitude`/`lon`/`lng`,
  `shock`/`g`/`g_force`. Units and punctuation in headers are ignored. Separate `Date` and `Time` columns are merged.
  Point-number columns (`No.`, `Data Point`) are ignored.
- **Timestamps.** Unix seconds, 13-digit milliseconds, ISO 8601 with or without an offset, day/month dates (order
  inferred from the values), 12-hour clocks (`08:10:00 PM`), month names (`01-Oct-2026`, `Oct 1, 2026`,
  `2026 Oct. 01`). Timestamps without a zone are read in `--tz` (DST-aware).
- **Numbers.** Decimal commas in `;`- and tab-separated files, UTF-8, UTF-8 with BOM, UTF-16 and Windows-1252 text.
- **Validation** (as the API): temperature −80…150 °C, humidity 0…100 %, latitude/longitude in range, shock ≥ 0,
  sensor ids `[A-Za-z0-9][A-Za-z0-9._-]{0,63}` and one of the key's sensors, nothing more than 5 minutes in the
  future, one reading per sensor and timestamp. Bad rows are logged with their line numbers and skipped.
- **Order.** The API takes each sensor's readings in increasing time order; exports are sorted (many loggers write
  newest first) and batches are sent strictly in queue order.

### Logger presets

`--preset auto` picks a preset from the export's content (vendor names in the preamble, header layout).

| Preset | Reads | Status |
| --- | --- | --- |
| `generic` | Any delimited export with a header row; the website's template columns map exactly. | stable |
| `temptale` | Sensitech TempTale 4 / Ultra data exported to CSV from TempTale Manager Desktop / ColdStream: a preamble (serial number, trip number, unit, time zone) and a table with a point number, the date and time (one or two columns, 12-hour clock, month-first dates) and the temperature in °F or °C. | **experimental** |
| `elitech` | Elitech RC-5 / RC-5+ / RC-4 / RC-4HC / RC-51H data exported from ElitechLog (saved as CSV/TXT): a device preamble (model, serial number, time zone such as `UTC+08:00`) and `No.`, `Time` (`YYYY-MM-DD HH:MM:SS`), `Temperature(°C)` / `(°F)` and, on humidity models, `Humidity(%RH)`. | **experimental** |
| `elpro` | ELPRO LIBERO data exported to a table from ELPRO software (elproVIEWER / liberoMANAGER / ECOLOG-NET): `;` or `,` separated, decimal commas, the date formats configurable in liberoCONFIG (`dd.MM.yyyy HH:mm:ss`, `yyyy MMM dd HH:mm:ss`, optional `zzz` UTC offset), `T [°C]` style headers, time zone from the preamble. | **experimental** |

Why experimental: none of these vendors publishes a machine-readable specification of its export, and no genuine
sample export could be obtained while writing the presets. What could be checked:

- *Elitech*: the record layout (record number, `YYYY-MM-DD HH:MM:SS` time, temperature in °C) matches the output of
  the open-source RC-4/RC-5 reader `elitech-datareader`; the user manuals list ElitechLog's export formats as
  PDF, Excel/XLS and TXT. The exact header wording and preamble of ElitechLog's own export were not verified.
- *ELPRO*: the LIBERO Cx operation manual (liberoCONFIG, LI6003E) documents that the logger itself writes a PDF/A
  report with embedded data (the gateway does not parse PDFs; `mount` says so when a volume holds only PDFs), that
  the report time zone is configurable relative to UTC, and the date/time placeholders above. The column layout of
  the software's tabular export was not verified.
- *Sensitech*: TempTale USB loggers produce PDF and TTV files; tabular data comes from TempTale Manager Desktop.
  Its CSV column layout is not publicly documented and was not verified.

The presets are deliberately tolerant (header row found anywhere in the first 200 lines, delimiter and decimal comma
detection, split date/time, unit and zone from the preamble), and every preset falls back to the same validation
as the generic parser, so a layout difference shows up as clear per-row errors rather than wrong data. Each has a
fixture in `test/fixtures/`. **Please send a real (anonymised) export** if yours fails, so the preset can be
verified and the fixture replaced.

Loggers without GPS need `--position`; single-probe exports without a sensor column need `--sensor`,
`--sensor-map`, a serial that matches one of the key's sensors, or a one-sensor key.

## Delivery, de-duplication and the queue

- **Signing.** `X-Signature` is base64url Ed25519 over
  `CARGOFLOW-V1\nPOST\n<path>\n<unix ts>\n<hex sha256(body)>` with `X-Source-Id` and `X-Timestamp`, byte-identical to
  `backend/internal/auth` (pinned by the Go test vector in `test/signing.test.ts`). Each batch is signed when it is
  sent, not when it is queued, so readings that waited offline for days still fall inside the API's timestamp
  window. Keep the clock right (NTP): a Raspberry Pi has no real-time clock.
- **De-duplication.** `state.json` keeps, per shipment and sensor, the newest timestamp already queued. Readings at or
  before it are dropped: equal is a duplicate, older would be refused by the API as out of order. Re-exports of a
  whole trip, overlapping files and restarts therefore send each reading once.
- **Queue.** `queue/` holds one JSON file per batch of at most 500 readings, written atomically (temp file, fsync,
  rename). A batch is deleted only after the API accepted it. Batch ids are content hashes, so a crash between
  queueing and saving the state cannot queue a batch twice.
- **Retries.** Network errors, timeouts, 429 and 5xx: exponential backoff from 5 s to 15 min with jitter (or the
  API's `Retry-After`). 401/403 (key not registered yet, clock wrong, key bound to another shipment): kept and
  retried every 15 min, with a hint in the log. Other 4xx (malformed batch): moved to `dead/` with the reason,
  `retry-dead` re-queues them. Batches go out strictly in order; a waiting batch holds back the ones behind it.

## Raspberry Pi

Raspberry Pi 3/4/5 or Zero 2 W with a 64-bit Raspberry Pi OS (Bookworm).

```sh
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g @cargoflow/gateway

# a service user that may read serial ports and removable media
sudo useradd --system --create-home --home-dir /var/lib/cargoflow-gateway --groups dialout,plugdev cargoflow
sudo mkdir -p /srv/cargoflow/exports

# the key (from the shipment page, or generate one with --shipment/--sensors and `register`)
sudo -u cargoflow CARGOFLOW_GATEWAY_HOME=/var/lib/cargoflow-gateway cargoflow-gateway init --key /tmp/key.json
sudo shred -u /tmp/key.json

# the clock must be right before signing
timedatectl status          # "System clock synchronized: yes"; sudo timedatectl set-ntp true otherwise

# the service (edit ExecStart for watch / mount --watch / serial first)
sudo install -m 0644 deploy/cargoflow-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cargoflow-gateway
journalctl -u cargoflow-gateway -f
sudo -u cargoflow CARGOFLOW_GATEWAY_HOME=/var/lib/cargoflow-gateway cargoflow-gateway status
```

The unit (`deploy/cargoflow-gateway.service`) waits for network and time sync, restarts on failure, runs as the
unprivileged `cargoflow` user with a read-only file system except its state directory.

USB loggers: Raspberry Pi OS Desktop mounts USB drives under `/media/<user>`; on Lite, mount the logger's volume
yourself (an `/etc/fstab` line with `noauto,x-systemd.automount`, or `udisksctl mount`) and pass `--volume <mountpoint>`.
Shared exports from a Windows PC: mount the share (CIFS) read-only and `watch --poll` it.

## Docker

```sh
docker buildx build --platform linux/amd64,linux/arm64 -t cargoflow/gateway:0.1.0 packages/gateway

# once: put the key into the data volume
docker run --rm -v cargoflow-gateway:/data -v "$PWD/key.json":/key.json:ro cargoflow/gateway:0.1.0 init --key /key.json

# run
docker run -d --name cargoflow-gateway --restart unless-stopped \
  -v cargoflow-gateway:/data -v /srv/cargoflow/exports:/exports:ro \
  cargoflow/gateway:0.1.0 watch --poll /exports

# serial logger
docker run -d --restart unless-stopped --device /dev/ttyUSB0 -v cargoflow-gateway:/data \
  cargoflow/gateway:0.1.0 serial /dev/ttyUSB0 --baud 115200

docker exec cargoflow-gateway node /app/dist/cli.js status
```

The image runs as the `node` user, logs JSON to stderr, and keeps the key, state and queue in `/data`.

## Library use

```ts
import { Gateway, parseExport, signRequest, createLogger } from "@cargoflow/gateway";

const gw = await Gateway.open({ home: "/var/lib/cargoflow-gateway", log: createLogger({ format: "json" }) });
await gw.ingestText(csvText, "upload.csv");
await gw.flush();
```

## Development

```sh
pnpm install
pnpm build
pnpm test        # vitest: Go signing vector, parsers and presets, queue durability, de-duplication,
                 # end to end against a local API that verifies signatures with node:crypto Ed25519
```

Nothing in the test suite talks to the live API.

## Licence

MIT (see the repository LICENSE)
