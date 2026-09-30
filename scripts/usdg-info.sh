#!/usr/bin/env bash
# CF-002/CF-003: verify the chain and read USDG metadata from chain rather than assuming it.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; . ./.env; set +a; }
RPC="${ROBINHOOD_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
USDG="${USDG_ADDRESS:-0x7E955252E15c84f5768B83c41a71F9eba181802F}"
CAST="${CAST:-cast}"  # `make usdg-info` passes the real Foundry cast

echo "chain id : $($CAST chain-id --rpc-url "$RPC") (expected ${ROBINHOOD_CHAIN_ID:-46630})"
echo "USDG     : $USDG"
echo "name     : $($CAST call "$USDG" 'name()(string)' --rpc-url "$RPC")"
echo "symbol   : $($CAST call "$USDG" 'symbol()(string)' --rpc-url "$RPC")"
echo "decimals : $($CAST call "$USDG" 'decimals()(uint8)' --rpc-url "$RPC")"
if [ -n "${private_key:-${PRIVATE_KEY:-}}" ]; then
  K="${PRIVATE_KEY:-$private_key}"; K="${K#0x}"
  ADDR=$($CAST wallet address --private-key "0x$K")
  echo "deployer : $ADDR"
  echo "ETH      : $($CAST balance "$ADDR" --rpc-url "$RPC" --ether)"
  echo "USDG     : $($CAST call "$USDG" 'balanceOf(address)(uint256)' "$ADDR" --rpc-url "$RPC") (raw, 6 decimals)"
fi
