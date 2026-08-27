# Kanleaf

Kanleaf is a self-hosted desktop project and task manager built around a simple
idea: structured work belongs in a database, while long-form task notes should
remain normal Markdown files.

Kanleaf v0.1 provides a focused three-pane desktop workflow rather than a web
dashboard. Workspaces and projects live in the navigation pane, task
collections stay compact and searchable, and each task opens beside its
Markdown document.

## Features

- Email/password authentication with Argon2id hashes and hashed server sessions
- Multiple workspaces with personal workspace creation and switching
- Workspace profile, member roles, invitations, ownership, and lifecycle tools
- Configurable task states, labels, task types, and Inbox defaults
- Inbox, projects, task search, Urgent priority, moves, and archiving
- Source Markdown editing with undo/redo, tab indentation, and keyboard save
- Edit, Preview, and Split document modes with safe GitHub-flavored rendering
- Debounced autosave plus an explicit Ctrl/Cmd+S save path and visible state
- PostgreSQL-backed structured data and UUID-addressed filesystem vaults
- Build-time server configuration for local, LAN, or HTTPS deployments
- Docker Compose self-hosting and a Tauri v2 desktop shell

## Architecture at a glance

```text
React + TypeScript (Vite)
          │ HTTPS/HTTP JSON API
          ▼
Rust + Axum + Tokio
     ┌────┴───────────┐
     ▼                ▼
PostgreSQL       Markdown vault
metadata         *.md files
```

The server is the authorization boundary. PostgreSQL stores users, sessions,
memberships, workspaces, projects, and task metadata. A task body is stored only
at `vaults/<workspace-id>/Tasks/<task-id>.md`; renaming a task does not rename or
rewrite its document. See [docs/architecture.md](docs/architecture.md) for the
full boundary and data model.

## Development

Requirements: Rust stable, Node.js 22 or newer, pnpm 11.24.0, PostgreSQL 17,
and the platform packages required by Tauri v2.

From the repository root:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
cargo run --locked -p kanleaf-server
```

In a second terminal, also from the repository root:

```bash
pnpm tauri dev
```

The development client reads `VITE_KANLEAF_SERVER_URL` from the root `.env`
file, verifies `/api/health`, and connects automatically. PostgreSQL setup,
browser-only development, and platform notes are in
[docs/development.md](docs/development.md).

## Tests and quality checks

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test --workspace --all-features --locked

pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The Playwright suite starts temporary Axum and Vite processes and removes its
temporary vault after completion:

```bash
pnpm --filter @kanleaf/desktop exec playwright install chromium
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  pnpm test:e2e
```

## Self-hosting

From `infra/self-host`:

```bash
cp .env.example .env
# Set a strong POSTGRES_PASSWORD and review the data directory.
docker compose up -d --build
docker compose ps
```

The default host data root is `/srv/kanleaf`, containing `postgres/` and
`vaults/`. The deployment exposes port 3000 and intentionally does not bundle a
reverse proxy or TLS manager. Put the server behind the HTTPS setup appropriate
for your environment when exposing it beyond a trusted network.

## License

Kanleaf is licensed under the [GNU Affero General Public License v3.0](LICENSE).
