'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snarkjs = require('snarkjs');
const { prove, verify, vkeyPath, zkeyPath } = require('../lib/prove');
const { sampleReadings, TEMP_OFFSET } = require('../lib/epoch');

const CONTEXT = 987654321098765432109876543210n;
const base = () => ({ readings: sampleReadings(), contextHash: CONTEXT, minTempX100: 200, maxTempX100: 800 });

// snarkjs keeps BN254 worker threads alive; without this the test process never exits.
test.after(async () => {
  if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();
});

let good;
test.before(async () => {
  assert.ok(fs.existsSync(zkeyPath), 'run `npm run setup` first');
  good = await prove(base());
});

test('a valid epoch yields a proof that verifies, with the four public signals in order', async () => {
  assert.equal(good.publicSignals.length, 4);
  assert.equal(good.publicSignals[0], CONTEXT.toString());
  assert.equal(good.publicSignals[1], good.root.toString());
  assert.equal(good.publicSignals[2], (200n + TEMP_OFFSET).toString());
  assert.equal(good.publicSignals[3], (800n + TEMP_OFFSET).toString());
  assert.equal(await verify(good.proof, good.publicSignals), true);
});

test('the proof does not verify under a different context (replay on another shipment/contract/submitter)', async () => {
  const other = [...good.publicSignals];
  other[0] = (CONTEXT + 1n).toString();
  assert.equal(await verify(good.proof, other), false);
});

test('the proof does not verify against a different Merkle root', async () => {
  const other = [...good.publicSignals];
  other[1] = (BigInt(other[1]) ^ 1n).toString();
  assert.equal(await verify(good.proof, other), false);
});

test('the proof does not verify under different policy bounds', async () => {
  for (const [i, delta] of [[2, -1n], [2, 1n], [3, -1n], [3, 1n]]) {
    const other = [...good.publicSignals];
    other[i] = (BigInt(other[i]) + delta).toString();
    assert.equal(await verify(good.proof, other), false, `signal ${i} ${delta}`);
  }
});

test('a tampered proof does not verify', async () => {
  const bad = JSON.parse(JSON.stringify(good.proof));
  bad.pi_a[0] = (BigInt(bad.pi_a[0]) + 1n).toString();
  assert.equal(await verify(bad, good.publicSignals), false);
});

test('an epoch with one out-of-range reading cannot be proven at all', async () => {
  await assert.rejects(prove({ ...base(), readings: sampleReadings([450, 460, 460, 470, 450, 460, 470, 801]) }), /Assert Failed/);
});

test('a proof generated for one context cannot be re-labelled as another', async () => {
  const other = await prove({ ...base(), contextHash: CONTEXT + 7n });
  const swapped = [...other.publicSignals];
  swapped[0] = CONTEXT.toString();
  assert.equal(await verify(other.proof, swapped), false);
  assert.equal(await verify(other.proof, other.publicSignals), true);
});

test('calldata is shaped for Groth16Verifier.verifyProof and matches the public signals', async () => {
  const cd = good.calldata;
  assert.equal(cd.a.length, 2);
  assert.equal(cd.b.length, 2);
  assert.equal(cd.b[0].length, 2);
  assert.equal(cd.c.length, 2);
  assert.equal(cd.pubSignals.length, 4);
  for (const v of [...cd.a, ...cd.b.flat(), ...cd.c, ...cd.pubSignals]) assert.match(v, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(cd.pubSignals.map((h) => BigInt(h).toString()), good.publicSignals);
});

test('the exported verification key matches the zkey', async () => {
  const fromFile = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
  const fromZkey = await snarkjs.zKey.exportVerificationKey(zkeyPath);
  assert.deepEqual(fromFile, fromZkey);
  assert.equal(fromFile.nPublic, 4);
});
