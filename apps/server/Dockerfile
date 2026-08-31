FROM node:22-bookworm-slim AS web-builder

WORKDIR /build
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/desktop/package.json apps/desktop/package.json
RUN pnpm install --frozen-lockfile
COPY apps/desktop apps/desktop
RUN pnpm --filter @kanleaf/desktop build:self-host

FROM rust:1.90-bookworm AS builder

WORKDIR /build
COPY . .
RUN cargo build --locked --release -p kanleaf-server

FROM debian:bookworm-slim AS runtime

RUN export DEBIAN_FRONTEND=noninteractive \
    && apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl gosu \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system kanleaf \
    && useradd --system --gid kanleaf --home-dir /data kanleaf \
    && install --directory --owner kanleaf --group kanleaf /data

COPY --from=builder /build/target/release/kanleaf-server /usr/local/bin/kanleaf-server
COPY --from=web-builder /build/apps/desktop/dist /usr/share/kanleaf
COPY apps/server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh

ENV KANLEAF_DATA_DIR=/data \
    KANLEAF_BIND_ADDRESS=0.0.0.0:3000 \
    KANLEAF_WEB_DIR=/usr/share/kanleaf \
    RUST_LOG=kanleaf_server=info,tower_http=info

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
    CMD curl --fail --silent http://127.0.0.1:3000/api/health >/dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
