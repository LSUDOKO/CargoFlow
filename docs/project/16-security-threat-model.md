# Security Threat Model

## 1. Assets

The most important assets are:

- USDG in escrow;
- facility accounting state;
- proof validity;
- evidence commitments;
- supplier / financier authorization;
- dispute state;
- private telemetry.

## 2. Threat actors

### Malicious exporter

May try to trigger an illegitimate draw.

Mitigations:

- controller-only releases;
- immutable supplier recipient;
- evidence threshold;
- facility balance checks.

### Malicious financier

May attempt incorrect settlement or griefing.

Mitigations:

- role validation;
- explicit settlement rules;
- immutable commitments.

### Malicious carrier / sensor provider

May submit forged data.

Mitigations:

- signatures;
- provider identity;
- multiple sources;
- reputation;
- conflict detection;
- ZK proof over committed data;
- future staking/challenge.

### Replay attacker

May reuse an old valid proof.

Mitigations:

- shipment/milestone binding;
- policy binding;
- chain/contract binding;
- nonce / epoch binding.

### Compromised AI

May recommend bad actions or be prompt-injected.

Mitigations:

- no arbitrary token authority;
- schema validation;
- deterministic controller checks;
- action allowlist.

### Compromised backend

May submit false operational metadata.

Mitigations:

- on-chain commitments;
- role-limited transaction methods;
- cryptographic evidence verification;
- event reconciliation.

### Database compromise

May corrupt operational dashboards.

Mitigation:

- chain is source of truth for financial state;
- derive financial balances from events/on-chain reads.

## 3. ZK-specific threats

### Wrong context

A valid proof for shipment A is presented to shipment B.

Defense: context hash includes shipment ID.

### Wrong policy

A proof created under policy version 1 is used under policy version 2.

Defense: bind policy commitment.

### Front-running / replay

A valid proof is copied and submitted by another caller.

Defense: bind authorized aggregator/sender and freshness.

### Malicious witness origin

A prover could prove a false state only if the witness itself supports it; cryptography does not make bad sensors honest.

Defense: source-level trust + multi-sensor confirmation.

## 4. Financial invariants

The following should be tested as invariants:

```text
availableVaultBalance >= 0
facility.drawn <= facility.committed
released[m] can transition false → true only once
settled → no release
paused → no release
financier address remains unchanged
supplier address remains unchanged
fee cannot exceed configured limits
```

## 5. Emergency design

An admin pause should be narrowly scoped. Avoid a hidden admin path that can transfer user funds. Separate:

`pause protocol`

from

`withdraw arbitrary funds`.

## 6. Upgradeability

Prefer immutable/non-upgradeable core contracts for the hackathon unless an upgrade framework is required. Simpler code is easier to reason about and easier for judges to inspect.
