#!/usr/bin/env bash
# Tops every role and demo wallet in .env up to a small ETH balance from the deployer, for gas only.
set -euo pipefail
cd "$(dirname "$0")/.."
CAST="${CAST:-cast}"
set -a; . ./.env; set +a
RPC="${ROBINHOOD_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
TARGET_WEI="${TARGET_WEI:-500000000000000}" # 0.0005 ETH
DEPLOYER_KEY="0x${private_key#0x}"
for name in WORKER MONITOR MANAGER ARBITER EXPORTER FINANCIER BUYER; do
  var="${name}_KEY"; key="${!var:-}"
  [ -n "$key" ] || { echo "$var missing: run scripts/testnet-keys.sh" >&2; exit 1; }
  addr=$("$CAST" wallet address --private-key "$key")
  have=$("$CAST" balance "$addr" --rpc-url "$RPC")
  if [ "$have" -lt "$TARGET_WEI" ]; then
    "$CAST" send "$addr" --value "$((TARGET_WEI - have))" --private-key "$DEPLOYER_KEY" --rpc-url "$RPC" >/dev/null
    echo "funded $name $addr"
  else
    echo "ok     $name $addr"
  fi
done
echo "deployer ETH: $("$CAST" balance "$("$CAST" wallet address --private-key "$DEPLOYER_KEY")" --rpc-url "$RPC" --ether)"
