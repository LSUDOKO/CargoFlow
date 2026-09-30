'use strict';
// Cross-language parity: the Go backend (backend/internal/epoch) produced this fixture from a real
// simulator run. The JS reference and the circuit must reproduce its leaves and root exactly, or no
// proof could ever verify against a root the backend commits on-chain.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const snarkjs = require('snarkjs');
const { build } = require('../scripts/compile');
const { leafHash, buildTree, makeInput } = require('../lib/epoch');

const fixturePath = path.join(__dirname, 'fixtures', 'epoch_fixture.json');

function load() {
  const f = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const readings = f.readings.map((r) => ({
    timestamp: BigInt(r.timestamp),
    sensorId: r.sensorId,
    temperatureX100: r.temperatureX100,
    humidityX100: r.humidityX100,
    latitudeE6: r.latitudeE6,
    longitudeE6: r.longitudeE6,
    shockX100: r.shockX100,
    salt: BigInt(r.salt),
  }));
  return { f, readings };
}

test('JS leaf hashes equal the Go backend leaf hashes', async () => {
  const { f, readings } = load();
  assert.equal(readings.length, 8);
  for (let i = 0; i < 8; i++) {
    assert.equal((await leafHash(readings[i])).toString(), f.readings[i].leaf, `leaf ${i}`);
  }
});

test('JS Merkle root equals the Go backend root', async () => {
  const { f, readings } = load();
  const leaves = [];
  for (const r of readings) leaves.push(await leafHash(r));
  const levels = await buildTree(leaves);
  assert.equal(levels[levels.length - 1][0].toString(), f.root);
});

test('the circuit accepts the Go-produced epoch under its committed root', async () => {
  const { f, readings } = load();
  const { input } = await makeInput({ readings, contextHash: 42n, minTempX100: 200, maxTempX100: 800 });
  assert.equal(input.merkleRoot, f.root);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-parity-'));
  try {
    await snarkjs.wtns.calculate(input, build().wasm, path.join(dir, 'w.wtns'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
