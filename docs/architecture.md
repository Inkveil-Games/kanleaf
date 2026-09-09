# Architecture

## System boundary

Kanleaf v0.1 is a small monorepo with two runtime applications:

- `apps/desktop`: React, TypeScript, Vite, and the Tauri v2 boundary;
- `apps/server`: Rust, Axum, Tokio, SQLx, and filesystem vault operations.

`infra/self-host` owns the deployable PostgreSQL and server composition. The
root Cargo and pnpm workspaces contain only packages that exist today.

```text
React UI (Tauri or browser)
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
  ├──< PasswordResetToken
  ├──< Notification
  │
  └──< WorkspaceMembership >── Workspace ──< WorkspaceInvitation
                                      ├────< TaskState
                                      ├────< TaskLabel
                                      ├────< TaskType
                                      ├────< CustomProperty ──< PropertyOption
                                      ├────< SavedView
                                      ├────< Document
                                      ├────< Project ────< ProjectMembership
                                      │          ├───────< ProjectTaskType
                                      │          ├───────< ProjectCycle
                                      │          └───────< ProjectModule
                                      └────< Task ──< TaskAssignee
                                                ├──< TaskLabelAssignment
                                                ├──< TaskPropertyValue
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
- A singleton instance settings row stores whether access is Open or
  Restricted. A separate normalized exact-email table stores approved
  addresses before or after account creation. This deployment policy is not
  Workspace configuration and never enters portable projections or exports.
- A user has a server-owned setup stage, an optional active Workspace, and may
  belong to many Workspaces. Registration does not imply membership.
- Workspace names are display labels and may repeat. Each live Workspace instead
  has an immutable, globally unique public identifier for URLs. Its registry row
  is created in the same transaction as the Workspace and removed only when
  permanent deletion commits, so archive and failed deletion retain the
  reservation while a successfully deleted identifier may be used again. The
  top-level route names `api`, `assets`, `forgot-password`, `host`, `reset-password`,
  `setup`, and `w` stay reserved; the Workspace UUID remains the database, API
  authorization, and vault identity.
- A project belongs to exactly one workspace. Its immutable lowercase public
  identifier is unique among active and archived Projects in that Workspace;
  permanent deletion frees it for reuse. Owner/Admin access is implicit; other
  access uses explicit fixed-role Project memberships. Private projects are
  non-disclosing, while Public projects are discoverable and joinable only by
  Workspace Members.
- States and task types are workspace vocabulary. Each workspace starts with
  one state per semantic group and a protected `Task` type; projects select
  defaults and enabled types from the same tenant.
- Custom property definitions and select options use stable UUIDs and remain
  Workspace-scoped. Task values reference those identities and are validated
  against the definition type and option ownership at the server boundary.
  Active and archived definitions reserve names case-insensitively; permanent
  deletion removes values and releases the name for reuse.
- A task belongs to one workspace and optionally one project, with required
  state and type references guarded by composite workspace foreign keys.
- Each task receives a monotonic workspace number under a workspace row lock.
  Human references use that number as `#<number>` without reuse, while the UUID
  remains the permanent database and vault identity.
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
- Library notes keep stable IDs, titles, portable storage names, hierarchy, and
  ordering in PostgreSQL. A parent must share the same Workspace/Project scope;
  subtree moves validate cycles and move every descendant together. Workspace
  notes live under `Wiki/`; Project notes live under the owning
  `Projects/<stable-name>/Wiki/` tree.
- Task comments store Markdown collaboration records in PostgreSQL, including
  one reply level, structured mentions, immutable prior revisions, and
  tombstone deletion. Activity is a compact product feed, not an event-sourcing
  or compliance-audit mechanism. Immediately consecutive events with the same
  Task, actor, type, and payload coalesce within a rolling one-minute window;
  comments and different events break that sequence.
- Subscriptions drive in-app notifications for comments and selected Task
  changes. Assignment, mention, reply, and invitation delivery remains enabled;
  each user may mute routine comment or metadata notifications. Only read state
  and preferences are stored—there is no queue or realtime delivery service.
- Inbox is represented by `tasks.project_id IS NULL`.
- Project and Task archives are timestamps. Archiving a Project is reversible:
  it retains Tasks, documents, Views, planning data, memberships, configuration,
  storage names, and Markdown in place while removing the Project from active
  queries. A Project move either rejects incompatible type, assignment, and
  hierarchy data or removes it only when the client explicitly requests
  cleanup.
- Composite foreign keys prevent projects and tasks from referencing another
  workspace's configuration. Configuration edits and assignments coordinate on
  the workspace row so archiving cannot race a new task assignment. Check
  constraints enforce normalized email, lengths, roles, semantic state groups,
  priorities, colors, and session hash size.

PostgreSQL is canonical for structured server data. This decision does not
define a future offline cache or sync model.

## Authentication and authorization

Registration normalizes the email, hashes the password with Argon2id, and
atomically creates only a user and session. The server-owned setup stage then
requires account details before a normal user creates a first Workspace or
accepts an invitation; invitation setup is optional after creation. The
configured Host may complete setup without joining a Workspace so instance
administration cannot deadlock. Login returns a random 32-byte base64url bearer
token. Only its SHA-256 digest is stored in PostgreSQL, so a database read does
not reveal usable sessions.

Password recovery uses a random 32-byte base64url secret delivered in the
`/reset-password#token=…` fragment. PostgreSQL stores only its SHA-256 digest;
the link expires after 30 minutes, is single-use, and a new request supersedes
older links after a per-account cooldown. Forgot-password responses do not
distinguish unknown accounts, disabled SMTP, cooldown, or delivery failure.
Resetting a password reuses the Argon2id password path and atomically revokes
every session for that user. The browser keeps reset and invitation secrets only
in route/component memory.

An optional normalized `KANLEAF_HOST_EMAIL` identifies one deployment Host.
The derived `is_host` response flag is never stored as an account role. Host
API handlers authorize that identity again on the server. Their metadata
allowlist is Workspace UUID, name, identifier, and creation time plus Owner UUID,
display name, and email. They may also invoke the narrow permanent
Workspace-deletion use case only after exact-ID confirmation and Host password
verification. Host status does not grant Workspace membership or access to Tasks,
Library documents, Markdown contents, or filesystem paths.

Instance access is Open by default. In Restricted mode, registration, valid
credential login, and bearer-session extraction require either an approved
exact normalized email or the configured Host email. Policy replacement locks
the singleton settings row, replaces the approved list, and revokes sessions
for newly disallowed users in one transaction. Invalid credentials remain a
generic authentication failure, while an otherwise valid but disallowed
registration or login receives the dedicated `access_restricted` response.
Workspace invitations do not bypass this instance policy.

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

Tasks and Library notes have distinct typed file identities:

```text
KANLEAF_DATA_DIR/
└── vaults/
    └── <workspace UUID>/
        ├── Todo/<task storage name>.md
        ├── Wiki/
            ├── getting_started.md
            └── getting_started/
                └── installation.md
        └── Projects/
            └── <project storage name>/
                ├── Todo/<task storage name>.md
                └── Wiki/architecture.md
```

Task and Project paths use immutable, validated storage names derived from their
initial title plus a short stable-ID suffix. Library paths use validated segments
resolved from the authorized PostgreSQL tree. These typed identities select the
Workspace or Project scope internally; the API never accepts an arbitrary path.
A Wiki note's file and same-stem companion directory represent one tree node.
Writes use a temporary sibling file followed by rename.

Task files contain canonical Obsidian-compatible YAML properties followed by the
user's source-faithful Markdown body. Structured metadata remains canonical in
PostgreSQL; Kanleaf patches only its owned property keys and preserves unknown
properties, comments, body formatting, and whitespace. Task document endpoints
expose only the body and projection health. Their SHA-256 revision covers the
body alone, so a Kanleaf metadata projection does not create a false editing
conflict. A body write rereads the latest complete file, replaces only its body,
and still uses a complete-file revision for the final atomic filesystem write.

Workspace-defined custom properties project beside the system fields as direct
top-level YAML keys using their display names; select values project as option
names for readable Obsidian properties while PostgreSQL keeps option UUIDs.
Unknown top-level fields remain untouched and are exposed as raw undefined
properties. Defining one is an explicit admin action that validates every
matching raw value, checks source revisions, stores typed values, and only then
claims the field for normal projection. Text definition stringifies a non-string
raw value instead of silently inferring a richer type.

Every structured metadata mutation increments a per-Task version and coalesces
one projection job in the same PostgreSQL transaction. After commit, the
request attempts the atomic YAML patch immediately. A bounded Tokio worker
retries temporary failures, and startup drains jobs left by a crash before the
HTTP listener is opened. Vocabulary, Project, Cycle, Module, hierarchy, and
membership changes fan out through the same queue. A failed metadata-only
projection does not roll back canonical PostgreSQL state or overwrite invalid
external YAML; the stored health state makes that divergence explicit.

Workspace Owner/Admin can explicitly preview external Task-property changes
with Vault Sync. The server scans only the Workspace and known Project `Todo`
roots, rejects symlinked or untyped entries, and matches files by `Kanleaf ID`.
The durable preview records both the complete-file SHA-256 revision and Task
metadata version. Apply first rechecks every selected item, then invokes the
same Task update use case used by HTTP so Project access, vocabulary,
assignment, hierarchy, planning, and typed move rules cannot be bypassed.
Unknown, duplicate, missing, manually moved, malformed, and invalid files stay
visible as non-applicable results. Preview operations are actor/Workspace
scoped and expire without deleting Markdown.

Portable Workspace configuration is projected into versioned JSON below
`.kanleaf/`. PostgreSQL triggers increment one coalescing Workspace version in
the same transaction as changes to Workspace metadata, membership references,
Projects, Task vocabulary, custom property definitions/options, planning,
shared Views, Tasks, or Library identity.
A startup/periodic worker writes `workspace.json`, `task-config.json`,
`views.json`, `projects/<project-id>.json`, then publishes `manifest.json` last
as the snapshot commit marker. User profile changes fan out only display
references; account preferences, sessions, invitations, notifications, and
comment/activity history never mark or enter portable configuration.

Workspace export is an actor-scoped, expiring server operation available to
current Owner/Admin roles. It drains Task and config projections, inventories
only database-known Markdown and JSON paths, hashes each payload, writes a ZIP
artifact in internal operation storage, then verifies file and database
versions again before publication. The archive manifest is the root of trust
and checksums every other entry. Symlinks, `.obsidian`, temporary, and
unmanaged files are not followed or copied and are reported in the operation
result. Download authorization is checked again, and startup plus a bounded
cleanup worker remove interrupted or expired artifacts.

Workspace import is always a copy, never an in-place overwrite. A signed-in
user uploads one archive into typed internal staging, receives a durable
preview with counts and explicit identity omissions, then applies that exact
revision. Preview rejects path traversal, links and special files, duplicate or
unmanaged entries, decompression-limit violations, unsupported schemas,
checksum drift, invalid configuration relationships, and structured values
that would violate current domain rules. Apply revalidates the staged bytes,
creates a new Workspace owned only by the importer, remaps every database and
Task YAML identity, clears Task assignees, and remaps shared View filters.
Source member/Project-role references remain descriptive archive data and never
become authorization grants. Comments, activity, invitations, notifications,
sessions, and account preferences are intentionally absent.

The importer writes remapped Task files in staging before activating the vault
with a directory rename and committing SQL. A failed database commit moves the
vault back. Startup recovery removes orphaned activated vaults, completes an
operation when both committed data and its vault exist, fails interrupted
previews, and cleans expired staging. A committed Workspace without its vault
stops startup instead of silently accepting data loss.

Later Task or Project title edits do not rename files. A Task scope change moves
its stable basename between `Todo` roots. Wiki reparenting or scope changes move
both `<name>.md` and `<name>/`, preserving descendants and authored content.
Manually authored links are not rewritten during a move; link-aware renames and
backlinks are a later capability. No `.obsidian` directory is created or
required.

Library reads return source plus a complete-file SHA-256 revision. Task reads
return a revision of the user-authored body while preserving the latest YAML
properties during a write. A write must include the revision it opened; if its
owned content differs, the server returns a stable conflict response and leaves
both the external file and client source untouched.

Task and Library-note creation coordinate the database transaction with initial
file creation; the transaction is rolled back if the document cannot be
created. Task, Wiki, and Project-scope moves use durable manifests plus reverse
compensation when the SQL transaction fails. Startup also migrates legacy
`Tasks`/`Library` layouts through a verified sibling staging directory and keeps
the previous Workspace directory as a timestamped recovery copy. Fully atomic
transactions across PostgreSQL and a filesystem are not
possible. Library move, delete, and legacy migration operations therefore write
recovery manifests under `KANLEAF_DATA_DIR/operations`; startup reconciles them
against PostgreSQL before binding the HTTP listener.

Permanent Task/Library deletion uses the same trash-first boundary: the document is
renamed before the database commit, restored if the transaction fails, and
purged only after its record becomes unreachable. A purge failure is logged and
leaves internal trash for operator cleanup instead of encouraging an unsafe
client retry.

Permanent Project deletion stages the complete Project vault below the persisted
`vaults/.trash` tree before deleting its relational footprint. A database failure
restores the staged directory; after commit, request handling or startup recovery
finishes the purge. Project-owned Tasks, documents, Views, planning records,
memberships, configuration, and Markdown are removed together. Cross-Project
hierarchy pointers are cleared and projected before their surviving Task records
return to a steady state.

Confirmed Workspace deletion first records a durable manifest and renames its
typed UUID vault beneath `vaults/.trash`, on the same persisted mount. A
database failure or an interrupted pre-commit operation restores that directory;
a rename-synchronization failure also compensates immediately before the request
returns. Once committed, startup recovery or the request purges the vault,
Workspace-scoped migration recovery copies (`<uuid>.legacy-*` and
`.<uuid>.v2-staging.*`),
Workspace Task trash, structural operation manifests, and known export artifacts;
a successful commit retires the public identifier and makes all relational data
unreachable first. The manifest and rename directory entries are synchronized
before the database commit. An export holds a shared Workspace-row fence through
artifact publication, while deletion holds the exclusive row lock. Canceling a
preparing export leaves a hidden durable database marker until its worker, or
startup recovery after a crash, has removed any late-published artifact. Periodic
expiry similarly preserves `preparing` and `canceled` rows because a live worker
may still publish against their staging key; it cleans bounded stable `(id,
staging_key)` batches and never follows with a broad re-evaluated delete. Export
publication synchronizes both the ZIP and its `operations/` directory before the
`ready` transition, and every unlink synchronizes that directory before its last
database recovery marker is removed.
Cleanup failure leaves the deletion manifest queued for recovery and never
exposes an internal path through the API. Workspace Owner and Host deletion share
this cross-store use case; Owner authority is rechecked under the deletion lock,
while the Host endpoint reauthorizes Host identity, the exact Workspace
identifier, and the current Host password. Both endpoints verify Argon2 before
opening the deletion transaction, then lock and compare the current stored hash
to the verified snapshot before any vault mutation so a concurrent password
change invalidates the request.

## Desktop client

The desktop app is feature-oriented:

- `app/routing` owns the React Router boundary, authenticated route tree, and
  canonical URL builders; it does not fetch application data;
- `lib/config` validates build-time client configuration, while `features/auth`
  owns a versioned account-session registry scoped to the normalized server URL;
- `features/workspace` owns tenant navigation and API coordination;
- `features/command` composes authorized Task queries, cached Library metadata,
  Project titles, and navigation actions into the global command palette;
- `features/task-config` owns workspace states, labels, types, and defaults;
- `features/task` owns keyboard-selectable collection rows, bulk actions, My
  Work, and structured detail editing;
- `features/view` owns the typed collection query, Personal/Shared View API,
  presentation controls, and List, Board, Calendar, Table, and Timeline
  layouts;
- `features/collaboration` owns the merged Task feed, comments, subscriptions,
  notification inbox, and account notification preferences;
- `features/host` owns the deployment Host's metadata-only Workspace list,
  guarded deletion action, and instance access policy surface;
- `features/document` owns the Workspace Library and Project-filtered Library
  trees, hierarchy, ordering, scope moves, and archive interaction;
- `features/markdown` owns the shared Task/Library source editor, Live Preview,
  reading renderer, revision conflict recovery, and persistence state;
- `lib/api` is the small authenticated JSON transport boundary.

React Router owns durable application location: Host Console sections,
Workspace and Project surfaces, Saved Views, selected Tasks/documents/planning
items, and Settings sections. `features/workspace` converts each matched route
to a typed location and reconciles it only after the owning TanStack Query data
can prove access or absence. Loading and transient API failures retain the URL.
TanStack Query remains the sole owner of remote cache state; routes do not use
loaders or duplicate API state.

Workspace browser routes use `/w/<workspace-id>`. Project routes continue with
`/p/<project-id>`, and an open Task detail uses its Workspace number in
`?task=<number>`. The route boundary resolves those public identities through
authorized Workspace, Project, and Task reads before exposing UUID-only typed
locations to feature code. Compatibility routes for previous Workspace,
Project, and Task UUID locations redirect only when that account can resolve
the resource and preserve the remaining path, query, and hash. The server-owned
account setup stage similarly owns `/setup/account`, `/setup/workspace`, and
`/setup/invite`; a refresh cannot skip or rewind those steps through client-only
state.

Vite embeds the server URL from
`VITE_KANLEAF_SERVER_URL`, and the app verifies its health automatically before
authentication. Tauri and development builds use an absolute HTTP/HTTPS URL;
the published browser build uses the reserved `same-origin` value, resolved to
the page origin at runtime. Local storage contains the bearer-token account
registry and device preferences, never passwords; the registry is versioned
and isolated by normalized server URL. Identity transitions first flush
pending Markdown, validate the selected session, and clear account-scoped query
data before committing the new identity. CodeMirror is lazy-loaded when a
document opens.
Live Preview is a CodeMirror state field over the GFM syntax tree: the active
logical block stays raw, inactive inline syntax receives decorations, and
multiline tables, fences, rules, and HTML blocks use atomic replacement
widgets. Decorations never rewrite the editor state. The same
`react-markdown` renderer backs replacement blocks and Reading/Split views,
with raw HTML disabled and safe new-window attributes on external links.

Temporary filters, grouping, sorting, and layout changes stay in React state;
the Task query parameter identifies only the open detail pane. Saving a View
sends the same typed query used by the task endpoint to
PostgreSQL; the client does not maintain a second filter representation. Board,
Calendar, and Timeline changes use normal task update endpoints, so the same
server authorization applies to direct edits and drag operations.

The layout is desktop-first with a 960×640 minimum Tauri window. A compact top
bar owns Workspace switching and global notifications. Navigation, collection,
and detail panes use keyboard-accessible resize separators, keep their widths
on the device, and switch to focused detail navigation when the window narrows.
Account, Workspace, and Project Settings are routed overlays, and task detail
remains a pane rather than a modal. Closing a Settings overlay returns to its
validated background route without adding another history entry. Task detail switches between structured
Details and chronological Activity without losing its pane context. The top-bar
inbox refreshes on focus and every 60 seconds; it does not require WebSockets.
Host Console is a full-page Settings surface at `/host` and `/host/access`.
Workspace invitation links open the exact public `/invite#token=…` route before
authentication and setup routing. The fragment survives inline sign-in or
registration without local storage, preview does not consume the invitation,
and joining still requires an explicit action. Canonical Workspace routes stay
under `/w/:workspaceIdentifier`, so `/invite` does not reserve or collide with
the valid `/w/invite` Workspace URL.

Forgot- and reset-password screens are public routes handled beside invitations
before the authentication gate. The optional reset return destination accepts
only the exact internal `/invite#token=…` shape and remains in the URL fragment,
so external, protocol-relative, and arbitrary internal redirects are rejected.

`BrowserRouter` preserves clean direct links, refresh, and browser Back/Forward
navigation for both Host and Workspace routes.

## Deployment

The server reads deployment configuration from environment variables, runs
checked-in migrations on startup, and handles SIGINT/SIGTERM gracefully.
`KANLEAF_HOST_EMAIL` is optional: blank leaves Host Console disabled, a valid
value is normalized into application state, and an invalid non-empty value
fails startup. Access policy changes themselves are PostgreSQL state and need
no container restart.

SMTP is an optional Rust-only adapter shared by Workspace invitations and
password recovery. A blank `KANLEAF_SMTP_HOST` creates a disabled mailer; a
non-empty host requires complete validated transport, sender, and public-origin
configuration before startup continues. Token digests commit before delivery;
delivery failures never return a raw password-reset token or disclose account
existence. Direct URLs use `KANLEAF_PUBLIC_URL` and keep raw secrets in the
fragment; credentials and transport details never cross the HTTP boundary.

Without `KANLEAF_WEB_DIR` it remains an API-only process. When that variable
points to a validated Vite build, Axum serves static assets and SPA navigation
outside `/api`; unknown API routes remain structured JSON 404 responses.

The self-host image builds the React client with
`VITE_KANLEAF_SERVER_URL=same-origin`, copies only its production assets into
the Rust runtime image, and configures `KANLEAF_WEB_DIR=/usr/share/kanleaf`.
Node and pnpm are build-stage tools and are absent at runtime. The image briefly
starts as root to set ownership on a mounted vault, then executes the server as
the unprivileged `kanleaf` user. Compose exposes one application service and
port. Its current bind mounts persist PostgreSQL and `vaults/`;
Workspace-deletion manifests and trash are therefore deliberately stored under
`/data/vaults/.trash`. Other recovery state under `/data/operations` and
`/data/trash` remains container-local. A rename between the vault bind mount and
those container-local paths can still cross a mount boundary, so the topology
does not yet satisfy every import or structural trash assumption. Resolving the
remaining gap requires a migration-compatible persistence layout and runtime
container test; Compose parsing and local one-directory tests do not prove it.

## Deferred intentionally

Offline caching and sync, automatic conflict merging or version history, attachments,
full-text document indexing, wikilink resolution, backlinks/graph views, explicit
file renames, plugins, real-time collaboration, mobile clients,
release signing, and bundled TLS are not current implementation concerns.
