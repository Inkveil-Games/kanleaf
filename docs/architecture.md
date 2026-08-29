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
  ├──< Notification
  │
  └──< WorkspaceMembership >── Workspace ──< WorkspaceInvitation
                                      ├────< TaskState
                                      ├────< TaskLabel
                                      ├────< TaskType
                                      ├────< SavedView
                                      ├────< Document
                                      ├────< Project ────< ProjectMembership
                                      │          ├───────< ProjectTaskType
                                      │          ├───────< ProjectCycle
                                      │          └───────< ProjectModule
                                      └────< Task ──< TaskAssignee
                                                ├──< TaskLabelAssignment
                                                ├─── TaskCycleAssignment
                                                ├──< TaskModuleAssignment
                                                ├──< TaskRelation >── Task
                                                ├──< TaskComment ──< CommentRevision
                                                ├──< TaskSubscription
                                                └──< TaskActivity
```

- A membership is the workspace tenant and authorization boundary. Fixed
  Workspace roles are Owner, Admin, Member, and Guest; a partial unique index
  plus transfer transactions keep one Owner.
- A user has an optional active workspace and may belong to many workspaces.
- A project belongs to exactly one workspace. Owner/Admin access is implicit;
  other access uses explicit fixed-role Project memberships. Private projects
  are non-disclosing, while Open projects are discoverable and joinable only by
  Workspace Members.
- States and task types are workspace vocabulary. Each workspace starts with
  one state per semantic group and a protected `Task` type; projects select
  defaults and enabled types from the same tenant.
- A task belongs to one workspace and optionally one project, with required
  state and type references guarded by composite workspace foreign keys.
- Each task receives a monotonic workspace number under a workspace row lock.
  Human references use the current project identifier plus that number, while
  the UUID remains the permanent database and vault identity.
- Assignees must be eligible for the current Inbox or Project, labels remain
  workspace-scoped, and parent Tasks must share the same collection. Canonical
  relation rows prevent duplicate edges and preserve directional blocking.
- Cycles are non-overlapping Project timeboxes and a Task can belong to at most
  one. Modules are Project-scoped thematic groups and Tasks can belong to many.
  Composite keys prevent either planning link from crossing a Project boundary.
- Saved Views keep a validated, versioned task query and one presentation
  layout. Personal names are unique per owner and scope; shared names are
  unique per scope. Project foreign keys and membership ownership keep records
  inside the same tenant.
- Documents keep stable metadata in PostgreSQL and may form ordered trees. A
  parent must share the same Workspace/Project scope; subtree moves validate
  cycles and move every descendant together.
- Task comments store Markdown collaboration records in PostgreSQL, including
  one reply level, structured mentions, immutable prior revisions, and
  tombstone deletion. Activity is a separate append-only product feed, not an
  event-sourcing or compliance-audit mechanism.
- Subscriptions drive in-app notifications for comments and selected Task
  changes. Assignment, mention, reply, and invitation delivery remains enabled;
  each user may mute routine comment or metadata notifications. Only read state
  and preferences are stored—there is no queue or realtime delivery service.
- Inbox is represented by `tasks.project_id IS NULL`.
- Project and task archives are timestamps; archiving a project moves its
  active tasks to Inbox and its Page trees to Workspace Documents in the same
  transaction. A Project move either rejects
  incompatible type, assignment, and hierarchy data or removes it only when
  the client explicitly requests cleanup.
- Composite foreign keys prevent projects and tasks from referencing another
  workspace's configuration. Configuration edits and assignments coordinate on
  the workspace row so archiving cannot race a new task assignment. Check
  constraints enforce normalized email, lengths, roles, semantic state groups,
  priorities, colors, and session hash size.

PostgreSQL is canonical for structured server data. This decision does not
define a future offline cache or sync model.

## Authentication and authorization

Registration normalizes the email, hashes the password with Argon2id, and
atomically creates a user, Personal workspace, owner membership, active
workspace, and session. Login returns a random 32-byte base64url bearer token.
Only its SHA-256 digest is stored in PostgreSQL, so a database read does not
reveal usable sessions.

Account profile and display preferences are server-synchronized. Timezone
updates are validated against the IANA database before persistence. Password
changes require the current password and atomically revoke every other session;
users can also inspect session creation/expiry times and revoke sessions without
exposing token hashes.

Every workspace, project, task, and document operation resolves the session and
checks effective access on the server. Project roles distinguish management,
editing, commenting, and read-only access; task and vault operations inherit
that boundary. Vault access occurs only while the authorized task identity is
held by a database lock. API errors use a stable JSON envelope and do not expose
database or filesystem details.

Comment creation requires Inbox content access or Project Commenter and above.
Only authors edit their comments; authors, Project Admin, and Workspace
Owner/Admin may delete them. Mention candidates are computed after Task access
is resolved. Notification queries re-check current Task access so a removed
member cannot use an old notification to discover content.

The task collection endpoint accepts only a versioned, typed JSON query. All
filter values are bound SQL parameters; ordering, grouping, and filter columns
come from closed Rust enums. Saved Views can be Personal or Shared. Workspace
Owner/Admin manage shared workspace Views; Project Contributors can create and
edit their own shared Project Views, while Project Admin manages all shared
Views in the Project.

Workspace invitations contain normalized target emails, seven-day expiry, and
only SHA-256 token digests. Owner/Admin can issue, renew, or revoke invitations;
acceptance verifies the authenticated account email in the same transaction as
membership creation. Owner/Admin manage Workspace settings and members, while
only Owner can transfer ownership or delete the Workspace. Guest access to
project content requires an explicit Project role. Workspace Members may
discover and join Open projects as Contributors; Private projects are not
disclosed without effective access.

## Markdown vault

Tasks and Pages have distinct typed file identities:

```text
KANLEAF_DATA_DIR/
└── vaults/
    └── <workspace UUID>/
        ├── Tasks/<task UUID>.md
        └── Pages/<document UUID>.md
```

Paths are constructed internally from parsed UUIDs. The API never accepts an
arbitrary path. Writes use a temporary sibling file followed by rename, and the
server stores the supplied UTF-8 Markdown without frontmatter, formatting, or
whitespace normalization. Task/Page title, hierarchy, scope, and archive
changes leave the file identity and content unchanged.

Reads return source plus a SHA-256 content revision. A write must include the
revision it opened; if the current file differs, the server returns a stable
conflict response and leaves both the external file and client source
untouched.

Task and Page creation coordinate the database transaction with initial file creation;
the transaction is rolled back if the document cannot be created. Fully atomic
transactions across PostgreSQL and a filesystem are not possible, so startup
reconciliation remains outside v0.1.

Permanent Task/Page deletion uses the same trash-first boundary: the document is
renamed before the database commit, restored if the transaction fails, and
purged only after the Task becomes unreachable. A purge failure is logged and
leaves internal trash for operator cleanup instead of encouraging an unsafe
client retry.

Confirmed Workspace deletion first renames its typed vault to an internal trash
namespace. A database failure restores that directory; a successful commit
makes the Workspace unreachable before the server purges trash. Cleanup failure
is logged for an operator and never exposes the internal path through the API.

## Desktop client

The desktop app is feature-oriented:

- `lib/config` validates build-time client configuration, while `features/auth`
  owns the local session;
- `features/workspace` owns tenant navigation and API coordination;
- `features/task-config` owns workspace states, labels, types, and defaults;
- `features/task` owns keyboard-selectable collection rows, bulk actions, My
  Work, and structured detail editing;
- `features/view` owns the typed collection query, Personal/Shared View API,
  presentation controls, and List, Board, Calendar, Table, and Timeline
  layouts;
- `features/collaboration` owns the merged Task feed, comments, subscriptions,
  notification inbox, and account notification preferences;
- `features/document` owns Workspace Documents and Project Pages trees,
  hierarchy, ordering, scope moves, and archive interaction;
- `features/markdown` owns the shared Task/Page source editor, preview,
  revision conflict recovery, and persistence state;
- `lib/api` is the small authenticated JSON transport boundary.

TanStack Query owns remote cache state. Vite embeds the server URL from
`VITE_KANLEAF_SERVER_URL`, and the app verifies its health automatically before
authentication. Local storage contains only the current bearer token and
document-view preference. CodeMirror is lazy-loaded when a document opens.
Preview uses `react-markdown` with GFM and raw HTML disabled; external links
receive safe new-window attributes.

Temporary filters, grouping, sorting, and layout changes stay in React state.
Saving a View sends the same typed query used by the task endpoint to
PostgreSQL; the client does not maintain a second filter representation. Board,
Calendar, and Timeline changes use normal task update endpoints, so the same
server authorization applies to direct edits and drag operations.

The layout is desktop-first with a 900×600 minimum Tauri window. A compact top
bar owns Workspace switching and global notifications; navigation, collection,
and detail panes use subtle separators and strong row selection beneath it.
Account and Workspace settings are separate floating windows, and task detail
remains a pane rather than a modal. Task detail switches between structured
Details and chronological Activity without losing its pane context. The top-bar
inbox refreshes on focus and every 60 seconds; it does not require WebSockets.

## Deployment

The server reads deployment configuration from environment variables, runs
checked-in migrations on startup, and handles SIGINT/SIGTERM gracefully. The
self-host image briefly starts as root to set ownership on a mounted vault, then
executes the server as the unprivileged `kanleaf` user. Compose persists only
PostgreSQL data and vault files under the selected host data root.

## Deferred intentionally

Offline caching and sync, automatic conflict merging or version history, attachments,
full-text document indexing, plugins, real-time collaboration, mobile clients,
release signing, and bundled TLS are not current implementation concerns.
