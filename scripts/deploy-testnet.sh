#!/usr/bin/env bash
# Deploys CargoFlow to Robinhood Chain Testnet using the deployer key in .env and a separate wallet per
# operational role (generate them with scripts/testnet-keys.sh). Dry run by default; BROADCAST=1 sends the
# transactions and writes contracts/deployments/robinhood-testnet.json.
set -euo pipefail
cd "$(dirname "$0")/.."
CAST="${CAST:-cast}"; FORGE="${FORGE:-forge}"
set -a; . ./.env; set +a
export ROBINHOOD_RPC_URL="${ROBINHOOD_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
export USDG_ADDRESS="${USDG_ADDRESS:-0x7E955252E15c84f5768B83c41a71F9eba181802F}"
addr() { "$CAST" wallet address --private-key "$1"; }
for v in WORKER_KEY MONITOR_KEY MANAGER_KEY ARBITER_KEY; do
  [ -n "${!v:-}" ] || { echo "$v is missing: run scripts/testnet-keys.sh" >&2; exit 1; }
done
export WORKER_ADDRESS=$(addr "$WORKER_KEY") MONITOR_ADDRESS=$(addr "$MONITOR_KEY")
export MANAGER_ADDRESS=$(addr "$MANAGER_KEY") ARBITER_ADDRESS=$(addr "$ARBITER_KEY")
[ "$("$CAST" chain-id --rpc-url "$ROBINHOOD_RPC_URL")" = 46630 ] || { echo "RPC is not Robinhood Chain Testnet (46630)" >&2; exit 1; }
flags=(--rpc-url robinhood_testnet)
if [ "${BROADCAST:-0}" = 1 ]; then flags+=(--broadcast); else echo "dry run (set BROADCAST=1 to send)"; fi
cd contracts && "$FORGE" script script/Deploy.s.sol "${flags[@]}"
