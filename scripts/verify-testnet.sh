#!/usr/bin/env bash
# Verifies the deployed CargoFlow contracts on the Robinhood testnet explorer (Blockscout) from the
# deployment manifest, so the source shown on the explorer is the source in this repository.
set -euo pipefail
cd "$(dirname "$0")/.."
CAST="${CAST:-cast}"; FORGE="${FORGE:-forge}"
M=contracts/deployments/robinhood-testnet.json
URL="${EXPLORER_API_URL:-https://explorer.testnet.chain.robinhood.com/api/}"
get() { python3 -c "import json,sys; d=json.load(open('$M')); print(d['contracts'].get('$1') or d.get('$1'))"; }
ACCESS=$(get access); REG=$(get shipmentRegistry); POL=$(get policyEngine); EV=$(get evidenceRegistry)
VAULT=$(get receivableVault); CTRL=$(get financingController); VER=$(get groth16Verifier); USDG=$(get usdg); DEPLOYER=$(get deployer)
verify() { # name address path:Contract [constructor-args]
  echo "verifying $1 at $2"
  (cd contracts && "$FORGE" verify-contract "$2" "$3" --chain 46630 --verifier blockscout --verifier-url "$URL" \
    --compiler-version 0.8.28 --evm-version cancun --num-of-optimizations 200 --watch ${4:+--constructor-args "$4"})
}
verify CargoFlowAccess "$ACCESS" src/access/CargoFlowAccess.sol:CargoFlowAccess "$("$CAST" abi-encode 'c(uint48,address)' 86400 "$DEPLOYER")"
verify ShipmentRegistry "$REG" src/ShipmentRegistry.sol:ShipmentRegistry
verify PolicyEngine "$POL" src/PolicyEngine.sol:PolicyEngine "$("$CAST" abi-encode 'c(address)' "$REG")"
verify EvidenceRegistry "$EV" src/EvidenceRegistry.sol:EvidenceRegistry "$("$CAST" abi-encode 'c(address)' "$ACCESS")"
verify ReceivableVault "$VAULT" src/ReceivableVault.sol:ReceivableVault "$("$CAST" abi-encode 'c(address,address)' "$ACCESS" "$USDG")"
verify Groth16Verifier "$VER" generated/Groth16Verifier.sol:Groth16Verifier
COVER=$(get coverPool); DEVICES=$(get deviceRegistry); EBL=$(get eblRegistry)
EBL_ARG=${EBL:-0x0000000000000000000000000000000000000000}; [ "$EBL_ARG" = None ] && EBL_ARG=0x0000000000000000000000000000000000000000
verify FinancingController "$CTRL" src/FinancingController.sol:FinancingController \
  "$("$CAST" abi-encode 'c(address,address,address,address,address,address,address)' "$ACCESS" "$REG" "$POL" "$EV" "$VAULT" "$VER" "$EBL_ARG")"
if [ -n "$COVER" ] && [ "$COVER" != None ]; then
  verify CoverPool "$COVER" src/CoverPool.sol:CoverPool "$("$CAST" abi-encode 'c(address,address)' "$ACCESS" "$CTRL")"
fi
if [ -n "$DEVICES" ] && [ "$DEVICES" != None ]; then
  verify DeviceRegistry "$DEVICES" src/DeviceRegistry.sol:DeviceRegistry "$("$CAST" abi-encode 'c(address)' "$ACCESS")"
fi
if [ "$EBL_ARG" != 0x0000000000000000000000000000000000000000 ]; then
  verify EBLRegistry "$EBL" src/EBLRegistry.sol:EBLRegistry "$("$CAST" abi-encode 'c(address)' "$ACCESS")"
fi
