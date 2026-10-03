// A local stand-in for the CargoFlow API's telemetry endpoint that authenticates requests the way
// backend/internal/auth (Verifier.Verify) does, with an independent Ed25519 implementation (node:crypto, not
// @noble/curves), so a signing bug in the gateway cannot be masked by the same bug in the verifier.
import { createHash, createPublicKey, verify } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface Source {
  id: string;
  publicKey: string; // base64url
  sensorIds: string[];
  shipmentId: string;
}

export interface Received {
  path: string;
  points: { timestamp: number; sensorId: string; temperatureX100: number }[];
  status: number;
}

const MAX_SKEW_SEC = 300;
const MAX_POINTS = 500;

export class FakeApi {
  sources = new Map<string, Source>();
  received: Received[] = [];
  stored = new Map<string, number[]>(); // shipment/sensor -> timestamps accepted
  duplicates = 0;
  /** status codes to answer with before processing (consumed in order) */
  failures: number[] = [];
  nowSec = () => Math.floor(Date.now() / 1000);
  private server = http.createServer((req, res) => void this.handle(req, res));
  url = "";

  async start(): Promise<this> {
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", () => r()));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop() {
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  register(s: Source) {
    this.sources.set(s.id, s);
  }

  get acceptedCount() {
    return [...this.stored.values()].reduce((n, l) => n + l.length, 0);
  }

  private send(res: http.ServerResponse, status: number, body: unknown, received?: Omit<Received, "status">) {
    if (received) this.received.push({ ...received, status });
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? "/", "http://x");
    const m = url.pathname.match(/^\/v1\/shipments\/([^/]+)\/telemetry$/);
    if (req.method !== "POST" || !m) return this.send(res, 404, { error: { code: "not_found", message: "404 page not found" } });
    const fail = this.failures.shift();
    if (fail) return this.send(res, fail, { error: { code: "unavailable", message: "simulated failure" } }, { path: url.pathname, points: [] });

    // --- auth.Verifier.Verify
    const id = req.headers["x-source-id"] as string | undefined;
    const tsRaw = req.headers["x-timestamp"] as string | undefined;
    const sig = req.headers["x-signature"] as string | undefined;
    const unauthorized = (message: string) => this.send(res, 401, { error: { code: "unauthorized", message } }, { path: url.pathname, points: [] });
    if (!id || !tsRaw || !sig) return unauthorized("missing credentials");
    const ts = Number(tsRaw);
    if (!Number.isInteger(ts)) return unauthorized("invalid credentials");
    if (Math.abs(this.nowSec() - ts) > MAX_SKEW_SEC) return unauthorized("request timestamp outside the allowed window; check your clock");
    const src = this.sources.get(id);
    if (!src) return unauthorized("invalid credentials");
    const signing = `CARGOFLOW-V1\nPOST\n${url.pathname}\n${ts}\n${createHash("sha256").update(body).digest("hex")}`;
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: src.publicKey }, format: "jwk" });
    const sigBytes = Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (sigBytes.length !== 64 || /=/.test(sig) || !verify(null, Buffer.from(signing), key, sigBytes)) return unauthorized("invalid credentials");

    // --- handler checks
    if (!/^application\/json\b/.test(String(req.headers["content-type"]))) return this.send(res, 415, { error: { code: "unsupported_media_type", message: "Content-Type must be application/json" } });
    let parsed: { points: Received["points"] };
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      return this.send(res, 400, { error: { code: "bad_request", message: "not JSON" } });
    }
    const keys = Object.keys(parsed);
    if (keys.length !== 1 || keys[0] !== "points" || !Array.isArray(parsed.points)) return this.send(res, 400, { error: { code: "bad_request", message: "unknown field" } });
    const points = parsed.points;
    const rec = { path: url.pathname, points };
    if (!points.length) return this.send(res, 400, { error: { code: "bad_request", message: "points must contain at least one reading" } }, rec);
    if (points.length > MAX_POINTS) return this.send(res, 413, { error: { code: "payload_too_large", message: "at most 500 readings per request" } }, rec);
    for (const p of points) if (!src.sensorIds.includes(p.sensorId)) return this.send(res, 403, { error: { code: "forbidden", message: `sensor not allowed for this source: "${p.sensorId}"` } }, rec);
    if (src.shipmentId !== m[1]!.toLowerCase()) return this.send(res, 403, { error: { code: "forbidden", message: "this evidence source is registered for a different shipment" } }, rec);
    let accepted = 0;
    const rejected: { index: number; reason: string }[] = [];
    points.forEach((p, i) => {
      const k = `${m[1]}/${p.sensorId}`;
      const list = this.stored.get(k) ?? [];
      if (list.includes(p.timestamp)) {
        this.duplicates++;
        rejected.push({ index: i, reason: "DUPLICATE" });
      } else if (list.length && p.timestamp < list[list.length - 1]!) rejected.push({ index: i, reason: "OUT_OF_ORDER" });
      else {
        list.push(p.timestamp);
        accepted++;
      }
      this.stored.set(k, list);
    });
    return this.send(res, 200, { accepted, rejected, epochs: [] }, rec);
  }
}
