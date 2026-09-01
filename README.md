# Kanleaf

Kanleaf is a self-hosted project and task manager with desktop and browser
clients, built around a simple idea: structured work belongs in a database,
while Task notes and Library notes should remain normal Markdown files.

Kanleaf v0.1 provides a focused three-pane desktop workflow rather than a web
dashboard. Workspaces and projects live in the navigation pane, task
collections stay compact and searchable, and each task opens beside its
Markdown document.

## Features

- Email/password authentication with registration password confirmation,
  Argon2id hashes, and hashed server sessions
- Explicit switching between multiple retained accounts on the configured server
- Guided account setup followed by explicit Workspace creation or invitation join
- Multiple Workspaces with globally unique public IDs, clean routed URLs, and
  switching
- Workspace profile, member roles, invitations, ownership, and lifecycle tools
- A deployment-scoped Host Console with Workspace Owner visibility, guarded
  permanent deletion, and optional exact-email access restrictions
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
- Explicit, conflict-aware Vault Sync previews for importing external Task
  property edits through normal Kanleaf validation
- Versioned `.kanleaf` configuration snapshots for Workspace vocabulary,
  Projects, planning, shared Views, portable identities, and member references
- Authorized `.kanleaf.zip` Workspace exports with payload checksums and
  explicit reporting of unmanaged files that were excluded
- Previewed `.kanleaf.zip` imports that restore a new isolated Workspace,
  remap stable IDs, preserve Markdown, and deliberately drop access grants
- PostgreSQL-backed structured data and normal, Obsidian-compatible Markdown
  trees
- Build-time server configuration for local, LAN, or HTTPS Tauri deployments
- A same-origin browser client in the AMD64/ARM64 self-host image
- Docker Compose self-hosting and a Tauri v2 shell

New accounts first review their display name and preferences. Normal accounts
then create a Workspace or accept an invitation; the configured Host may instead
continue directly to Host Console. Registration does not silently create a
Personal Workspace. Account, Workspace, and Project settings use routed overlays,
so their selected section survives refresh and browser history.
Canonical Workspace URLs use the explicit namespace and reviewed public ID, for
example `/w/kanleaf-core/my-work`. Project URLs continue with
`/p/<project-id>`, and open Task details use their short Workspace number, such
as `?task=42`; UUIDs remain internal identities. Workspace switching uses the
compact top control, account switching remains in the navigation footer, and
the top bar keeps global search and notifications available. Press `/` for
collection-local Task search and `C` to create a Task when permitted.

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
Workspace Owner/Admin can export this managed vault as a portable backup. The
archive excludes sessions, credentials, invitations, account preferences,
notifications, comments/activity, `.obsidian`, and unmanaged files.
Any signed-in user can preview and import that archive as a new Workspace they
own. Import verifies paths, file types, size limits, the complete payload
inventory, and SHA-256 checksums before creating database records; member roles
and Task assignees are not restored as permissions.
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
temporary vault after completion. It retains records in the supplied database,
so create and use a disposable `kanleaf_e2e` database:

```bash
pnpm --filter @kanleaf/desktop exec playwright install chromium
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_e2e \
  pnpm test:e2e
```

## Self-hosting

From `infra/self-host`:

```bash
cp .env.example .env
# Set a strong alphanumeric POSTGRES_PASSWORD (it is interpolated into a URL),
# review the data directory, and optionally set KANLEAF_HOST_EMAIL to the account
# that will administer this deployment.
docker compose pull kanleaf
docker compose up -d --no-build
docker compose ps
```

Once the container is healthy, open `http://<pi-address>:3000/`. The same
origin serves both the production browser client and `/api`; no separate web
service or frontend port is required. Existing Tauri clients continue to use
the absolute `VITE_KANLEAF_SERVER_URL` embedded at build time.

The default host data root is `/srv/kanleaf`, containing `postgres/` and
`vaults/`. The default `dev` image at
`ghcr.io/inkveil-games/kanleaf` contains `linux/amd64` and `linux/arm64`
variants, so the same Compose deployment works on x86-64 hosts and a 64-bit
Raspberry Pi 5. Use a release tag in `KANLEAF_IMAGE` when one is available, or
run `docker compose build kanleaf` to build the checked-out source locally.

`KANLEAF_HOST_EMAIL` is optional. When set, sign in or register with that exact
email and open `/host` to view Workspace Owners, permanently delete a Workspace
after two confirmations, or enable Restricted access. Open access remains the
default. Restricted access permits only the configured Host and approved exact
emails to register, sign in, or keep active sessions; Workspace invitations do
not bypass it. Because Kanleaf does not verify email ownership yet, create the
Host account on a trusted network before exposing the deployment.

An existing Pi deployment whose timer only pulls the published image needs one
manual checkout refresh for the new Compose environment mapping. Do not copy
`.env.example` over the existing ignored `.env`:

```bash
cd /path/to/kanleaf
git switch dev
git pull --ff-only origin dev

cd infra/self-host
# Edit the existing .env and add KANLEAF_HOST_EMAIL=<host@example.com>.
docker compose config --quiet
docker compose pull kanleaf
docker compose up -d --no-build --force-recreate kanleaf
docker compose ps
```

The existing image timer can handle later application updates without another
timer change. Rolling back to a Kanleaf binary from before Host Console while
Restricted access is enabled reopens access because that binary does not know
the instance policy; use a Host Console-capable image for rollback.

The deployment exposes port 3000 and intentionally does not bundle a reverse
proxy or TLS manager. Plain HTTP exposes passwords and bearer sessions to the
network, so use it only on a trusted LAN. Do not port-forward it to the
Internet; put Kanleaf behind the HTTPS setup appropriate for your environment.

## License

Kanleaf is licensed under the [GNU Affero General Public License v3.0](LICENSE).
