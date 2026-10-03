# syntax=docker/dockerfile:1
# CargoFlow evidence gateway, multi-arch (linux/amd64, linux/arm64 incl. Raspberry Pi 4/5 on a 64-bit OS):
#
#   docker buildx build --platform linux/amd64,linux/arm64 -t cargoflow/gateway:0.1.0 packages/gateway
#   docker run -d --name cargoflow-gateway --restart unless-stopped \
#     -v cargoflow-gateway:/data -v /srv/cargoflow/exports:/exports:ro \
#     cargoflow/gateway:0.1.0 watch /exports
#
# First run (once): put the key file in the volume
#   docker run --rm -v cargoflow-gateway:/data -v "$PWD/key.json":/key.json:ro cargoflow/gateway:0.1.0 init --key /key.json
# Serial loggers: add --device /dev/ttyUSB0 and use `serial /dev/ttyUSB0 --baud 115200`.

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    CARGOFLOW_GATEWAY_HOME=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data && ln -s /app/dist/cli.js /usr/local/bin/cargoflow-gateway && chmod +x /app/dist/cli.js
USER node
VOLUME ["/data"]
ENTRYPOINT ["node", "/app/dist/cli.js", "--log-format", "json"]
CMD ["status", "--offline"]
