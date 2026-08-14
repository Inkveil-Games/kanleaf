# Kanleaf Workspace Domain

This document defines the current workspace model and architectural direction for Kanleaf.

It should be treated as product/domain context when implementing workspace, project, task, permissions, views, storage, or collaboration features.

The model is intentionally designed so Kanleaf can begin as a mostly personal application while remaining extensible toward team collaboration.

Do not implement every concept described here immediately.

---

# 1. Core idea

A Kanleaf Workspace is **not merely a UI layout or a collection of shortcuts**.

A Workspace represents the main:

* data boundary
* collaboration boundary
* permission boundary
* project namespace
* storage/vault namespace

Conceptually:

```text
User
  │
  │ many-to-many
  ▼
WorkspaceMembership
  │
  ▼
Workspace
  ├── Projects
  ├── Tasks
  ├── Views
  ├── Labels
  ├── Members
  ├── Settings
  └── Vault
```

A user may belong to multiple workspaces.

A workspace may contain multiple users.

---

# 2. User ↔ Workspace relationship

The relationship between `User` and `Workspace` is many-to-many.

Do not model a workspace as:

```text
Workspace {
    user_id
}
```

in a way that permanently assumes one workspace belongs to one user.

Instead, model membership explicitly.

Conceptually:

```rust
struct Workspace {
    id: WorkspaceId,
    name: String,
    created_at: DateTime,
    updated_at: DateTime,
}
```

```rust
struct WorkspaceMembership {
    workspace_id: WorkspaceId,
    user_id: UserId,
    role: WorkspaceRole,
}
```

Initial roles may conceptually be:

```rust
enum WorkspaceRole {
    Owner,
    Admin,
    Member,
}
```

However, the first implementation does not need to support all permission behavior yet.

For the first version, only `Owner` behavior may be required.

---

# 3. Example

A user may belong to several workspaces:

```text
Quang
├── Personal
│   └── Owner
│
├── Kanleaf
│   └── Owner
│
└── Inkveil Games
    └── Member
```

A workspace may contain several users:

```text
Kanleaf

Members
├── Quang    Owner
├── Linda    Admin
└── Alex     Member
```

The same users collaborate on the projects contained inside that workspace.

---

# 4. Personal Workspace

When a new account is created, Kanleaf should automatically create a default workspace.

Example:

```text
Register
   ↓
Create User
   ↓
Create Workspace
   name = "Personal"
   ↓
Create WorkspaceMembership
   role = Owner
   ↓
Open Personal Workspace
```

The user should not be forced through a workspace creation wizard immediately after registration.

The Personal workspace should use the same domain model as any other workspace.

Avoid creating separate concepts such as:

```text
PersonalProject
PersonalTask
UserProject
```

Personal data should simply exist inside the user's default workspace.

Whether Personal workspaces can later invite members is a product decision and does not need to be implemented now.

---

# 5. Workspace → Project relationship

The relationship is:

```text
Workspace 1 ──────── N Project
```

Each project belongs to exactly one workspace.

Conceptually:

```rust
struct Project {
    id: ProjectId,
    workspace_id: WorkspaceId,
    name: String,
    created_at: DateTime,
    updated_at: DateTime,
}
```

Do not implement:

```text
Workspace N ──────── N Project
```

A project should not simultaneously belong to multiple workspaces.

This keeps the following boundaries clear:

* permissions
* members
* labels
* views
* storage
* vault ownership
* task ownership
* future synchronization

If a project must later move between workspaces, implement a move operation rather than multiple workspace ownership.

---

# 6. Project ownership

Projects are owned by the Workspace, not directly by a User.

Avoid treating:

```rust
owner_id: UserId
```

as the fundamental ownership relation of a project.

The primary ownership relation is:

```rust
workspace_id: WorkspaceId
```

A Project may still contain fields such as:

```rust
created_by: UserId
lead_id: Option<UserId>
```

but their meaning is different.

```text
workspace_id
→ data / permission ownership

created_by
→ who originally created the project

lead_id
→ person responsible for the project
```

Do not conflate these concepts.

---

# 7. User ↔ Project relationship

Users normally gain access to projects through workspace membership.

Primary access path:

```text
User
  ↓
WorkspaceMembership
  ↓
Workspace
  ↓
Project
```

Do not initially add a mandatory many-to-many relation:

```text
User ── ProjectMembership ── Project
```

unless project-specific permissions are actually required.

A future `ProjectMembership` may be introduced if Kanleaf later supports functionality such as:

* private projects inside a workspace
* project-specific membership
* project-specific roles
* restricted teams

For now, do not implement this prematurely.

---

# 8. Tasks

Tasks belong to a Workspace.

A task may optionally belong to a Project.

Conceptually:

```rust
struct Task {
    id: TaskId,

    workspace_id: WorkspaceId,
    project_id: Option<ProjectId>,

    title: String,

    created_by: UserId,
    assignee_id: Option<UserId>,

    created_at: DateTime,
    updated_at: DateTime,
}
```

This allows tasks to exist without first being organized into a project.

Example:

```text
Workspace
├── Inbox
│   ├── Task A
│   ├── Task B
│   └── Task C
│
└── Projects
    ├── Kanleaf
    └── Website
```

An Inbox task may later be moved into a project.

This is intentional.

Do not require every task to have a `project_id`.

---

# 9. Task ownership vs assignment

A task is not owned by its assignee.

These concepts are different:

```text
workspace_id
→ data boundary

project_id
→ optional organizational context

created_by
→ author

assignee
→ person responsible for doing the task
```

Future multi-assignee support may use:

```text
Task
  │
  └── TaskAssignee
           │
           └── User
```

Do not implement this until it is required.

An `Option<UserId>` assignee is sufficient for an initial implementation if assignment is needed at all.

---

# 10. Workspace Views

A View is a saved way of querying and presenting workspace data.

Examples:

```text
My Tasks
High Priority
This Week
Bugs
Recently Updated
Active Sprint
```

Views should not be confused with the Workspace itself.

The Workspace contains data.

A View describes how some of that data should be displayed.

Possible scopes include:

```rust
enum ViewScope {
    Workspace,
    Project,
}
```

A future conceptual model may look similar to:

```rust
struct View {
    id: ViewId,

    workspace_id: WorkspaceId,
    project_id: Option<ProjectId>,

    owner_user_id: Option<UserId>,

    name: String,
    definition: ViewDefinition,
}
```

The exact schema is not fixed yet.

---

# 11. Shared vs Personal Views

Views may eventually have two categories.

## Shared views

Owned or shared through the workspace.

Examples:

```text
Active Sprint
All Bugs
Upcoming Releases
```

These may be visible to all workspace members.

## Personal views

Owned by an individual user.

Examples:

```text
My High Priority
Things I Need to Review
My Current Work
```

Personal views must not require modifying the shared workspace configuration for every other member.

Do not implement the complete view system during the initial workspace milestone.

---

# 12. User-specific workspace preferences

Workspace data and user interface preferences are different concerns.

Do not store every user's UI preferences directly on `Workspace`.

Examples of user-specific preferences:

* sidebar collapsed state
* sidebar width
* selected view
* pinned projects
* sorting preference
* task-list density
* pane widths
* recently opened project
* default view

These should conceptually belong to a relation such as:

```rust
struct UserWorkspacePreference {
    user_id: UserId,
    workspace_id: WorkspaceId,

    // Future fields
}
```

This allows two users to share the same Workspace while using different UI layouts.

Do not implement this model until there is an actual preference that needs persistence.

---

# 13. Vault relationship

The Markdown vault should conceptually belong to a Workspace.

```text
Workspace
├── structured application data
└── Markdown vault
```

For example:

```text
Workspace: Kanleaf

Projects
Tasks
Views
Members

Vault
└── Markdown documents associated with this workspace
```

The exact filesystem layout is not finalized.

A possible conceptual layout is:

```text
KanleafData/
└── workspaces/
    ├── <workspace-id>/
    │   ├── tasks/
    │   └── attachments/
    │
    └── <workspace-id>/
        ├── tasks/
        └── attachments/
```

Do not use workspace display names as permanent identifiers.

For example:

```text
display name:
Kanleaf

stable identity:
workspace_01...
```

Renaming:

```text
Kanleaf
↓
Kanleaf OSS
```

must not invalidate internal references.

---

## 13.1 Structured server persistence

The initial self-hosted Kanleaf server uses one PostgreSQL database as the
canonical store for structured server data.

```text
Kanleaf server
    ↓
PostgreSQL
    ├── Users
    ├── WorkspaceMemberships
    ├── Workspaces
    └── Projects
```

Do not create one database per Workspace. Workspace IDs and memberships provide
the logical tenant, permission, and data boundaries within the server database.

This decision does not define the future local/offline architecture. SQLite may
still be considered later as a local cache, and sync behavior requires separate
design work. PostgreSQL does not replace the Markdown vault: vault content
remains a distinct, filesystem-oriented concern.

---

# 14. Workspace UI philosophy

Do not treat the workspace homepage as a generic SaaS dashboard.

Avoid:

```text
Welcome back!

[12 tasks] [3 projects] [7 completed]

Recent Projects
[card] [card] [card]
```

Kanleaf should open directly into a productive workspace.

The intended initial workspace shell is conceptually a three-pane desktop layout:

```text
┌─────────────────┬────────────────────────┬──────────────────────────────┐
│ Navigation      │ Task collection        │ Task / Markdown document     │
│                 │                        │                              │
│ Workspace       │ Inbox                  │ Task title                   │
│ Inbox           │ Task A                 │ Metadata                     │
│ My Tasks        │ Task B                 │                              │
│                 │ Task C                 │ Markdown content             │
│ Projects        │                        │                              │
│  Kanleaf        │                        │                              │
│  Website        │                        │                              │
│                 │                        │                              │
│ Views           │                        │                              │
└─────────────────┴────────────────────────┴──────────────────────────────┘
```

Kanleaf should feel like a desktop productivity workspace rather than a website dashboard.

---

# 15. Workspace switcher

Users may belong to multiple workspaces.

Workspace switching should therefore be available from the main application shell.

Conceptually:

```text
Kanleaf ▼

Personal
Kanleaf              ✓
Inkveil Games

──────────────
+ New Workspace
Workspace Settings
```

Changing workspace changes the active data boundary.

It should not merely change a visual filter over globally shared projects.

---

# 16. Domain invariants

The following principles should be preserved unless there is a strong architectural reason to change them.

## Invariant 1

`User ↔ Workspace` is many-to-many through `WorkspaceMembership`.

```text
User
  │
WorkspaceMembership
  │
Workspace
```

## Invariant 2

A Workspace may contain multiple Projects.

A Project belongs to exactly one Workspace.

```text
Workspace 1 ───── N Project
```

## Invariant 3

A Project is owned by the Workspace rather than directly by an individual User.

## Invariant 4

A Task belongs directly to a Workspace.

A Task may optionally belong to a Project.

## Invariant 5

Workspace UI preferences belonging to a particular user must not be confused with shared Workspace state.

## Invariant 6

Workspace should be treated as a future collaboration and security boundary, not merely as a folder or UI grouping.

---

# 17. Current implementation scope

The current Kanleaf implementation already has basic login and registration behavior.

The initial self-hosted server persistence target is PostgreSQL. Until that
migration is complete, the current backend still stores authentication and
workspace state in memory.

The next milestone should focus on validating the Workspace model without prematurely implementing collaboration.

Implement:

```text
User
Workspace
WorkspaceMembership
```

Initially, only the minimum behavior is necessary.

Recommended first flow:

```text
Register
   ↓
Create User
   ↓
Automatically create Personal Workspace
   ↓
Create owner WorkspaceMembership
   ↓
Open Workspace Shell
```

Then support:

```text
List user's workspaces
Switch workspace
Create workspace
Rename workspace
Delete workspace
```

Deletion semantics may remain simple while persistence is still in memory.

---

# 18. Do not implement yet

The first Workspace implementation should NOT automatically introduce all future collaboration functionality.

Do not implement yet unless explicitly requested:

* invitations
* email invitations
* complex permission checks
* workspace billing
* organizations
* teams
* private projects
* project memberships
* advanced RBAC
* guest users
* workspace quotas
* presence
* real-time collaboration
* audit logs
* workspace-wide activity feeds
* advanced saved views
* synchronized vaults

Design the domain so these features are possible later, but do not create unused architecture for them now.

---

# 19. Recommended implementation order

Starting from the current authentication implementation:

```text
1. Workspace domain
        ↓
2. WorkspaceMembership domain
        ↓
3. Auto-create Personal Workspace on registration
        ↓
4. Resolve current workspace after login
        ↓
5. Workspace shell UI
        ↓
6. Workspace switcher
        ↓
7. Basic workspace CRUD
        ↓
8. Project domain
        ↓
9. Project CRUD
        ↓
10. Task domain
        ↓
11. Inbox / task list
        ↓
12. Task detail
        ↓
13. Markdown document integration
        ↓
14. Persistence / database integration
        ↓
15. Collaboration and permissions when required
```

Persistence may be moved earlier if implementation needs justify it, but domain boundaries should not be designed around a specific database schema prematurely.

---

# 20. Immediate vertical slice

The next useful Kanleaf milestone should be:

```text
Register
  ↓
Personal Workspace automatically exists
  ↓
Workspace shell opens
  ↓
User can create another workspace
  ↓
Workspace switcher lists both
  ↓
User can switch between them
```

After this works:

```text
Workspace
  ↓
Create Project
  ↓
Project appears in sidebar
  ↓
Switch workspace
  ↓
Only projects from the active workspace are shown
```

This is the first important proof that Workspace is functioning as a real data boundary.

---

# 21. Implementation guidance for Codex

Before implementing Workspace:

1. Inspect the existing authentication/domain architecture.
2. Reuse the project's existing conventions.
3. Do not rewrite authentication simply to accommodate Workspace.
4. Keep Workspace logic independent of Dioxus/Tauri where practical.
5. Keep UI code separate from domain state.
6. Do not introduce database abstractions until persistence is actually being implemented.
7. Preserve stable typed IDs for domain entities.
8. Avoid placeholder architecture for speculative features.
9. Implement the smallest complete vertical slice.
10. Add tests for domain behavior where useful.

For major architectural deviations from this document, explain the trade-off before introducing the change.

---

# 22. Current design summary

Kanleaf should currently be understood as:

```text
User
  │
  │ many-to-many
  ▼
WorkspaceMembership
  │
  ▼
Workspace
  ├── Project
  │    └── Task
  │         └── Markdown Document
  │
  ├── Workspace Views
  ├── Labels
  ├── Members
  └── Vault
```

Future user-specific presentation state exists alongside it:

```text
User
  │
  └── UserWorkspacePreference
             │
             └── Workspace
```

Future project-specific membership may be introduced only if Kanleaf actually needs private/restricted projects:

```text
User
  │
ProjectMembership
  │
Project
```

Do not implement that relation by default.

The current goal is to establish a clean Workspace boundary first and then build Projects and Tasks inside it.
