'use strict';
// JSON-in / JSON-out prover used by the Go worker (backend/internal/proof). Reads one request on stdin:
//   { "readings": [...8], "contextHash": "<decimal>", "minTempX100": 200, "maxTempX100": 800 }
// and prints { "root", "publicSignals", "calldata": { a, b, c, pubSignals } } on stdout. Readings use the
// same field names as circuits/test/fixtures/epoch_fixture.json, with decimal-string salts.
const { prove, verify } = require('../lib/prove');

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const req = JSON.parse(await readStdin());
  const readings = req.readings.map((r) => ({
    timestamp: BigInt(r.timestamp),
    sensorId: r.sensorId,
    temperatureX100: r.temperatureX100,
    humidityX100: r.humidityX100,
    latitudeE6: r.latitudeE6,
    longitudeE6: r.longitudeE6,
    shockX100: r.shockX100,
    salt: BigInt(r.salt),
  }));
  const res = await prove({
    readings,
    contextHash: BigInt(req.contextHash),
    minTempX100: Number(req.minTempX100),
    maxTempX100: Number(req.maxTempX100),
  });
  if (!(await verify(res.proof, res.publicSignals))) throw new Error('proof failed local verification');
  process.stdout.write(
    JSON.stringify({ root: res.root.toString(), publicSignals: res.publicSignals, calldata: res.calldata }) + '\n',
  );
}

// snarkjs keeps worker threads alive, so exit explicitly.
main().then(
  () => process.exit(0),
  (e) => {
    process.stderr.write(String(e && e.message ? e.message : e) + '\n');
    process.exit(1);
  },
);
