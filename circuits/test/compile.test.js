'use strict';
// Regression for a CI failure: test files start in parallel, and on a clean checkout every one of them
// asked for the circuit to be compiled into the same directory at once. circom panicked.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function compileInChild(out) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['-e', "const r = require('./scripts/compile').build({ out: process.argv[1] }); console.log(JSON.stringify({ compiled: r.compiled }));", out],
      { cwd: root },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('concurrent first-time compiles all succeed and compile only once', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-compile-'));
  try {
    const results = await Promise.all([1, 2, 3, 4].map(() => compileInChild(out)));
    for (const r of results) assert.equal(r.code, 0, `a concurrent compile failed: ${r.stderr.slice(0, 300)}`);

    const compiledCount = results.filter((r) => JSON.parse(r.stdout.trim().split('\n').pop()).compiled).length;
    assert.equal(compiledCount, 1, 'exactly one process should compile; the rest wait and reuse the result');

    assert.ok(fs.existsSync(path.join(out, 'telemetry_epoch.r1cs')));
    assert.ok(fs.existsSync(path.join(out, 'telemetry_epoch_js', 'telemetry_epoch.wasm')));
    assert.ok(!fs.existsSync(path.join(out, '.compile.lock')), 'the lock must be released');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
