#!/usr/bin/env bash
# CF-051: runs the same fuseEpoch calldata through the Solidity reference and the Stylus engine on one chain and
# prints measured execution gas. Needs a chain that supports Stylus (Arbitrum Sepolia) and a funded key.
#
#   PRIVATE_KEY=0x... ./stylus/scripts/bench.sh                       # Arbitrum Sepolia via publicnode
#   SOLIDITY_ADDRESS=0x.. STYLUS_ADDRESS=0x.. ./bench.sh              # reuse earlier deployments
#   BENCH_SKIP_STYLUS=1 RPC_URL=http://127.0.0.1:8545 ... ./bench.sh # Solidity half only (harness self-test)
#
# Execution gas = receipt.gasUsed - receipt.gasUsedForL1 - intrinsic gas. Arbitrum receipts include an L1 data
# component (calldata size times L1 prices) and every transaction pays 21000 plus calldata gas; both are the same
# for the two engines, so they are removed to leave only what the program itself executed.
set -euo pipefail
cd "$(dirname "$0")/../.."
CAST="${CAST:-cast}"; FORGE="${FORGE:-forge}"
[ -f .env ] && { set -a; . ./.env; set +a; }
RPC="${RPC_URL:-https://arbitrum-sepolia-rpc.publicnode.com}"
KEY="${PRIVATE_KEY:-0x${private_key:-}}"
[ "${#KEY}" -gt 10 ] || { echo "set PRIVATE_KEY (or private_key in .env)" >&2; exit 1; }
SIZES="${SIZES:-8 32 64 128}"

echo "chain $("$CAST" chain-id --rpc-url "$RPC"), deployer $("$CAST" wallet address --private-key "$KEY")" >&2

SOL="${SOLIDITY_ADDRESS:-}"
[ -n "$SOL" ] || SOL=$(cd contracts && "$FORGE" create src/experimental/EvidenceEngineSol.sol:EvidenceEngineSol \
  --rpc-url "$RPC" --private-key "$KEY" --broadcast --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["deployedTo"])')
echo "solidity engine: $SOL" >&2

STY="${STYLUS_ADDRESS:-}"
if [ -z "$STY" ] && [ "${BENCH_SKIP_STYLUS:-0}" != 1 ]; then
  deploy_log=$(cd stylus && cargo stylus deploy --endpoint "$RPC" --private-key "$KEY" --no-verify 2>&1 | sed 's/\x1b\[[0-9;]*m//g') || { echo "$deploy_log" | tail -20 >&2; exit 1; }
  STY=$(echo "$deploy_log" | grep -oE 'deployed code at address:[[:space:]]*0x[0-9a-fA-F]{40}' | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
  [ -n "$STY" ] || { echo "could not find the deployed address in:" >&2; echo "$deploy_log" | tail -20 >&2; exit 1; }
fi
[ -z "$STY" ] || echo "stylus engine:   $STY" >&2

arr() { # n offset-multiplier -> "[v0,v1,...]" matching contracts/test/experimental/EvidenceEngine.t.sol
  python3 -c "import sys; n,m=int(sys.argv[1]),int(sys.argv[2]); print('['+','.join(str(200+(i*m)%600) for i in range(n))+']')" "$1" "$2"
}
exec_gas() { # tx hash -> execution gas: gasUsed minus the L1 component minus intrinsic gas (21000 + calldata)
  local input; input=$("$CAST" tx "$1" input --rpc-url "$RPC")
  "$CAST" receipt "$1" --rpc-url "$RPC" --json | python3 -c '
import json,sys
r=json.load(sys.stdin); inp=bytes.fromhex(sys.argv[1][2:])
num=lambda v: int(v,16) if isinstance(v,str) else v
intrinsic=21000+sum(4 if b==0 else 16 for b in inp)
print(num(r["gasUsed"])-num(r.get("gasUsedForL1","0x0"))-intrinsic)' "$input"
}
send() { # address n
  local a b; a=$(arr "$2" 37); b=$(arr "$2" 53)
  "$CAST" send "$1" "fuseEpoch(int32,int32,int32[],int32[])" 200 800 "$a" "$b" --rpc-url "$RPC" --private-key "$KEY" --json \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["transactionHash"])'
}
call() { local a b; a=$(arr "$2" 37); b=$(arr "$2" 53); "$CAST" call "$1" "fuseEpoch(int32,int32,int32[],int32[])(uint32,uint32,uint32,uint32)" 200 800 "$a" "$b" --rpc-url "$RPC" | tr '\n' ' '; }

echo
echo "| readings per sensor | Solidity gas | Stylus gas | ratio | same result |"
echo "|---:|---:|---:|---:|:---:|"
for n in $SIZES; do
  sg=$(exec_gas "$(send "$SOL" "$n")")
  if [ -n "$STY" ]; then
    yg=$(exec_gas "$(send "$STY" "$n")")
    same=no; [ "$(call "$SOL" "$n")" = "$(call "$STY" "$n")" ] && same=yes
    printf '| %s | %s | %s | %s | %s |\n' "$n" "$sg" "$yg" "$(python3 -c "print(f'{$sg/$yg:.1f}x')")" "$same"
  else
    printf '| %s | %s | - | - | - |\n' "$n" "$sg"
  fi
done
