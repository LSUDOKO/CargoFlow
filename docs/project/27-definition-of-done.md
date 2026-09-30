# CargoFlow Definition of Done

## Protocol

- [ ] Every shipment has a unique ID.
- [ ] Invoice is represented by a commitment/hash.
- [ ] Policy is committed.
- [ ] Facility is isolated by shipment.
- [ ] Financier must explicitly fund the facility.
- [ ] Supplier recipient is fixed.
- [ ] Milestones cannot be released twice.
- [ ] Drawn amount never exceeds committed amount.

## Evidence

- [ ] Telemetry accepts multiple evidence sources.
- [ ] Fixed-point representation is deterministic.
- [ ] Conflict factor is computed.
- [ ] Evidence score is 0–100.
- [ ] Stale/replayed data is detected or quarantined.
- [ ] Epoch root is committed on-chain.

## ZK

- [ ] Valid compliant epoch proof verifies.
- [ ] Out-of-range witness fails.
- [ ] Wrong shipment fails.
- [ ] Wrong milestone fails.
- [ ] Wrong policy commitment fails.
- [ ] Wrong chain/contract context fails.
- [ ] Wrong nonce/epoch fails.
- [ ] Contract never emits raw secret telemetry.

## Financial safety

- [ ] Paused facility cannot release.
- [ ] Disputed facility cannot release.
- [ ] Settled facility cannot release.
- [ ] Vault is protected against reentrancy.
- [ ] Token transfers use safe ERC-20 handling.
- [ ] Unauthorized controller calls revert.

## AI

- [ ] AI output is schema-validated.
- [ ] AI actions are allowlisted.
- [ ] AI cannot arbitrary-transfer USDG.
- [ ] Prompt-injection input cannot override guardrails.
- [ ] Every AI-triggered on-chain action has a reason code/hash.

## UX

- [ ] User sees current chain.
- [ ] User sees USDG balances.
- [ ] User sees milestone state.
- [ ] User sees evidence score.
- [ ] User sees why a facility paused.
- [ ] User can see proof verification result.
- [ ] User can see transaction hashes.
- [ ] Final settlement is obvious.

## Demo

- [ ] Demo begins from a clean funded state.
- [ ] M1 releases.
- [ ] M2 releases.
- [ ] M3 anomaly pauses.
- [ ] Failed M3 release visibly reverts.
- [ ] Secondary proof verifies.
- [ ] M3 resumes.
- [ ] M4/M5 complete.
- [ ] 100,000 USDG settlement completes.
- [ ] Final state is `SETTLED`.

## Performance claims

- [ ] ZK proof generation time measured.
- [ ] ZK verification gas measured.
- [ ] EVM evidence gas measured.
- [ ] Stylus evidence gas measured if Stylus is included.
- [ ] No benchmark number is copied into the submission without a reproducible test.

## Security release gate

Do not publish the contract as a production financial protocol based solely on a hackathon testnet review. The prototype should clearly state its testnet / experimental status.
