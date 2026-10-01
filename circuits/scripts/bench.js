'use strict';
// Measures the recovery circuit on this machine and prints a table: constraints, proving time over N runs,
// verification time and proof size. Usage: node scripts/bench.js [runs]  (default 5)
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { prove, verify } = require('../lib/prove');
const { build } = require('./compile');

const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', 'epoch_fixture.json'), 'utf8'));
const readings = fixture.readings.map((r) => ({
  timestamp: BigInt(r.timestamp),
  sensorId: r.sensorId,
  temperatureX100: r.temperatureX100,
  humidityX100: r.humidityX100,
  latitudeE6: r.latitudeE6,
  longitudeE6: r.longitudeE6,
  shockX100: r.shockX100,
  salt: BigInt(r.salt),
}));

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = (hr) => Number(hr) / 1e6;

async function main() {
  const runs = Number(process.argv[2] || 5);
  build(); // make sure the circuit is compiled
  const info = execFileSync(path.join(root, 'node_modules', '.bin', 'snarkjs'), ['r1cs', 'info', path.join(root, 'build', 'telemetry_epoch.r1cs')], {
    encoding: 'utf8',
  });
  const constraints = /# of Constraints: (\d+)/.exec(info.replace(/\u001b\[[0-9;]*m/g, ''))[1];

  const args = { readings, contextHash: 123456789n, minTempX100: 200, maxTempX100: 800 };
  await prove(args); // warm up: loads the wasm and zkey once

  const proveMs = [];
  let last;
  for (let i = 0; i < runs; i++) {
    const t = process.hrtime.bigint();
    last = await prove(args);
    proveMs.push(ms(process.hrtime.bigint() - t));
  }
  const t = process.hrtime.bigint();
  const ok = await verify(last.proof, last.publicSignals);
  const verifyMs = ms(process.hrtime.bigint() - t);
  if (!ok) throw new Error('benchmark proof failed to verify');

  const cpus = os.cpus();
  console.log(`machine:        ${cpus.length} x ${cpus[0].model.trim()}, node ${process.version}`);
  console.log(`constraints:    ${constraints}`);
  console.log(`prove (${runs} runs): median ${median(proveMs).toFixed(0)} ms, min ${Math.min(...proveMs).toFixed(0)} ms, max ${Math.max(...proveMs).toFixed(0)} ms`);
  console.log(`verify (off-chain): ${verifyMs.toFixed(0)} ms`);
  console.log(`proof size:     ${JSON.stringify(last.proof).length} bytes JSON, 8 field elements on-chain (256 bytes)`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
