# Zero-Knowledge and Privacy Architecture

## 1. Privacy goal

A financier may need to know:

> "Were all relevant cargo temperatures inside the agreed 2°C–8°C range?"

They should not necessarily learn:

- every minute-by-minute reading;
- exact internal cargo locations;
- complete route history;
- competitor-sensitive transit data.

## 2. Commitment model

Telemetry is batched off-chain.

```text
reading_1 → H()
reading_2 → H()
...
reading_n → H()
     ↓
 Merkle Tree
     ↓
 Merkle Root
     ↓
on-chain commitment
```

## 3. Context binding

The proof must not merely prove a value range. It should prove the right shipment under the right policy.

Example context tuple:

```text
context = Poseidon(
    shipmentId,
    milestoneId,
    policyCommitment,
    chainId,
    verifierContract,
    aggregatorAddress,
    nonce
)
```

The proof is valid only when the public context hash matches the contract's expected context.

## 4. ZK statement

For an epoch with N hidden readings:

```text
For every i in [0, N):
    minAllowedTemp <= readings[i] <= maxAllowedTemp
```

Public inputs:

- expected context hash;
- telemetry Merkle root;
- minimum bound;
- maximum bound.

Private inputs:

- readings;
- salts;
- shipment ID;
- milestone ID;
- policy commitment;
- nonce and other bound fields as needed by the circuit.

## 5. Important design choice: consistency of hash function

If the circuit uses Poseidon internally, the off-chain commitment pipeline should either:

- use Poseidon consistently, or
- define a clean bridge between the external commitment format and the circuit's internal hash.

Do not mix SHA-256 and Poseidon casually and then claim the proof is over the same commitment.

## 6. Replay protection

A proof should not be reusable on another shipment or another contract.

Bind:

- chain ID;
- verifier contract address;
- shipment ID;
- milestone ID;
- policy commitment;
- authorized submitter;
- freshness nonce / epoch ID.

## 7. Recovery scenario

Normal path:

```text
Sensor data → compliant → milestone passes
```

Failure path:

```text
Sensor data → anomaly → PAUSED
                         ↓
                  secondary evidence
                         ↓
                  ZK proof of compliance
                         ↓
                      RESUME
```

## 8. What ZK does NOT prove

A valid ZK proof proves the truth of the statement encoded by the circuit over the supplied witness and commitments. It does not independently prove that a physical sensor was honest at the time of collection.

Therefore CargoFlow must combine cryptography with:

- trusted or credentialed evidence sources;
- device identities;
- source reputation;
- timestamp discipline;
- cross-source checks;
- challenge mechanisms.

## 9. MVP circuit plan

Start with a small circuit:

```text
8 temperature values
2 public bounds
1 context hash
1 Merkle root
```

Then add other fields only when the small circuit works end-to-end.

## 10. Verification acceptance criteria

- invalid bound fails;
- one out-of-range reading fails;
- wrong shipment context fails;
- wrong nonce fails;
- wrong contract/chain context fails;
- tampered Merkle root fails;
- valid proof verifies on-chain;
- raw readings are not emitted by the contract.
