# Architecture

## System boundary

Kanleaf v0.1 is a small monorepo with two runtime applications:

- `apps/desktop`: React, TypeScript, Vite, and the Tauri v2 boundary;
- `apps/server`: Rust, Axum, Tokio, SQLx, and filesystem vault operations.

`infra/self-host` owns the deployable PostgreSQL and server composition. The
root Cargo and pnpm workspaces contain only packages that exist today.

```text
Desktop UI
   │ bearer-authenticated JSON
   ▼
HTTP handlers ──► domain validation
   │
   ├──► SQLx transactions ──► PostgreSQL
   └──► typed vault paths ──► filesystem
```

The server is deliberately one process. Domain value types do not depend on
Axum, SQLx, Tauri, React, or filesystem implementations. HTTP handlers validate
transport input and coordinate the current use cases; SQL is kept in the
feature module that owns the persistence operation rather than hidden behind a
generic repository framework. A separate application layer should be extracted
only when use-case reuse or complexity makes that boundary concrete.

## Structured data

The ordered migration in `apps/server/migrations` creates:

```text
User ──< Session
  │
  └──< WorkspaceMembership >── Workspace ──< Project
                                      └────< Task
```

- A membership is the workspace tenant and authorization boundary.
- A user has an optional active workspace and may belong to many workspaces.
- A project belongs to exactly one workspace.
- A task belongs to one workspace and optionally one project.
- Inbox is represented by `tasks.project_id IS NULL`.
- Project and task archives are timestamps; archiving a project moves its
  active tasks to Inbox in the same transaction.
- Composite foreign keys prevent a task from referencing a project in another
  workspace. Check constraints enforce normalized email, lengths, roles,
  statuses, priorities, and session hash size.

PostgreSQL is canonical for structured server data. This decision does not
define a future offline cache or sync model.

## Authentication and authorization

Registration normalizes the email, hashes the password with Argon2id, and
atomically creates a user, Personal workspace, owner membership, active
workspace, and session. Login returns a random 32-byte base64url bearer token.
Only its SHA-256 digest is stored in PostgreSQL, so a database read does not
reveal usable sessions.

Every workspace, project, task, and document operation resolves the session and
checks membership on the server. Vault access occurs only after membership and
task ownership checks. API errors use a stable JSON envelope and do not expose
database or filesystem details.

## Markdown vault

Each task has one stable file identity:

```text
KANLEAF_DATA_DIR/
└── vaults/
    └── <workspace UUID>/
        └── Tasks/
            └── <task UUID>.md
```

Paths are constructed internally from parsed UUIDs. The API never accepts an
arbitrary path. Writes use a temporary sibling file followed by rename, and the
server stores the supplied UTF-8 Markdown without frontmatter, formatting, or
whitespace normalization. Task rename and archive leave the file identity and
content unchanged.

Task creation coordinates the database transaction with initial file creation;
the transaction is rolled back if the document cannot be created. Fully atomic
transactions across PostgreSQL and a filesystem are not possible, so startup
reconciliation and conflict-aware sync remain outside v0.1.

## Desktop client

The desktop app is feature-oriented:

- `features/connection` and `features/auth` own local server/session setup;
- `features/workspace` owns tenant navigation and API coordination;
- `features/task` owns collection rows and structured detail editing;
- `features/markdown` owns source editing, preview, and persistence state;
- `lib/api` is the small authenticated JSON transport boundary.

TanStack Query owns remote cache state. Local storage contains only the selected
server URL, current bearer token, and document-view preference. CodeMirror is
lazy-loaded when a document opens. Preview uses `react-markdown` with GFM and
raw HTML disabled; external links receive safe new-window attributes.

The layout is desktop-first with a 900×600 minimum Tauri window: navigation,
collection, and detail panes use subtle separators and strong row selection.
Task detail remains a pane rather than a modal.

## Deployment

The server reads deployment configuration from environment variables, runs
checked-in migrations on startup, and handles SIGINT/SIGTERM gracefully. The
self-host image briefly starts as root to set ownership on a mounted vault, then
executes the server as the unprivileged `kanleaf` user. Compose persists only
PostgreSQL data and vault files under the selected host data root.

## Deferred intentionally

Offline caching and sync, concurrent document conflict resolution, attachments,
member invitation UI, richer RBAC, full-text document indexing, plugins,
real-time collaboration, mobile clients, release signing, and bundled TLS are
not v0.1 concerns.
