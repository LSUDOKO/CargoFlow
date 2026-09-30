# CargoFlow developer commands. Run `make help`.
# `forge` on some machines is a different tool; pick the real Foundry binary (prints "Version:").
FORGE ?= $(shell for p in "$$(command -v forge)" "$$HOME/.foundry/bin/forge" "$$HOME/.config/.foundry/bin/forge"; do \
	[ -n "$$p" ] && [ -x "$$p" ] && "$$p" --version 2>/dev/null | grep -q "Version:" && { echo "$$p"; break; }; done)
CAST ?= $(dir $(FORGE))cast

.PHONY: help check contracts-build contracts-test contracts-fmt contracts-fmt-check backend-test frontend-check usdg-info

help: ## List commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-20s %s\n",$$1,$$2}'

check: contracts-fmt-check contracts-build contracts-test backend-test frontend-check ## Format, build and test everything that exists

contracts-build: ## Compile contracts
	@cd contracts && $(FORGE) build

contracts-test: ## Run contract tests
	@cd contracts && $(FORGE) test

contracts-fmt: ## Format Solidity
	@cd contracts && $(FORGE) fmt

contracts-fmt-check: ## Check Solidity formatting
	@cd contracts && $(FORGE) fmt --check

backend-test: ## Run Go tests (skipped until backend exists)
	@if [ -f backend/go.mod ]; then cd backend && go vet ./... && go test ./...; else echo "backend: not initialized, skipping"; fi

frontend-check: ## Lint, typecheck, build frontend (skipped until it exists)
	@if [ -f frontend/package.json ]; then cd frontend && pnpm lint && pnpm typecheck && pnpm build; else echo "frontend: not initialized, skipping"; fi

usdg-info: ## Read USDG metadata from Robinhood testnet
	@./scripts/usdg-info.sh
