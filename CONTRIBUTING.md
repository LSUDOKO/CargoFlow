# Contributing to CargoFlow

## Workflow
1. Open or pick an issue; discuss larger changes first.
2. Branch from `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`.
3. Keep commits small and single-purpose, with a one-line message in conventional style
   (`feat(contracts): add milestone release`).
4. Run `make check` before pushing. CI must pass.
5. Open a pull request using the template.

## Standards
- **Contracts:** `forge fmt`, custom errors, events for every state change, tests for every branch,
  invariant tests for any accounting change. No upgradeable proxies in core contracts.
- **Go:** `gofmt`, `go vet`, table-driven tests, fixed-point integers for anything that feeds a proof or transaction.
- **TypeScript:** strict mode, no `any`, typed chain reads.
- **Never commit secrets.** Use `.env` (ignored) and keep `.env.example` current.
- **No unmeasured performance claims.** Benchmarks must be reproducible from the repo.
