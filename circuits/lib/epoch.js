'use strict';
// Reference JS implementation of the epoch commitment. It must agree bit-for-bit with
// backend/internal/merkle (Go) and with telemetry_epoch.circom; test/parity.test.js enforces that.
const crypto = require('node:crypto');
const { buildPoseidon } = require('circomlibjs');

const TEMP_OFFSET = 10_000n;
const LAT_OFFSET = 90_000_000n;
const LON_OFFSET = 180_000_000n;
const N = 8;
const DEPTH = 3;

let poseidonPromise;
async function poseidon() {
  poseidonPromise ||= buildPoseidon();
  return poseidonPromise;
}

async function hash(inputs) {
  const p = await poseidon();
  return p.F.toObject(p(inputs.map(BigInt)));
}

/** SHA-256 of the sensor id truncated to 31 bytes, as in merkle.SensorField. */
function sensorField(id) {
  const sum = crypto.createHash('sha256').update(id).digest();
  return BigInt('0x' + sum.subarray(0, 31).toString('hex'));
}

/** leaf = Poseidon(ts, sensorField, temp+10000, humidity, lat+90e6, lon+180e6, shock, salt) */
async function leafHash(r) {
  return hash([
    r.timestamp,
    sensorField(r.sensorId),
    BigInt(r.temperatureX100) + TEMP_OFFSET,
    r.humidityX100,
    BigInt(r.latitudeE6) + LAT_OFFSET,
    BigInt(r.longitudeE6) + LON_OFFSET,
    r.shockX100,
    r.salt,
  ]);
}

/** Complete binary Poseidon tree; leaves.length must be a power of two. Returns levels[0..depth]. */
async function buildTree(leaves) {
  let level = leaves.map(BigInt);
  const levels = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(await hash([level[i], level[i + 1]]));
    levels.push(next);
    level = next;
  }
  return levels;
}

/** Builds the circuit input object (all values as decimal strings). */
async function makeInput({ readings, contextHash, minTempX100, maxTempX100 }) {
  if (readings.length !== N) throw new Error(`expected ${N} readings`);
  const leaves = [];
  for (const r of readings) leaves.push(await leafHash(r));
  const levels = await buildTree(leaves);
  const root = levels[levels.length - 1][0];
  const col = (f) => readings.map((r) => f(r).toString());
  return {
    root,
    input: {
      contextHash: BigInt(contextHash).toString(),
      merkleRoot: root.toString(),
      minTemp: (BigInt(minTempX100) + TEMP_OFFSET).toString(),
      maxTemp: (BigInt(maxTempX100) + TEMP_OFFSET).toString(),
      timestamp: col((r) => BigInt(r.timestamp)),
      sensorField: col((r) => sensorField(r.sensorId)),
      temp: col((r) => BigInt(r.temperatureX100) + TEMP_OFFSET),
      humidity: col((r) => BigInt(r.humidityX100)),
      lat: col((r) => BigInt(r.latitudeE6) + LAT_OFFSET),
      lon: col((r) => BigInt(r.longitudeE6) + LON_OFFSET),
      shock: col((r) => BigInt(r.shockX100)),
      salt: col((r) => BigInt(r.salt)),
    },
  };
}

/** Eight plausible core-probe readings, all inside 2-8 C: the demo's recovery stream. */
function sampleReadings(tempsX100 = [450, 460, 460, 470, 450, 460, 470, 460]) {
  return tempsX100.map((t, i) => ({
    timestamp: 1_800_002_400 + i * 60,
    sensorId: 'sensor-2',
    temperatureX100: t,
    humidityX100: 6500 + i,
    latitudeE6: 18_940_000 - i * 10,
    longitudeE6: 72_960_000 + i * 10,
    shockX100: 10 + i,
    salt: 1_000_003n + BigInt(i) * 7919n,
  }));
}

module.exports = { hash, leafHash, buildTree, makeInput, sampleReadings, sensorField, TEMP_OFFSET, N, DEPTH };
