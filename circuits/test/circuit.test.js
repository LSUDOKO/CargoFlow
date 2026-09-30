'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const snarkjs = require('snarkjs');
const { build } = require('../scripts/compile');
const { makeInput, sampleReadings, TEMP_OFFSET } = require('../lib/epoch');

const CONTEXT = 123456789012345678901234567890n;
let wasm;
let tmp;

test.before(() => {
  wasm = build().wasm;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-circuit-'));
});
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Returns the witness array, or throws if any constraint fails. */
async function witness(input) {
  const f = path.join(tmp, `w-${Math.random().toString(36).slice(2)}.wtns`);
  await snarkjs.wtns.calculate(input, wasm, f);
  return snarkjs.wtns.exportJson(f);
}

/** The circuit must fail because a constraint is violated, not because of a harness or input error. */
const violates = (p) => assert.rejects(p, /Assert Failed/);

const ok = (over = {}) =>
  makeInput({ readings: sampleReadings(), contextHash: CONTEXT, minTempX100: 200, maxTempX100: 800, ...over });

test('accepts eight compliant readings and exposes the four public signals in order', async () => {
  const { input, root } = await ok();
  const w = await witness(input);
  // witness[0] = 1, then the public inputs in declaration order
  assert.equal(w[1], CONTEXT);
  assert.equal(w[2], root);
  assert.equal(w[3], 200n + TEMP_OFFSET);
  assert.equal(w[4], 800n + TEMP_OFFSET);
});

test('accepts readings exactly on the bounds', async () => {
  const { input } = await ok({ readings: sampleReadings([200, 800, 200, 800, 200, 800, 200, 800]) });
  await witness(input);
});

test('rejects a reading above the maximum', async () => {
  const { input } = await ok({ readings: sampleReadings([450, 460, 460, 801, 450, 460, 470, 460]) });
  await violates(witness(input));
});

test('rejects a reading below the minimum', async () => {
  const { input } = await ok({ readings: sampleReadings([450, 460, 199, 470, 450, 460, 470, 460]) });
  await violates(witness(input));
});

test('rejects the demo excursion itself (11.7 C) even if it is correctly committed', async () => {
  const { input } = await ok({ readings: sampleReadings([520, 680, 890, 1040, 1170, 460, 470, 460]) });
  await violates(witness(input));
});

test('rejects a root that does not commit to the readings', async () => {
  const { input } = await ok();
  input.merkleRoot = (BigInt(input.merkleRoot) ^ 1n).toString();
  await violates(witness(input));
});

test('rejects a tampered salt', async () => {
  const { input } = await ok();
  input.salt[5] = (BigInt(input.salt[5]) + 1n).toString();
  await violates(witness(input));
});

test('rejects a swapped reading order (leaf order is committed)', async () => {
  const { input } = await ok();
  for (const k of ['timestamp', 'sensorField', 'temp', 'humidity', 'lat', 'lon', 'shock', 'salt']) {
    [input[k][0], input[k][1]] = [input[k][1], input[k][0]];
  }
  await violates(witness(input));
});

test('rejects a reading whose hidden temperature differs from the committed one', async () => {
  const { input } = await ok();
  input.temp[2] = (BigInt(input.temp[2]) + 1n).toString(); // still in range, but not what was committed
  await violates(witness(input));
});

test('honours whatever bounds are supplied, so the contract must pin them to the policy', async () => {
  // tighter public bounds than the data satisfies -> no proof
  const tight = await ok({ minTempX100: 455, maxTempX100: 800 }); // readings include 450
  await violates(witness(tight.input));
  // looser bounds are provable: the circuit cannot know the policy, the contract enforces equality
  const loose = await ok({ minTempX100: -5000, maxTempX100: 5000 });
  await witness(loose.input);
});

test('range checks stay sound: bounds or readings that overflow 16 bits are rejected', async () => {
  const wideBound = await ok();
  wideBound.input.maxTemp = (1n << 16n).toString();
  await violates(witness(wideBound.input));

  const bigTemp = await ok();
  bigTemp.input.temp[0] = (1n << 16n).toString();
  await violates(witness(bigTemp.input));
});
