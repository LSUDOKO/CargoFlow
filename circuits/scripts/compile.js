'use strict';
// Compiles telemetry_epoch.circom (r1cs, wasm, sym). Safe to call from many processes at once: the
// test files start in parallel, and circom panics if two compiles write the same directory. Every
// caller takes an atomic directory lock, then compiles only if the output is not already fresh.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'telemetry_epoch.circom');
const defaultOut = path.join(root, 'build');

const LOCK_WAIT_MS = 180_000; // give up waiting for another compile after this long
const STALE_LOCK_MS = 240_000; // a lock older than this belongs to a crashed compile

function paths(out) {
  return {
    r1cs: path.join(out, 'telemetry_epoch.r1cs'),
    wasm: path.join(out, 'telemetry_epoch_js', 'telemetry_epoch.wasm'),
  };
}

function isFresh(out) {
  const { r1cs, wasm } = paths(out);
  return fs.existsSync(r1cs) && fs.existsSync(wasm) && fs.statSync(r1cs).mtimeMs > fs.statSync(src).mtimeMs;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquire(lock) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lock); // atomic: exactly one caller succeeds
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > STALE_LOCK_MS) fs.rmdirSync(lock);
      } catch {
        /* the holder just released it */
      }
      if (Date.now() > deadline) throw new Error('timed out waiting for another circom compile to finish');
      sleep(200);
    }
  }
}

/** Returns { r1cs, wasm, compiled }. `compiled` is false when an up-to-date build was reused. */
function build({ force = false, out = defaultOut } = {}) {
  const lock = path.join(out, '.compile.lock');
  // Fast path: an up-to-date build that nobody is currently rewriting needs no lock and no write access.
  // This matters in production, where the image runs with a read-only filesystem.
  if (!force && !fs.existsSync(lock) && isFresh(out)) return { ...paths(out), compiled: false };
  fs.mkdirSync(out, { recursive: true });
  acquire(lock);
  try {
    if (!force && isFresh(out)) return { ...paths(out), compiled: false };
    execFileSync('circom', [src, '--r1cs', '--wasm', '--sym', '-l', path.join(root, 'node_modules'), '-o', out], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ...paths(out), compiled: true };
  } finally {
    fs.rmdirSync(lock);
  }
}

function wasmPath(out = defaultOut) {
  return paths(out).wasm;
}

module.exports = { build, wasmPath, out: defaultOut, root };

if (require.main === module) {
  const i = process.argv.indexOf('--out');
  const res = build({ force: process.argv.includes('--force'), out: i > 0 ? path.resolve(process.argv[i + 1]) : defaultOut });
  console.log(res.compiled ? 'compiled' : 'up to date', '->', res.r1cs);
}
