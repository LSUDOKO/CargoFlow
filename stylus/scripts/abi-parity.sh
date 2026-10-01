#!/usr/bin/env bash
# The Stylus engine and the Solidity reference must expose identical function selectors, otherwise the
# benchmark would not be comparing like with like. Compares both ABIs' method identifiers.
set -euo pipefail
cd "$(dirname "$0")/.."
CAST="${CAST:-cast}"; FORGE="${FORGE:-forge}"
sel() { # prints "selector name(sig)" for each function in a Solidity interface on stdin
  grep -oE 'function [a-zA-Z0-9_]+\([^)]*\)' | sed 's/^function //' | while read -r sig; do
    canon=$(python3 - "$sig" <<'PY'
import re, sys
s = sys.argv[1]
name, args = s.split("(", 1)
types = [a.strip().split(" ")[0] for a in args.rstrip(")").split(",") if a.strip()]
print(f"{name}({','.join(types)})")
PY
)
    echo "$("$CAST" sig "$canon") $canon"
  done | sort
}
stylus=$(cargo stylus export-abi 2>/dev/null | sel)
solidity=$(cd ../contracts && "$FORGE" inspect EvidenceEngineSol methodIdentifiers --json | python3 -c '
import json,sys
for sig, sel in json.load(sys.stdin).items(): print("0x"+sel, sig)' | sort)
if [ "$stylus" != "$solidity" ]; then
  echo "selector mismatch" >&2; echo "--- stylus"; echo "$stylus"; echo "--- solidity"; echo "$solidity"; exit 1
fi
echo "selectors identical:"; echo "$stylus"
