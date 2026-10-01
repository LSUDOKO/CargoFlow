#!/usr/bin/env bash
# Generates one fresh private key per operational role and demo actor that is missing from .env, so no
# role shares a wallet with another. Keys are appended to the gitignored .env and NEVER printed; only
# the addresses are. Safe to re-run: existing keys are kept.
set -euo pipefail
cd "$(dirname "$0")/.."
CAST="${CAST:-cast}"
touch .env
for name in WORKER MONITOR MANAGER ARBITER EXPORTER FINANCIER BUYER; do
  var="${name}_KEY"
  if ! grep -q "^${var}=." .env; then
    key=$("$CAST" wallet new --json | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["private_key"])')
    printf '%s=%s\n' "$var" "$key" >> .env
    echo "generated ${var}"
  fi
  key=$(grep "^${var}=" .env | tail -1 | cut -d= -f2-)
  printf '%-10s %s\n' "$name" "$("$CAST" wallet address --private-key "$key")"
done
