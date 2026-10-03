// Vectors: the live deployment's own shipment (route, reference and epoch ids), and policy hashes computed with
// Foundry's `cast abi-encode` + `cast keccak` over the PolicyEngine.Policy tuple (what hashPolicy returns).
import { describe, expect, it } from "vitest";
import { epochIdFor, externalRefHash, hashPolicy, onChainPolicy, routeCommitment, shipmentIdFor, textHash } from "../src/contracts/commitments";
import { encodeAbiParameters, keccak256 } from "viem";

const LIVE_ID = "0x5a9082d1854c1cc3e5fcf8aa1ebc3a3560495e03ee7d00110baf256fe9b49d61";

describe("routeCommitment", () => {
  it("matches backend service.RouteCommitment (the live Nhava Sheva -> Singapore lane)", () => {
    expect(routeCommitment([{ latE6: 18_950_000, lonE6: 72_950_000 }, { latE6: 1_264_000, lonE6: 103_820_000 }])).toBe(
      "0x7e7948f31a11efa39def5bb6f6e9cada49841a6f95441eb69fb36ab12a3d40c6",
    );
  });
  it("ignores extra fields and keeps field order", () => {
    const a = routeCommitment([{ lonE6: 2, latE6: 1, label: "x" } as never]);
    expect(a).toBe(routeCommitment([{ latE6: 1, lonE6: 2 }]));
  });
});

describe("hashPolicy (v2, ten fields)", () => {
  it("matches cast keccak(abi.encode(policy)) for a frozen-cargo policy with humidity and shock limits", () => {
    expect(
      hashPolicy({
        minTempX100: -2500, maxTempX100: -1500, maxEvidenceAgeSec: 1800, maxRouteDeviationM: 25_000, minEvidenceScore: 75,
        maxConflictBps: 3000, maxRiskBps: 3500, requiresZK: true, maxHumidityX100: 8500, maxShockX100: 350,
      }),
    ).toBe("0x10ed35d56dfc6a37d093b607b48ac9f62f2614dfe750fbaf5a7f2f424f259bf3");
  });
  it("maps the API's policy shape (maxGapSec, requiresZk) onto the struct", () => {
    const api = { minTempX100: 200, maxTempX100: 800, maxGapSec: 1800, maxRouteDeviationM: 25000, minEvidenceScore: 75, maxConflictBps: 3000, maxRiskBps: 3500, requiresZk: false, minSensors: 2 };
    expect(hashPolicy(onChainPolicy(api))).toBe("0x1530773ac6364b74d7f0037390279d1c3d03a289dda7ba466615083d8297066a");
  });
  it("differs from the v1 eight-field commitment of the same policy (the live v1 shipment's 0x52db...)", () => {
    const v1 = keccak256(
      encodeAbiParameters(
        [{ type: "tuple", components: [{ type: "int32" }, { type: "int32" }, { type: "uint32" }, { type: "uint32" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }, { type: "bool" }] }],
        [[200, 800, 1800, 25000, 75, 3000, 3500, false]],
      ),
    );
    expect(v1).toBe("0x52db76e9584e31129e779c1e0fa73cb7148c29d52e723ba43f713f821683e933");
    expect(hashPolicy({ minTempX100: 200, maxTempX100: 800, maxEvidenceAgeSec: 1800, maxRouteDeviationM: 25000, minEvidenceScore: 75, maxConflictBps: 3000, maxRiskBps: 3500, requiresZK: false, maxHumidityX100: 0, maxShockX100: 0 })).not.toBe(v1);
  });
});

describe("ids", () => {
  it("shipmentIdFor reproduces a live shipment id from its exporter and reference", () => {
    expect(shipmentIdFor("0x8e6877a28d51a6c2b1699154cc17f3ebf682102f", "CF-LIVE-1790936950736")).toBe(LIVE_ID);
    expect(shipmentIdFor("0x8e6877a28d51a6c2b1699154cc17f3ebf682102f", externalRefHash("CF-LIVE-1790936950736"))).toBe(LIVE_ID);
  });
  it("epochIdFor reproduces the live shipment's first epoch id", () => {
    expect(epochIdFor(LIVE_ID, 0, 1)).toBe("0xc2288d1ef25b696f3f854c7c59c762a3e8cd41844975bca9f72966ceab0d2153");
  });
  it("textHash is keccak256 of the UTF-8 text", () => {
    expect(textHash("")).toBe("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  });
});
