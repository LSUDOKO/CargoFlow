# CargoFlow developer commands. Run `make help`.
# `forge` on some machines is a different tool; pick the real Foundry binary (prints "Version:").
FORGE ?= $(shell for p in "$$(command -v forge)" "$$HOME/.foundry/bin/forge" "$$HOME/.config/.foundry/bin/forge"; do \
	[ -n "$$p" ] && [ -x "$$p" ] && "$$p" --version 2>/dev/null | grep -q "Version:" && { echo "$$p"; break; }; done)
CAST ?= $(dir $(FORGE))cast

.PHONY: anvil deploy-local demo-local zk-fixture circuits-test abi serve migrate keygen help check contracts-build contracts-test contracts-fmt contracts-fmt-check backend-test frontend-check usdg-info

help: ## List commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-20s %s\n",$$1,$$2}'

check: contracts-fmt-check contracts-build contracts-test backend-test circuits-test frontend-check ## Format, build and test everything that exists

contracts-build: ## Compile contracts
	@cd contracts && $(FORGE) build

contracts-test: ## Run contract tests
	@cd contracts && $(FORGE) test

contracts-fmt: ## Format Solidity
	@cd contracts && $(FORGE) fmt

contracts-fmt-check: ## Check Solidity formatting
	@cd contracts && $(FORGE) fmt --check

circuits-test: ## Run circuit tests (skipped without circom or installed dependencies)
	@if command -v circom >/dev/null && [ -d circuits/node_modules ]; then cd circuits && npm test --silent; else echo "circuits: circom or node_modules missing, skipping"; fi

backend-test: ## Run Go tests (skipped until backend exists)
	@if [ -f backend/go.mod ]; then cd backend && go vet ./... && go test ./...; else echo "backend: not initialized, skipping"; fi

frontend-check: ## Lint, typecheck, build frontend (skipped until it exists)
	@if [ -f frontend/package.json ]; then cd frontend && pnpm lint && pnpm typecheck && pnpm build; else echo "frontend: not initialized, skipping"; fi

anvil: ## Start a local chain on :8545 (foreground)
	@$(dir $(FORGE))anvil

deploy-local: ## Deploy CargoFlow to local anvil (run `make anvil` first)
	@cd contracts && $(FORGE) script script/Deploy.s.sol --rpc-url local --broadcast

demo-local: ## Run the hero scenario on local anvil as real transactions
	@cd contracts && $(FORGE) script script/RunHero.s.sol --rpc-url local --broadcast

zk-fixture: ## Regenerate the real Groth16 proof fixture used by contracts/test/integration/RealProof.t.sol
	@cd contracts && WRITE_PROOF_INPUTS=1 $(FORGE) test --match-test test_writeProofInputs
	@cd circuits && node scripts/make-fixture.js
	@cd contracts && $(FORGE) test --match-path test/integration/RealProof.t.sol

abi: ## Re-export contract ABIs into the backend (run after changing a contract)
	@cd contracts && $(FORGE) build >/dev/null
	@python3 scripts/export-abi.py

serve: ## Run the backend (reads .env)
	@set -a; [ -f .env ] && . ./.env; set +a; cd backend && go run ./cmd/cargoflow serve

migrate: ## Apply database migrations (reads .env)
	@set -a; [ -f .env ] && . ./.env; set +a; cd backend && go run ./cmd/cargoflow migrate

keygen: ## Generate an Ed25519 key pair for an evidence source
	@cd backend && go run ./cmd/cargoflow keygen

usdg-info: ## Read USDG metadata from Robinhood testnet
	@CAST=$(CAST) ./scripts/usdg-info.sh
