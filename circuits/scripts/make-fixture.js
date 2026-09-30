'use strict';
// Generates contracts/test/fixtures/real_proof.json: a real Groth16 proof for the Go backend's recovery
// epoch, made against the exact public inputs the contract derived (contracts/test/fixtures/proof_inputs.json).
//
//   make zk-fixture        # runs the whole pipeline
const fs = require('node:fs');
const path = require('node:path');
const { prove, verify } = require('../lib/prove');

const root = path.resolve(__dirname, '..');
const epochFixture = path.join(root, 'test', 'fixtures', 'epoch_fixture.json');
const inputsFile = path.resolve(root, '..', 'contracts', 'test', 'fixtures', 'proof_inputs.json');
const outFile = path.resolve(root, '..', 'contracts', 'test', 'fixtures', 'real_proof.json');

const dec = (hex) => BigInt(hex).toString();

async function main() {
  const epoch = JSON.parse(fs.readFileSync(epochFixture, 'utf8'));
  const inputs = JSON.parse(fs.readFileSync(inputsFile, 'utf8'));
  if (inputs.merkleRoot !== epoch.root) {
    throw new Error('proof_inputs.json was written for a different epoch root; rerun the Forge generator');
  }

  const readings = epoch.readings.map((r) => ({
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
    contextHash: BigInt(inputs.contextHash),
    minTempX100: Number(inputs.minTempX100),
    maxTempX100: Number(inputs.maxTempX100),
  });
  if (!(await verify(res.proof, res.publicSignals))) throw new Error('generated proof does not verify off-chain');

  const cd = res.calldata;
  const out = {
    description: 'Real Groth16 proof for the recovery epoch; regenerate with `make zk-fixture`.',
    contextHash: inputs.contextHash,
    merkleRoot: inputs.merkleRoot,
    a: cd.a.map(dec),
    b: cd.b.map((row) => row.map(dec)),
    c: cd.c.map(dec),
    pubSignals: cd.pubSignals.map(dec),
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  console.log('wrote', path.relative(path.resolve(root, '..'), outFile));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
