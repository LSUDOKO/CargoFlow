import { describe, expect, it } from "vitest";
import {
  buildTree, deriveSalt, epochTree, hash2, leafHash, proveInclusion, sensorField, sortReadings, verifyEpochRoot, verifyInclusion,
  verifyReadingInclusion, type SaltedReading,
} from "../src/merkle";

// Vector computed by backend/internal/merkle (DeriveSalt, LeafHash, Build, Prove) with
// shipment id 0x0102..20, secret "sdk-vector-secret-0123456789".
const shipmentId = "0x" + Array.from({ length: 32 }, (_, i) => (i + 1).toString(16).padStart(2, "0")).join("");
const secret = "sdk-vector-secret-0123456789";
const readings = [
  { timestamp: 1700000000, sensorId: "probe-a", temperatureX100: 460, humidityX100: 6500, latitudeE6: 1290000, longitudeE6: 103800000, shockX100: 12 },
  { timestamp: 1700000000, sensorId: "probe-b", temperatureX100: -1850, humidityX100: 0, latitudeE6: -33900000, longitudeE6: -70600000, shockX100: 0 },
  { timestamp: 1700000060, sensorId: "probe-a", temperatureX100: 471, humidityX100: 6510, latitudeE6: 1291000, longitudeE6: 103801000, shockX100: 250 },
];
const GO = {
  salts: [
    27398318311885361592414036397924857412814883193743615484738416593538371486n,
    351007230242276736961966800398262691740869753825533508812259351112355572488n,
    287686490194133417129526657684428277544842814590701946906623011614021288244n,
  ],
  leaves: [
    12418650118037963562214510311437825375741620664945498219889367091856496972050n,
    1571846917952517912933080650889230911710667582041865899443982380315819140902n,
    13824177609273657225111839681486671327500318805902545697749991127891299085170n,
  ],
  root: 8781233696310281511104073192349209838939474557132586971301809881159583723836n,
  rootHex: "0x136a008c5ea9bab1f79901bf3dd2d1b381ca41456ad7cb8310d27e9a4eb8f13c",
  proof2: [0n, 6289231854622740591219499991983761778183651986590491368795839621918236632516n],
  sensorFieldProbeA: 183011437964951101486989708827521182734812601223926423028922758458670578536n,
};

describe("merkle (pinned to backend/internal/merkle)", () => {
  it("uses circomlib's Poseidon", () => {
    expect(hash2(1n, 2n)).toBe(7853200120776062878684798364095072458815029376092732009249414926327459813530n);
  });

  it("derives salts, sensor fields, leaves and the root exactly as Go does", () => {
    expect(sensorField("probe-a")).toBe(GO.sensorFieldProbeA);
    readings.forEach((r, i) => {
      expect(deriveSalt(secret, shipmentId, r.sensorId, r.timestamp)).toBe(GO.salts[i]);
      expect(leafHash(r, GO.salts[i]!)).toBe(GO.leaves[i]);
    });
    const t = buildTree(GO.leaves);
    expect(t.root).toBe(GO.root);
    expect(t.rootHex).toBe(GO.rootHex);
    expect(t.levels[0]).toHaveLength(4);
    expect(proveInclusion(t, 2)).toEqual(GO.proof2);
  });

  it("sorts salted readings into commitment order and verifies the epoch root", () => {
    const salted: SaltedReading[] = readings.map((r, i) => ({ ...r, salt: GO.salts[i]! }));
    const shuffled = [salted[2]!, salted[1]!, salted[0]!];
    expect(sortReadings(shuffled).map((r) => r.salt)).toEqual(GO.salts);
    expect(epochTree(shuffled).rootHex).toBe(GO.rootHex);
    expect(verifyEpochRoot(shuffled, GO.rootHex)).toBe(true);
    expect(verifyEpochRoot(shuffled, GO.root.toString())).toBe(true);
    expect(verifyEpochRoot([{ ...salted[0]!, temperatureX100: 461 }, salted[1]!, salted[2]!], GO.rootHex)).toBe(false);
    expect(verifyEpochRoot([{ ...salted[0]!, salt: 1n }, salted[1]!, salted[2]!], GO.rootHex)).toBe(false);
  });

  it("verifies every inclusion proof and rejects tampering", () => {
    const t = buildTree(GO.leaves);
    for (let i = 0; i < 4; i++) expect(verifyInclusion(t.levels[0]![i]!, i, proveInclusion(t, i), t.root)).toBe(true);
    expect(verifyReadingInclusion({ ...readings[2]!, salt: GO.salts[2]! }, 2, GO.proof2, GO.rootHex)).toBe(true);
    expect(verifyReadingInclusion({ ...readings[2]!, salt: GO.salts[2]! }, 3, GO.proof2, GO.rootHex)).toBe(false);
    expect(verifyReadingInclusion({ ...readings[2]!, salt: GO.salts[1]! }, 2, GO.proof2, GO.rootHex)).toBe(false);
    expect(verifyInclusion(GO.leaves[2]!, 2, [1n, GO.proof2[1]!], GO.root)).toBe(false);
    expect(verifyInclusion(GO.leaves[2]!, 4, GO.proof2, GO.root)).toBe(false);
  });

  it("refuses unencodable readings like the backend", () => {
    expect(() => leafHash({ ...readings[0]!, timestamp: 0 }, 1n)).toThrow();
    expect(() => leafHash({ ...readings[0]!, humidityX100: -1 }, 1n)).toThrow();
    expect(() => leafHash(readings[0]!, -1n)).toThrow();
    expect(() => buildTree([])).toThrow();
  });
});
