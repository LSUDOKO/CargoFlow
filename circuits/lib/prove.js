'use strict';
// Groth16 proving and verification for telemetry_epoch. The Go prover worker shells out to
// scripts/prove.js, which wraps this module, so Go never embeds snarkjs.
const fs = require('node:fs');
const path = require('node:path');
const snarkjs = require('snarkjs');
const { build } = require('../scripts/compile');
const { makeInput } = require('./epoch');

const keysDir = path.resolve(__dirname, '..', 'keys');
const zkeyPath = path.join(keysDir, 'telemetry_epoch_final.zkey');
const vkeyPath = path.join(keysDir, 'verification_key.json');

const hex32 = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');

/**
 * Proves that `readings` (8 of them) commit to a Merkle root and all lie within the bounds, bound to
 * `contextHash`. Throws (message contains "Assert Failed") if the statement is false.
 */
async function prove({ readings, contextHash, minTempX100, maxTempX100 }) {
  const { input, root } = await makeInput({ readings, contextHash, minTempX100, maxTempX100 });
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, build().wasm, zkeyPath);
  return { proof, publicSignals, root, calldata: toCalldata(proof, publicSignals) };
}

async function verify(proof, publicSignals) {
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
  return snarkjs.groth16.verify(vkey, publicSignals, proof);
}

/**
 * Converts a snarkjs proof to the argument order of Groth16Verifier.verifyProof(a, b, c, pubSignals).
 * Note the G2 point coordinates are swapped, as the EVM pairing precompile expects.
 */
function toCalldata(proof, publicSignals) {
  return {
    a: [hex32(proof.pi_a[0]), hex32(proof.pi_a[1])],
    b: [
      [hex32(proof.pi_b[0][1]), hex32(proof.pi_b[0][0])],
      [hex32(proof.pi_b[1][1]), hex32(proof.pi_b[1][0])],
    ],
    c: [hex32(proof.pi_c[0]), hex32(proof.pi_c[1])],
    pubSignals: publicSignals.map(hex32),
  };
}

module.exports = { prove, verify, toCalldata, zkeyPath, vkeyPath };
