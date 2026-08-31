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
by `VITE_KANLEAF_SERVER_URL`. Use a complete HTTP/HTTPS URL for these workflows
and restart the client after changing it. The reserved `same-origin` value is
for the production client bundled into the self-host image.

`cargo run` remains API-only by default. To exercise Axum static serving
manually, first run `pnpm build:self-host`, then set
`KANLEAF_WEB_DIR=apps/desktop/dist` before starting the server.

## Configuration

| Variable                   | Development default          | Purpose                                 |
| -------------------------- | ---------------------------- | --------------------------------------- |
| `DATABASE_URL`             | required                     | PostgreSQL connection URL               |
| `KANLEAF_DATA_DIR`         | `./data`                     | Root containing the `vaults/` namespace    |
| `KANLEAF_BIND_ADDRESS`     | `127.0.0.1:3000`             | Server socket address                      |
| `KANLEAF_WEB_DIR`          | unset                        | Optional production browser build root     |
| `KANLEAF_CORS_ORIGINS`     | local Vite and Tauri origins | Comma-separated exact origins              |
| `KANLEAF_SESSION_TTL_DAYS` | `30`                         | Positive session lifetime in days          |
| `RUST_LOG`                 | server and HTTP info         | `tracing` filter                           |
| `VITE_KANLEAF_SERVER_URL`  | required                     | Absolute URL or reserved `same-origin`      |

Deployment/server configuration belongs in environment variables. Application
entities belong in PostgreSQL, client-local preferences in local storage, and
Markdown documents in the vault.

Each Workspace vault also contains server-projected `.kanleaf` JSON. These
files are portable snapshots, not deployment configuration and not a second
write API. External Task YAML changes use the explicit Vault Sync preview;
external `.kanleaf` edits are restored from PostgreSQL by the next projection.
Workspace export artifacts are temporary, authorization-gated files under the
server's internal operation storage and expire automatically.
Workspace import uploads are staged under the same internal namespace, checked
again at apply time, and removed after completion, failure, cancellation, or
expiry. Imports create a new Workspace and never replace an existing vault.

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
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  pnpm test:e2e:self-host
```

## Self-host image verification

From the repository root, this builds the combined server and browser-client
image without modifying source or starting services:

```bash
docker build -f apps/server/Dockerfile -t kanleaf:0.1.0 .
```

Pushes to `dev` and `main` publish a multi-architecture server manifest to
`ghcr.io/inkveil-games/kanleaf`; version tags matching `v*` publish semver tags.
The branch tags are intended for continuous self-host testing, `main` also
publishes `latest`, and immutable `sha-*` tags remain available for rollback.
Both `linux/amd64` and `linux/arm64` are built, covering common x86-64 servers
and 64-bit Raspberry Pi 5 installations. The runtime image contains the Axum
binary and compiled web assets, but not Node or pnpm.

For the full stack, change to `infra/self-host`; copying `.env.example` creates
local deployment configuration in that directory.

```bash
cd infra/self-host
cp .env.example .env
docker compose up -d --build
docker compose ps
docker compose logs -f kanleaf
```

Open `http://<server-address>:3000/` after the application is healthy. To update
a deployment that uses a published image without rebuilding local source:

```bash
docker compose pull kanleaf
docker compose up -d --no-build
```

The browser client and API share that origin and port. Plain HTTP is suitable
only for a trusted LAN because passwords and bearer sessions are not encrypted;
do not expose the port directly to the Internet. Use an HTTPS reverse proxy for
remote access.

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
