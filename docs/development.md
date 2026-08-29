# Development

Commands below assume the working directory is the repository root unless a
different directory is stated.

## Prerequisites

- Rust stable with `rustfmt` and `clippy`
- Node.js 22 or newer
- pnpm 11.24.0
- PostgreSQL 17
- Tauri v2 platform prerequisites for native desktop development
- Docker and Docker Compose for the documented container workflows

## Initial setup

Install JavaScript dependencies in the current repository:

```bash
pnpm install --frozen-lockfile
```

Start a disposable development PostgreSQL container. This creates a Docker
container named `kanleaf-postgres-dev` and publishes only loopback port 5432:

```bash
docker run --rm --name kanleaf-postgres-dev \
  -e POSTGRES_USER=kanleaf \
  -e POSTGRES_PASSWORD=kanleaf_dev \
  -e POSTGRES_DB=kanleaf \
  -p 127.0.0.1:5432:5432 \
  postgres:17-alpine
```

Copy `.env.example` to `.env` in the repository root. The server reads its
variables from this file in development, and Vite embeds variables prefixed
with `VITE_` into the desktop client. `.env` is ignored by Git.

```bash
cp .env.example .env
```

## Running Kanleaf

Start the server from the repository root. It creates `KANLEAF_DATA_DIR` if
needed and runs migrations before listening:

```bash
cargo run --locked -p kanleaf-server
```

Start the native desktop client from a second root terminal:

```bash
pnpm tauri dev
```

For browser-only UI work, use `pnpm dev` instead. It serves the existing desktop
frontend at `http://127.0.0.1:1420` without creating another project directory.
The browser and Tauri clients automatically verify and use the server configured
by `VITE_KANLEAF_SERVER_URL`. Restart the client after changing it.

## Configuration

| Variable                   | Development default          | Purpose                                 |
| -------------------------- | ---------------------------- | --------------------------------------- |
| `DATABASE_URL`             | required                     | PostgreSQL connection URL               |
| `KANLEAF_DATA_DIR`         | `./data`                     | Root containing the `vaults/` namespace |
| `KANLEAF_BIND_ADDRESS`     | `127.0.0.1:3000`             | Server socket address                   |
| `KANLEAF_CORS_ORIGINS`     | local Vite and Tauri origins | Comma-separated exact origins           |
| `KANLEAF_SESSION_TTL_DAYS` | `30`                         | Positive session lifetime in days       |
| `RUST_LOG`                 | server and HTTP info         | `tracing` filter                        |
| `VITE_KANLEAF_SERVER_URL`  | required                     | Server URL embedded into the client     |

Deployment/server configuration belongs in environment variables. Application
entities belong in PostgreSQL, client-local preferences in local storage, and
Markdown documents in the vault.

## Verification

Backend unit tests do not require PostgreSQL. `--all-features` enables isolated
SQLx database tests; the configured PostgreSQL user must be allowed to create
temporary databases.

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --locked
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test --workspace --all-features --locked
```

Frontend checks:

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm tauri build --no-bundle
```

Install the pinned browser once, then run the real-service E2E suite. Playwright
starts Axum and Vite itself, uses a temporary vault, and cleans it up afterward.
The suite covers durable Task and Library Markdown, Live Preview block/source
transitions, portable Library trees, collaboration notifications, read state,
and cross-workspace Task/activity/document isolation.

```bash
pnpm --filter @kanleaf/desktop exec playwright install chromium
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  pnpm test:e2e
```

## Self-host image verification

From the repository root, this builds the server image without modifying source
or starting services:

```bash
docker build -f apps/server/Dockerfile -t kanleaf:0.1.0 .
```

For the full stack, change to `infra/self-host`; copying `.env.example` creates
local deployment configuration in that directory.

```bash
cd infra/self-host
cp .env.example .env
docker compose up -d --build
docker compose ps
docker compose logs -f kanleaf
```

Use an alphanumeric PostgreSQL password in the provided URL-based Compose
configuration, or percent-encode URL-reserved characters.

## Troubleshooting

- A server health failure usually means `VITE_KANLEAF_SERVER_URL` is wrong or
  `/api/health` is unreachable from the desktop machine.
- Browser CORS failures require the exact Vite origin in
  `KANLEAF_CORS_ORIGINS`; do not use a wildcard with bearer sessions.
- A server startup failure before listening usually identifies PostgreSQL,
  migration, bind-address, or data-directory context in its error chain.
- Linux Tauri build failures generally indicate missing WebKitGTK/system
  packages rather than a frontend TypeScript failure.
