'use strict';
// Compiles circuits/telemetry_epoch.circom to build/ (r1cs, wasm, sym). Skips work when up to date.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'telemetry_epoch.circom');
const out = path.join(root, 'build');
const r1cs = path.join(out, 'telemetry_epoch.r1cs');

function build({ force = false } = {}) {
  fs.mkdirSync(out, { recursive: true });
  const upToDate = fs.existsSync(r1cs) && fs.statSync(r1cs).mtimeMs > fs.statSync(src).mtimeMs;
  if (upToDate && !force) return { r1cs, wasm: wasmPath(), compiled: false };
  execFileSync('circom', [src, '--r1cs', '--wasm', '--sym', '-l', path.join(root, 'node_modules'), '-o', out], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { r1cs, wasm: wasmPath(), compiled: true };
}

function wasmPath() {
  return path.join(out, 'telemetry_epoch_js', 'telemetry_epoch.wasm');
}

module.exports = { build, wasmPath, r1cs, out, root };

if (require.main === module) {
  const res = build({ force: process.argv.includes('--force') });
  console.log(res.compiled ? 'compiled' : 'up to date', '->', res.r1cs);
}
