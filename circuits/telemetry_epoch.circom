pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

/*
 * Proof of physical state for one telemetry epoch.
 *
 * Statement: "there exist 2^DEPTH hidden readings whose salted Poseidon Merkle root is `merkleRoot`
 * and whose every temperature lies in [minTemp, maxTemp]".
 *
 * Public inputs (the contract recomputes or reads every one of them, the prover chooses none):
 *   contextHash  keccak256(chainId, verifier, controller, shipmentId, epochId, policyCommitment,
 *                          submitter, pauseCount) mod p: binds the proof to one facility, one epoch,
 *                          one pause, one submitter, one chain and one contract.
 *   merkleRoot   the epoch root already committed in EvidenceRegistry.
 *   minTemp      policy lower bound, offset-encoded (temperature x100 + 10000).
 *   maxTemp      policy upper bound, offset-encoded.
 *
 * Private inputs: per reading the eight leaf fields and the salt. The leaf encoding is the protocol
 * contract shared with backend/internal/merkle and circuits/lib/epoch.js:
 *   leaf = Poseidon(timestamp, sensorField, temp, humidity, lat, lon, shock, salt)
 *   with temp = temperatureX100 + 10000, lat = latE6 + 90e6, lon = lonE6 + 180e6.
 *
 * What this does NOT prove: that the sensor measured honestly. It proves the committed readings
 * satisfy the range; sensor trust comes from credentials, reliability and multi-sensor checks.
 */
template TelemetryEpoch(DEPTH) {
    var N = 1 << DEPTH;

    signal input contextHash;
    signal input merkleRoot;
    signal input minTemp;
    signal input maxTemp;

    signal input timestamp[N];
    signal input sensorField[N];
    signal input temp[N];
    signal input humidity[N];
    signal input lat[N];
    signal input lon[N];
    signal input shock[N];
    signal input salt[N];

    // Keep contextHash inside the constraint system so it cannot be optimised out of the statement.
    signal contextBinding;
    contextBinding <== contextHash * contextHash;

    // Temperatures and bounds must fit 16 bits (offset temps are at most 25000), which also makes
    // the comparators below sound.
    component minBits = Num2Bits(16);
    minBits.in <== minTemp;
    component maxBits = Num2Bits(16);
    maxBits.in <== maxTemp;

    component tempBits[N];
    component aboveMin[N];
    component belowMax[N];
    component leaf[N];

    signal tree[2 * N - 1];

    for (var i = 0; i < N; i++) {
        tempBits[i] = Num2Bits(16);
        tempBits[i].in <== temp[i];

        aboveMin[i] = GreaterEqThan(16);
        aboveMin[i].in[0] <== temp[i];
        aboveMin[i].in[1] <== minTemp;
        aboveMin[i].out === 1;

        belowMax[i] = LessEqThan(16);
        belowMax[i].in[0] <== temp[i];
        belowMax[i].in[1] <== maxTemp;
        belowMax[i].out === 1;

        leaf[i] = Poseidon(8);
        leaf[i].inputs[0] <== timestamp[i];
        leaf[i].inputs[1] <== sensorField[i];
        leaf[i].inputs[2] <== temp[i];
        leaf[i].inputs[3] <== humidity[i];
        leaf[i].inputs[4] <== lat[i];
        leaf[i].inputs[5] <== lon[i];
        leaf[i].inputs[6] <== shock[i];
        leaf[i].inputs[7] <== salt[i];
        tree[i] <== leaf[i].out;
    }

    // Binary Poseidon tree, leaves first then each level upward, matching merkle.Build.
    component node[N - 1];
    var offset = 0;
    var width = N;
    var nextOffset = N;
    var k = 0;
    for (var level = 0; level < DEPTH; level++) {
        for (var j = 0; j < width \ 2; j++) {
            node[k] = Poseidon(2);
            node[k].inputs[0] <== tree[offset + 2 * j];
            node[k].inputs[1] <== tree[offset + 2 * j + 1];
            tree[nextOffset + j] <== node[k].out;
            k++;
        }
        offset = nextOffset;
        nextOffset += width \ 2;
        width = width \ 2;
    }

    merkleRoot === tree[2 * N - 2];
}

component main {public [contextHash, merkleRoot, minTemp, maxTemp]} = TelemetryEpoch(3);
