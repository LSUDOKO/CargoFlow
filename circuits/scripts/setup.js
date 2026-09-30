'use strict';
// Generates Groth16 proving/verification keys for telemetry_epoch and the Solidity verifier.
//
// !! TESTNET ONLY. Phase 1 (powers of tau) is generated locally by ONE party, so the proof system is
// !! only as trustworthy as this machine's discarded entropy. A production deployment must use a
// !! public multi-party ceremony (e.g. the Hermez/PSE ptau) plus a multi-contributor phase 2.
//
// Usage: node scripts/setup.js [--power 14]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const snarkjs = require('snarkjs');
const { getCurveFromName } = require('ffjavascript');
const { build, root } = require('./compile');

const power = Number(process.argv[process.argv.indexOf('--power') + 1]) || 14;
const keysDir = path.join(root, 'keys');
const verifierOut = path.resolve(root, '..', 'contracts', 'generated', 'Groth16Verifier.sol');

const entropy = () => crypto.randomBytes(64).toString('hex'); // never logged, never stored

async function main() {
  const { r1cs } = build();
  fs.mkdirSync(keysDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-setup-'));
  const f = (n) => path.join(work, n);
  const log = (m) => console.log(m);

  try {
    const curve = await getCurveFromName('bn128');

    log(`phase 1: 2^${power} powers of tau (single party, testnet only)`);
    await snarkjs.powersOfTau.newAccumulator(curve, power, f('pot_0000.ptau'));
    await snarkjs.powersOfTau.contribute(f('pot_0000.ptau'), f('pot_0001.ptau'), 'cargoflow-testnet', entropy());
    await snarkjs.powersOfTau.preparePhase2(f('pot_0001.ptau'), f('pot_final.ptau'));

    log('phase 2: circuit-specific setup');
    await snarkjs.zKey.newZKey(r1cs, f('pot_final.ptau'), f('circuit_0000.zkey'));
    await snarkjs.zKey.contribute(f('circuit_0000.zkey'), path.join(keysDir, 'telemetry_epoch_final.zkey'), 'cargoflow-testnet', entropy());

    log('verifying zkey against r1cs and ptau');
    const okKey = await snarkjs.zKey.verifyFromR1cs(r1cs, f('pot_final.ptau'), path.join(keysDir, 'telemetry_epoch_final.zkey'));
    if (!okKey) throw new Error('zkey verification failed');

    const vkey = await snarkjs.zKey.exportVerificationKey(path.join(keysDir, 'telemetry_epoch_final.zkey'));
    fs.writeFileSync(path.join(keysDir, 'verification_key.json'), JSON.stringify(vkey, null, 2) + '\n');

    const template = fs.readFileSync(path.join(root, 'node_modules', 'snarkjs', 'templates', 'verifier_groth16.sol.ejs'), 'utf8');
    const sol = await snarkjs.zKey.exportSolidityVerifier(path.join(keysDir, 'telemetry_epoch_final.zkey'), { groth16: template });
    fs.mkdirSync(path.dirname(verifierOut), { recursive: true });
    fs.writeFileSync(verifierOut, sol);
    log(`wrote ${path.relative(root, path.join(keysDir, 'telemetry_epoch_final.zkey'))}, verification_key.json, ${path.relative(path.resolve(root, '..'), verifierOut)}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true }); // intermediate parameters are deleted
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
