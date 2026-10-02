# CargoFlow backend image: the Go service plus the Node/snarkjs prover it shells out to.
# Build from the repository root:  docker build -f infra/docker/backend.Dockerfile -t cargoflow-backend .

# --- 1. the Go binary (static, no cgo)
FROM golang:1.24-alpine AS gobuild
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/cargoflow ./cmd/cargoflow

# --- 2. the circuit: compile to wasm at build time so the runtime image needs no circom
FROM node:22-bookworm-slim AS circuits
ARG CIRCOM_VERSION=2.2.3
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -sSfL -o /usr/local/bin/circom \
       "https://github.com/iden3/circom/releases/download/v${CIRCOM_VERSION}/circom-linux-amd64" \
    && chmod +x /usr/local/bin/circom \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /circuits
COPY circuits/package.json circuits/package-lock.json ./
RUN npm ci
COPY circuits/ ./
RUN node scripts/compile.js
# keep only what proving needs at runtime
RUN npm prune --omit=dev

# --- 3. runtime
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin cargoflow
WORKDIR /app
COPY --from=gobuild /out/cargoflow /app/cargoflow
COPY --from=circuits --chown=10001:10001 /circuits /app/circuits
# the public testnet deployment, so DEPLOYMENT_FILE=/app/deployments/robinhood-testnet.json works out of the box
COPY contracts/deployments/robinhood-testnet.json /app/deployments/robinhood-testnet.json
USER 10001:10001
ENV CIRCUITS_DIR=/app/circuits HTTP_ADDR=:8080 LOG_LEVEL=info
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/v1/health >/dev/null || exit 1
ENTRYPOINT ["/app/cargoflow"]
CMD ["serve"]
