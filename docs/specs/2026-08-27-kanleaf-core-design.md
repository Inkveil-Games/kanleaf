# Kanleaf Core design

Status: approved for implementation on 2026-08-27.

## Purpose

Kanleaf Core expands the current project and task workflow into a coherent,
self-hosted planning application without turning the codebase into a generic
project-management engine. Structured collaboration data remains in
PostgreSQL. Task bodies and durable documents remain ordinary Markdown files in
the workspace vault.

The design favors explicit domain tables, fixed roles, typed authorization
policies, and vertical delivery. It does not introduce microservices, a generic
RBAC engine, arbitrary custom fields, or a realtime collaboration stack.

## Scope

Kanleaf Core includes:

- account profile, preferences, password, and session management;
- workspace invitations, members, fixed roles, ownership transfer, and
  lifecycle settings;
- project visibility, membership, fixed project roles, defaults, and feature
  settings;
- configurable states, labels, and task types shared by a workspace;
- expanded task metadata, hierarchy, relations, cycles, and modules;
- personal and shared saved views with list, board, calendar, table, and
  timeline layouts;
- task comments, activity, subscriptions, and in-app notifications;
- workspace documents and project pages backed by Markdown files;
- a CodeMirror-based Markdown Live Preview experience;
- a redesigned desktop shell, settings areas, command palette, and keyboard
  navigation.

The phase excludes Intake, arbitrary custom fields, custom roles, automations,
AI, billing, SSO, enterprise audit/compliance, integrations, public publishing,
email or push delivery, API token management, import/export, attachments,
reactions, realtime co-editing, document version history, backlinks, and
full-text Markdown indexing.

## Identity, sessions, and account settings

Authentication keeps normalized email addresses, Argon2id password hashes,
random bearer tokens, and SHA-256 session-token hashes. Email remains read-only
until an email verification flow exists.

Profile settings contain a required display name and generated monogram avatar.
No upload pipeline is added. Server-synchronized preferences contain:

- theme: system, light, or dark;
- IANA timezone, initially detected from the operating system;
- Monday or Sunday as the first day of the week;
- locale, ISO, day-first, or month-first date formatting.

Changing a password requires the current password and revokes every other
session. The security screen lists session creation and expiry times, marks the
current session, and permits revoking one session or all other sessions. Core
does not include password-reset email, two-factor authentication, account
deactivation, localization, or configurable keyboard shortcuts.

## Workspace authorization and membership

Every workspace has exactly one Owner. Workspace roles are fixed:

- **Owner** has complete control and is the only role that can transfer
  ownership or delete the workspace.
- **Admin** manages workspace settings, configuration, invitations, members,
  and all projects.
- **Member** can work only in projects they join or are explicitly assigned to,
  apart from workspace-level Inbox access allowed by product policies.
- **Guest** can access only explicitly assigned projects.

Owner and Admin receive implicit Project Admin access to every project; no
duplicate project membership is stored for that access. Admin cannot change or
remove Owner. A workspace has one Owner enforced by database constraints and
application transactions.

Ownership transfer targets an existing Admin. In one transaction the target
becomes Owner and the former Owner becomes Admin. Owner cannot leave until
ownership has been transferred. Other roles may leave, but a user may not leave
their final accessible workspace. Removing or leaving a workspace removes the
user from project memberships and task assignments without deleting tasks or
their authorship history.

### Invitations

Owner and Admin invite a normalized email address with a workspace role. An
invitation has a hashed random token, inviter, target email, role, created time,
seven-day expiry, and accepted, declined, or revoked state.

Existing users receive an in-app invitation and can accept or decline it.
Registration with the matching normalized email reveals any pending
invitations. Admin can renew an invitation by issuing a new token and expiry or
revoke it. Core does not depend on SMTP; the invitation link can be copied for
manual delivery. A future email adapter must not require a schema redesign.

## Workspace settings and lifecycle

Workspace settings are organized as General, Members and Invitations, States,
Labels, Task Types, Notifications, and Danger Zone.

General settings contain the name, generated monogram and accent, and default
Inbox state and task type. Dates are stored in UTC or as explicit calendar dates
and rendered using account preferences. Core does not add a workspace slug
because desktop routing and authorization use stable UUIDs.

Workspace deletion requires Owner, the exact workspace name, and current
password confirmation. The server atomically renames the typed workspace vault
into an internal trash namespace before deleting relational data in a database
transaction. A failed transaction restores the vault. After commit, trash is
removed; a failed cleanup may leave an unreachable internal orphan for an
operator to remove. The API never accepts or returns these paths. Core does not
offer workspace restore after confirmed deletion.

## Project model and authorization

A project belongs to one workspace and has one workspace-unique identifier.
Project visibility is fixed:

- **Private** is the default and permits only project members plus workspace
  Owner and Admin.
- **Open** lets workspace Members discover the project and join as Contributor.
  Workspace Guests still require explicit membership.

Project roles are fixed:

- **Admin** manages project settings, membership, features, and content.
- **Contributor** creates and edits work items, cycles, modules, pages, and
  shared views.
- **Commenter** reads and comments.
- **Viewer** is read-only.

A Workspace Guest cannot be made Project Admin. Workspace Owner and Admin
remain implicit Project Admin and cannot be modified from project membership
settings.

Project settings contain name, identifier, description, lead, visibility,
default assignee, state and task type, feature toggles, archive, and confirmed
deletion. Lead must be a Project Admin or an implicit workspace administrator.
Cycles, Modules, Pages, and Saved Views can be disabled independently. Disabling
a feature hides it and prevents new records without deleting existing data.
Core has no public internet project visibility.

## Task configuration

States, labels, and task types belong to the workspace so Inbox and projects use
one coherent vocabulary.

### States

A state has a name, color, position, and semantic group: Backlog, Todo, In
Progress, Done, or Canceled. Names are unique within a workspace. Default
workspaces begin with one state in each semantic group. Projects select a
default state; Inbox uses the workspace default.

### Labels

Labels have a workspace-unique name, color, description, and archive state.
Tasks may have many labels. Archiving a label preserves existing assignments
but prevents new ones.

### Task types

Task types have a workspace-unique name, icon, color, description, position, and
archive state. Every workspace has a non-removable default `Task` type. Projects
select which types are enabled and one default type. Examples such as Bug,
Feature, or Story are configuration, not hard-coded behavior.

Core intentionally does not provide arbitrary custom fields or a configurable
workflow engine.

## Task model

A task belongs directly to one workspace and optionally one project. A null
project remains the Inbox representation. Structured fields are:

- title, state, task type, and fixed priority: None, Low, Medium, High, Urgent;
- zero or more assignees and labels;
- optional start and due dates;
- optional non-negative estimate;
- optional parent task and ordered subtasks;
- optional cycle and zero or more modules;
- blocking, blocked-by, relates-to, and duplicate relations;
- stable ordering and archive timestamps.

Task relations and parents must stay inside one workspace. Project task
assignees must be members of that project or implicit project administrators.
Inbox assignees may be any workspace member. A task may move between Inbox and
projects only when its assignees, type, cycle, modules, and parent remain valid;
the use case either clears invalid planning links with explicit confirmation or
rejects the move rather than silently corrupting them.

The task body is never added to PostgreSQL. It remains
`vaults/<workspace-id>/Tasks/<task-id>.md`, and changing a title does not rename
the file.

## Cycles and modules

Cycles are project-scoped timeboxes with a name, description, start date, due
date, and archive timestamp. Upcoming, active, and completed status is derived
from dates. Cycles in one project do not overlap. A task belongs to at most one
cycle. Completing a cycle can transfer incomplete tasks to a selected future
cycle or leave them unassigned. Progress is available by task count and
estimate. Core does not include parallel cycles, automatic scheduling, or
burndown analytics.

Modules are project-scoped thematic groups with a name, description, lead,
start and due dates, archive timestamp, and fixed status: Backlog, Planned, In
Progress, Paused, Completed, or Canceled. A task may belong to many modules.
Module detail reuses the view engine and shows count and estimate progress.

Project Admin manages cycles and modules. Contributor creates and edits them;
Commenter and Viewer can read them. Project feature toggles govern creation and
navigation without deleting data.

## Query and view engine

One typed query model powers Inbox, My Work, workspace, project, cycle, and
module task collections. It supports:

- filters for state and semantic group, type, priority, assignee, label,
  project, cycle, module, dates, estimate, and unassigned values;
- primary and secondary grouping;
- stable sorting;
- visible property selection;
- including or excluding completed tasks;
- list, board, calendar, table, and timeline layout.

The server parses and validates a versioned JSON representation into Rust types;
clients cannot submit SQL or an expression language. Temporary query state is
client-local. A saved view persists the validated configuration in PostgreSQL
and is either Personal or Shared. Contributors and above can create shared
project views. Project Admin can edit or delete shared views created by others.
There are no public views.

Layout behavior is deliberately consistent:

- **List** is dense, supports hierarchy, keyboard selection, and manual order.
- **Board** groups into compact columns; drag changes the grouped property and
  order.
- **Calendar** places tasks by due date and lets permitted users change dates by
  dragging.
- **Table** supports inline editing, keyboard movement, selection, and bulk
  actions.
- **Timeline** draws start-to-due bars and supports moving, resizing, and task
  dependencies, but no critical-path or resource-leveling calculations.

Core search uses PostgreSQL task, project, and document titles plus structured
metadata. Markdown content is neither copied into PostgreSQL nor indexed by a
new search service in this phase.

## Comments, activity, subscriptions, and notifications

Task comments are Markdown source stored in PostgreSQL because they are
collaboration records, not durable documents. Raw HTML is disabled during
rendering. Comments support one reply level, member mentions, author edits, an
edited timestamp, revision history, and tombstone deletion. Authors can edit
and delete their own comments; Project Admin and workspace Owner/Admin can
moderate. Mention suggestions contain only users authorized to access the task.

Activity is an immutable structured record separate from comments. It covers
task creation and changes to state, type, priority, assignees, labels, dates,
cycle, modules, hierarchy, and relations. Document updates produce a coarse
`document_updated` record without storing body content; repeated saves by the
same actor and task within a short window do not add duplicate activity rows.
The UI merges comments and activity chronologically. This is not event-sourcing
or an enterprise audit log.

Creating, being assigned, being mentioned, or commenting automatically
subscribes a user to a task. Users can watch or unwatch manually. Removing an
assignee does not silently unsubscribe them.

In-app notifications cover invitations, assignments, mentions, comments and
replies, state changes, and selected metadata changes. The actor never receives
a notification for their own action. Users can mark one or all notifications
read and filter unread items. Comment and metadata notifications can be muted;
invitations, assignments, and mentions remain enabled. The desktop refreshes on
focus and polls at a restrained interval. Core adds no WebSocket, queue, email,
push, or due-date scheduler.

## Documents and Markdown vault

Documents belong to one workspace, optionally belong to a project, and may have
an ordered parent in the same workspace and project scope. PostgreSQL stores
their stable ID, title, scope, parent, position, and archive timestamp. Domain
validation prevents parent cycles.

Document content is stored at:

```text
KANLEAF_DATA_DIR/
└── vaults/
    └── <workspace-id>/
        ├── Tasks/<task-id>.md
        └── Pages/<document-id>.md
```

The workspace navigation calls the complete collection Documents. Project-
scoped documents appear as Pages within their project. Users can create,
rename, reorder, nest, move, and archive documents subject to project access.
Moving a document with children moves the whole subtree only when every target
scope invariant remains valid. Title and hierarchy changes never rename or
rewrite Markdown files.

Vault paths are constructed only from parsed typed IDs after authorization. The
API never exposes an arbitrary file path. Writes preserve the supplied UTF-8
source without frontmatter, formatting, heading changes, or whitespace
normalization.

### Saving and conflicts

Task and document reads return content plus a revision hash derived from the
current file. Saves include the base revision. A changed external file produces
HTTP 409 instead of being overwritten. The client keeps the local text and
offers reload or copy actions; Core does not attempt collaborative merging.

Autosave runs after roughly 800 milliseconds of inactivity. Ctrl+S or Cmd+S
saves immediately. The editor exposes Unsaved, Saving, Saved, Conflict, and
Error states. Server writes use a temporary sibling followed by rename.

### Live Preview

CodeMirror 6 remains the source editor. A Kanleaf extension reads the Markdown
syntax tree and uses mark, widget, and replacement decorations to present
rendered content without converting the underlying source to a rich-text
document.

Live Preview is the default mode. Markdown syntax is visible only in the logical
block containing the selection. For headings, paragraphs, list items, and
quotes, that generally means the active line. Fenced code, tables, and nested
multiline constructs reveal their whole block to keep cursor, selection,
undo/redo, and copy behavior reliable. Clicking a rendered block focuses and
reveals its source.

Source mode exposes all Markdown. Reading mode renders the complete document.
Split mode places source and rendered preview side by side. Reading and widget
rendering use the same GitHub-flavored Markdown behavior, keep raw HTML disabled,
and apply safe external-link attributes.

## Desktop information architecture

The normal shell remains three-pane and desktop-first:

```text
Workspace navigation | Active collection or tree | Task or document detail
```

The navigation pane contains workspace switching, Search, Inbox, My Work,
Notifications, Projects, Saved Views, Documents, and Settings. A project exposes
Overview, Work Items, Cycles, Modules, Pages, and Settings according to enabled
features and authorization.

The collection header contains breadcrumb, title, quick create, layout, filter,
group, sort, and visible-field controls. Bulk actions appear only with a
selection. Opening a task uses the resizable detail pane rather than a modal.
Task title and compact metadata are directly editable; Markdown is the primary
content. Details contains secondary metadata and relations. Activity merges
comments and structured changes.

Settings use a dedicated content layout rather than nested modals:

- Account: Profile, Preferences, Security, Notifications;
- Workspace: General, Members, States, Labels, Task Types, Danger Zone;
- Project: General, Members, Features, Defaults, Danger Zone.

Menus, popovers, and destructive confirmations use accessible primitives. Real
buttons, labels, visible focus, strong selection, and keyboard ordering are
required. Core shortcuts include command/search on Ctrl/Cmd+K, contextual task
creation on C, navigation with arrows or J/K, opening with Enter, closing or
going back with Escape, and Markdown save on Ctrl/Cmd+S.

The shell uses compact rows, panes, restrained colors, small radii, subtle
separators, and shadows only for floating surfaces. State and priority colors
are accents rather than oversized pills. Loading appears as row-shaped
skeletons, and empty or error states have one clear next action.

At wide widths all three panes remain visible. The navigation collapses first
as the window narrows. At the minimum supported window, detail becomes a normal
content view with a Back action rather than a modal. Pane widths are a
device-local preference; theme and date preferences are server-synchronized.
The Tauri minimum is raised to approximately 960 by 640 pixels after visual
verification.

The server URL remains deployment/build configuration through
`VITE_KANLEAF_SERVER_URL`; it is validated against `/api/health` automatically
and does not return to application settings.

## Server structure and data boundaries

The implementation stays in the existing server and desktop applications. No
speculative shared crate is introduced. Server feature modules own their domain
rules, SQL, thin HTTP handlers, and focused tests. Common typed authorization
helpers may be extracted only after repeated policies become concrete.

PostgreSQL uses typed tables, foreign keys, composite tenant constraints,
partial uniqueness where required, and transactions for multi-entity
invariants. Task metadata does not use EAV. Saved-view query configuration is
versioned JSONB because it is an explicitly validated configuration document,
not arbitrary task data. Activity payloads are limited by event type and are
not a generic event store.

Every workspace-scoped request resolves the session and workspace role. Project
visibility and effective role are checked before entity access. Task and vault
operations then verify task scope. Authorization is repeated server-side even
when the UI hides an action.

Notifications are written in the transaction that produces the source change
when practical. Filesystem and PostgreSQL cannot share one transaction; typed
rename/rollback protocols are used only for operations such as workspace
deletion where both stores must change.

## Migration and delivery strategy

Existing installations are upgraded by ordered additive migrations rather than
resetting the database. The expected capability sequence is:

1. workspace roles, invitations, profile, preferences, and sessions;
2. states, labels, and task types;
3. project settings and memberships;
4. expanded task metadata and relations;
5. cycles and modules;
6. saved views and layouts;
7. comments, activity, subscriptions, and notifications;
8. documents and conflict-aware vault operations;
9. Live Preview and the complete desktop information architecture.

Migration boundaries may be combined when PostgreSQL requires one atomic data
transition, but each migration remains ordered and focused. Existing owner and
member roles map directly. Every workspace receives default states and the
default Task type. Existing Todo, In Progress, and Done tasks point to matching
new states. Existing projects become Private. Existing task Markdown paths and
content remain unchanged.

Each vertical slice includes migration and domain behavior, persistence and
transaction tests, HTTP authorization tests, React behavior, relevant E2E
coverage, docs updates, and a focused Conventional Commit. The repository must
remain runnable between capability commits.

## Verification and acceptance

In addition to existing formatting, lint, typecheck, build, and unit checks,
Core must verify:

- workspace and project role matrices, tenant isolation, invitation expiry,
  ownership transfer, and member removal;
- default configuration migration and state/type/label constraints;
- task movement, assignment, hierarchy, relation, cycle, and module invariants;
- saved-view validation and equivalent filters across every layout;
- comment moderation, mention visibility, subscription, and notification rules;
- typed vault paths, atomic writes, external-edit conflict handling, document
  hierarchy, and workspace deletion rollback;
- Live Preview cursor, undo/redo, source fidelity, keyboard save, and safe
  rendering for every supported Markdown construct;
- desktop keyboard navigation, role-aware controls, narrow-window behavior,
  loading, error, empty, and long-content states.

The end-to-end workflow covers registration, account preferences, workspace
invitation and switching, project membership, task configuration, project and
Inbox tasks, cycles/modules, saved layouts, comments/notifications, documents,
Live Preview, persistence across reload, and isolation from another workspace.

Kanleaf Core is complete only when the full verification suite passes, the UI
has been visually reviewed at representative window sizes and both themes, the
working tree is clean, and architecture and development documentation describe
the implemented—not merely planned—behavior.
