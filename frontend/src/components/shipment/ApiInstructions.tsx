"use client";

import { useState } from "react";
import { API_URL } from "@/lib/api/client";

function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-tile bg-ink p-4 pr-20 font-mono text-xs leading-relaxed text-paper">{children}</pre>
      <button
        type="button"
        className="absolute top-2 right-2 rounded-full bg-paper/10 px-3 py-1 text-xs font-semibold text-paper hover:bg-paper/20"
        onClick={() => {
          void navigator.clipboard?.writeText(children).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** How a gateway posts readings directly, for devices that report on their own instead of through a CSV. */
export function ApiInstructions({ shipmentId }: { shipmentId: string }) {
  const path = `/v1/shipments/${shipmentId.toLowerCase()}/telemetry`;
  const node = `// node gateway.mjs cargoflow-gateway-….json  (Node 18 or later)
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

const key = JSON.parse(readFileSync(process.argv[2], "utf8"));
const seed = Buffer.from(key.privateKeySeed, "base64url");
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
  format: "der", type: "pkcs8",
});

const path = "/v1/shipments/" + key.shipmentId + "/telemetry";
const body = JSON.stringify({ points: [{
  timestamp: Math.floor(Date.now() / 1000), sensorId: key.sensorIds[0],
  temperatureX100: 420, humidityX100: 6200, latitudeE6: 1264000, longitudeE6: 103840000, shockX100: 2,
}] });
const ts = Math.floor(Date.now() / 1000);
const digest = createHash("sha256").update(body).digest("hex");
const signature = sign(null, Buffer.from(\`CARGOFLOW-V1\\nPOST\\n\${path}\\n\${ts}\\n\${digest}\`), privateKey).toString("base64url");

const res = await fetch("${API_URL}" + path, {
  method: "POST", body,
  headers: { "Content-Type": "application/json", "X-Source-Id": key.sourceId, "X-Timestamp": String(ts), "X-Signature": signature },
});
console.log(res.status, await res.text());`;

  return (
    <details className="group mt-4 rounded-tile border-2 border-line">
      <summary className="cursor-pointer list-none px-4 py-3 font-semibold marker:hidden">
        <span className="mr-2 inline-block transition-transform group-open:rotate-90" aria-hidden="true">›</span>
        Send readings from a device instead
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4 text-sm">
        <p>A gateway can post readings itself. Each request is signed with the gateway&apos;s key:</p>
        <Code>{`POST ${API_URL}${path}
Content-Type: application/json
X-Source-Id: <sourceId from the key file>
X-Timestamp: <unix seconds, within 5 minutes of now>
X-Signature: base64url(Ed25519(seed, signing string))

signing string = "CARGOFLOW-V1\\nPOST\\n${path}\\n" + timestamp + "\\n" + hex(sha256(body))
body = {"points":[{"timestamp":…,"sensorId":…,"temperatureX100":…,"humidityX100":…,"latitudeE6":…,"longitudeE6":…,"shockX100":…}]}`}</Code>
        <p>Temperatures and percentages are in hundredths, positions in millionths of a degree. At most 500 readings per request, each sensor&apos;s in time order. A complete example in Node:</p>
        <Code>{node}</Code>
      </div>
    </details>
  );
}
