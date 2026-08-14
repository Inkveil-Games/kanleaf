FROM rust:1.97.0-bookworm AS builder

WORKDIR /build

COPY Cargo.toml Cargo.lock ./
COPY migrations ./migrations
COPY src ./src

RUN cargo build --locked --release

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/target/release/kanleaf-backend /usr/local/bin/kanleaf-backend

ENV BACKEND_ADDRESS=0.0.0.0:3000

EXPOSE 3000

USER 10001:10001

ENTRYPOINT ["kanleaf-backend"]
