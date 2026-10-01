#!/usr/bin/env bash
# Runs the Playwright suite against the real stack: a fresh anvil chain with the contracts deployed, a fresh
# Postgres database, the Go backend in demo mode, and a production build of the frontend. Everything it starts is
# stopped on exit. Ports default away from the usual dev ports so a running dev stack is left alone.
#
#   bash frontend/scripts/e2e-stack.sh            # from the repository root
#   E2E_KEEP=1 bash frontend/scripts/e2e-stack.sh # leave the stack running afterwards for debugging
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ANVIL_PORT="${ANVIL_PORT:-8645}"; API_PORT="${API_PORT:-8887}"; WEB_PORT="${WEB_PORT:-3100}"
DB="${E2E_DB:-cargoflow_e2e}"
PGHOST_DIR="${PGHOST_DIR:-/run/postgresql}"
FORGE="${FORGE:-$(command -v forge)}"; ANVIL="${ANVIL:-$(dirname "$FORGE")/anvil}"
LOGS="$ROOT/frontend/test-results/stack"; mkdir -p "$LOGS"
pids=()
cleanup() {
  [ "${E2E_KEEP:-0}" = 1 ] && { echo "stack left running (pids ${pids[*]})"; return; }
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
}
trap cleanup EXIT
wait_for() { for _ in $(seq 1 120); do curl -sf -m 2 "$1" >/dev/null && return 0; sleep 1; done; echo "timed out waiting for $1" >&2; return 1; }

echo "== chain"
"$ANVIL" --port "$ANVIL_PORT" --silent > "$LOGS/anvil.log" 2>&1 & pids+=($!)
for _ in $(seq 1 30); do curl -sf -m 1 -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' "http://127.0.0.1:$ANVIL_PORT" >/dev/null && break; sleep 0.5; done
(cd "$ROOT/contracts" && DEPLOYMENT_FILE=deployments/e2e.json "$FORGE" script script/Deploy.s.sol --rpc-url "http://127.0.0.1:$ANVIL_PORT" --broadcast > "$LOGS/deploy.log" 2>&1)
MANIFEST="$ROOT/contracts/deployments/e2e.json"

echo "== database"
if [ -n "${E2E_DATABASE_URL:-}" ]; then
  DATABASE_URL="$E2E_DATABASE_URL" # an empty database prepared by the caller (CI)
else
  dropdb --if-exists -h "$PGHOST_DIR" "$DB" && createdb -h "$PGHOST_DIR" "$DB"
  DATABASE_URL="postgres:///$DB?host=$PGHOST_DIR"
fi

echo "== backend"
(cd "$ROOT/backend" && go build -o "$LOGS/cargoflow" ./cmd/cargoflow)
(
  set -a; . "$ROOT/.env.local.example"; set +a
  export DATABASE_URL RPC_URL="http://127.0.0.1:$ANVIL_PORT" DEPLOYMENT_FILE="$MANIFEST" \
    CIRCUITS_DIR="$ROOT/circuits" HTTP_ADDR="127.0.0.1:$API_PORT" CORS_ORIGINS="http://127.0.0.1:$WEB_PORT,http://localhost:$WEB_PORT" \
    LOG_LEVEL=warn GROQ_API_KEY=
  exec "$LOGS/cargoflow" serve
) > "$LOGS/backend.log" 2>&1 & pids+=($!)
wait_for "http://127.0.0.1:$API_PORT/v1/health"

echo "== frontend"
cd "$ROOT/frontend"
export NEXT_PUBLIC_API_URL="http://127.0.0.1:$API_PORT" NEXT_PUBLIC_LOCAL_RPC_URL="http://127.0.0.1:$ANVIL_PORT" NEXT_PUBLIC_E2E=1 NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
pnpm build > "$LOGS/build.log" 2>&1
pnpm start --port "$WEB_PORT" > "$LOGS/web.log" 2>&1 & pids+=($!)
wait_for "http://127.0.0.1:$WEB_PORT/"

echo "== playwright"
E2E_BASE_URL="http://127.0.0.1:$WEB_PORT" E2E_API_URL="$NEXT_PUBLIC_API_URL" pnpm exec playwright test "$@"
