# Kanleaf

Kanleaf is a self-hosted desktop project and task manager built around a simple
idea: structured work belongs in a database, while Task notes and Library notes should
remain normal Markdown files.

Kanleaf v0.1 provides a focused three-pane desktop workflow rather than a web
dashboard. Workspaces and projects live in the navigation pane, task
collections stay compact and searchable, and each task opens beside its
Markdown document.

## Features

- Email/password authentication with Argon2id hashes and hashed server sessions
- Explicit switching between multiple retained accounts on the configured server
- Multiple workspaces with personal workspace creation and switching
- Workspace profile, member roles, invitations, ownership, and lifecycle tools
- Project overview, visibility, membership roles, defaults, and feature controls
- Configurable task states, labels, task types, and Inbox defaults
- Inbox, My Work, projects, task search, readable references, and bulk updates
- Ctrl/Cmd+K command palette for authorized Task, Project, Library, settings,
  and navigation search
- Resizable device-local pane widths, collapsible navigation, and focused
  Task/Library detail views at narrow desktop widths
- Typed filters, grouping, sorting, Personal/Shared Views, and List, Board,
  Calendar, Table, and Timeline layouts
- Task assignees, labels, scheduling, estimates, hierarchy, and relations
- Project Cycles and Modules with progress, leads, completion, and work transfer
- Markdown comments, one-level replies, mentions, edit history, and moderation
- Task activity, watch subscriptions, and a role-aware notification inbox
- Account notification preferences with unread filtering and read state
- A Workspace Markdown Library with Project-filtered views, portable filenames,
  ordered trees, independent collapse controls, keyboard navigation, and
  subtree moves
- Safe project moves, stable row ordering, archiving, and confirmed deletion
- Source-faithful Live Preview that reveals Markdown syntax only in the active
  block, with undo/redo, task-marker editing, and tab indentation
- Live, Source, Reading, and Split modes with safe GitHub-flavored rendering
- Debounced autosave plus an explicit Ctrl/Cmd+S save path and visible state
- SHA-256 revision checks that preserve local Markdown when an external editor
  changes the vault file
- Durable metadata projection jobs that preserve custom YAML and retry after
  temporary vault failures
- PostgreSQL-backed structured data and normal, Obsidian-compatible Markdown
  trees
- Build-time server configuration for local, LAN, or HTTPS deployments
- AMD64/ARM64 server images, Docker Compose self-hosting, and a Tauri v2 shell

Account and Workspace settings have separate focused windows, while Project
settings use their own project-scoped window. Workspace and account switching
stay at the top and bottom of the navigation pane; the full-width top bar keeps
global search and notifications available. Press `/` for collection-local Task
search and `C` to create a Task when the current collection permits it.

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
memberships, workspaces, projects, task metadata, and document-tree metadata.
Workspace Inbox Markdown stays under `Todo/`; each Project has independent
`Projects/<stable-name>/Todo/` and `Wiki/` roots, while Workspace Library notes
live under the top-level `Wiki/`. Task files contain Obsidian-compatible YAML
properties plus source-faithful Markdown bodies. Stable storage names keep Task
and Project renames from breaking paths; Wiki reparenting moves the note and its
complete companion subtree.
See
[docs/architecture.md](docs/architecture.md) for the full boundary and data
model.

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
docker compose pull kanleaf
docker compose up -d
docker compose ps
```

The default host data root is `/srv/kanleaf`, containing `postgres/` and
`vaults/`. The default `dev` image at
`ghcr.io/inkveil-games/kanleaf` contains `linux/amd64` and `linux/arm64`
variants, so the same Compose deployment works on x86-64 hosts and a 64-bit
Raspberry Pi 5. Use a release tag in `KANLEAF_IMAGE` when one is available, or
run `docker compose build kanleaf` to build the checked-out source locally.

The deployment exposes port 3000 and intentionally does not bundle a reverse
proxy or TLS manager. Put the server behind the HTTPS setup appropriate for
your environment when exposing it beyond a trusted network.

## License

Kanleaf is licensed under the [GNU Affero General Public License v3.0](LICENSE).
