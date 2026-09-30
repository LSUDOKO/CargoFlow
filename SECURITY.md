# Security Policy

CargoFlow is an **unaudited testnet prototype**. Do not use it with real funds.

## Reporting a vulnerability
Please report privately via GitHub Security Advisories ("Report a vulnerability" on the repository's
Security tab). Do not open public issues for vulnerabilities. Expect an initial response within 7 days.

## Scope
Smart contracts, proof/context binding, access control, the AI guardrail boundary, and the backend's
transaction-sending paths. The threat model is documented in `docs/project/16-security-threat-model.md`.

## Known assumptions
- ZK proofs attest to the encoded statement over committed data, not to sensor honesty.
- Testnet USDG and contracts are disposable.
