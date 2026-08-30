# Portable Workspace Vault Design

**Date:** 2026-08-30

**Status:** Approved design

## Purpose

Kanleaf workspaces become portable, Obsidian-friendly vaults without making the
filesystem the live structured-data database. A Workspace and each of its
Projects receive distinct `Todo` and `Wiki` namespaces. Task metadata remains
canonical in PostgreSQL and is projected into readable YAML properties at the
top of each Task Markdown file. Workspace configuration is represented by
versioned JSON files and travels with Markdown in a single `.kanleaf.zip`
archive.

The result serves two equally important workflows:

- Kanleaf remains a secure multi-user project-management application with
  server-side authorization and relational invariants;
- a copied or exported Workspace remains understandable as normal Markdown in
  Obsidian or another filesystem-based editor.

This design supersedes the physical layout and body-only Task file rules in
`docs/architecture.md` and the statement in the Library vault design that a
Project never becomes a physical folder. Those documents remain descriptions
of the implementation before this migration until the capability lands.

## Chosen approach

Kanleaf uses a **managed portable vault**:

- PostgreSQL is canonical for structured state during normal operation;
- Kanleaf owns and writes a closed set of YAML properties;
- external property edits enter PostgreSQL only through an explicit
  preview-and-apply `Sync vault` operation;
- Task and Wiki Markdown remains in normal files under stable, readable paths;
- one versioned `.kanleaf.zip` format is both export and backup;
- import always creates a new Workspace and remaps database identities.

This balances relational correctness with portability. A filesystem-first
model would make multi-user authorization and constraints unreliable. An
export-only mirror would be simpler but would make Obsidian edits effectively
read-only and would not satisfy the portable workflow.

## Goals

- Give Workspace Inbox Tasks and Workspace Wiki independent physical roots.
- Give every Project its own stable folder with `Todo` and `Wiki` roots.
- Keep one Project in exactly one Workspace in both PostgreSQL and the vault.
- Put human-readable structured Task properties into Obsidian-compatible YAML.
- Preserve Task bodies, Wiki source, wikilinks, and unknown Obsidian properties.
- Support explicit, conflict-aware import of external Task property changes.
- Export all portable Workspace content and configuration in one archive.
- Import an archive without overwriting or granting access to an existing
  Workspace.
- Migrate existing vaults without destructive in-place conversion.

## Non-goals

This capability does not add:

- realtime filesystem watching;
- offline-first or bidirectional continuous synchronization;
- CRDT or collaborative Markdown conflict resolution;
- automatic link rewriting or backlink indexing;
- Obsidian attachment management;
- an application-managed `.obsidian` directory;
- arbitrary filesystem browsing through the API;
- a PostgreSQL dump or server/account backup format.

The archive contains Workspace content and portable Workspace configuration.
Passwords, sessions, invitation secrets, account preferences, notification read
state, and deployment configuration are never included. Memberships and
Project memberships are reference metadata only and never become grants during
import. Comment/activity history remains outside the first archive version
because safely restoring authors across independent servers requires a portable
identity model; this limitation must be visible before export rather than
silently implied to be covered.

## Vault layout

The managed layout is:

```text
KANLEAF_DATA_DIR/
└── vaults/
    └── <workspace-uuid>/
        ├── .kanleaf/
        │   ├── manifest.json
        │   ├── workspace.json
        │   ├── task-config.json
        │   ├── views.json
        │   └── projects/
        │       └── <project-uuid>.json
        ├── Todo/
        │   └── task-title--a1b2c3.md
        ├── Wiki/
        │   ├── getting-started.md
        │   └── getting-started/
        │       └── installation.md
        └── Projects/
            └── kanleaf--d4e5f6/
                ├── Todo/
                │   └── implement-export--b7c8d9.md
                └── Wiki/
                    └── architecture.md
```

`Todo` is the filesystem name for Task Markdown; it does not introduce a new
Task status. Workspace Inbox continues to mean `tasks.project_id IS NULL`.

The top-level `Wiki` contains Workspace-scoped Library notes. A Project's
`Wiki` contains Library notes whose `project_id` points to that Project. The
existing companion-tree rule remains: `getting-started.md` is a readable note,
while `getting-started/` contains its children.

`.kanleaf` contains machine-readable, versioned portable configuration. It is
not an Obsidian configuration directory. Users may read it, but Kanleaf does not
continuously consume edits to these files. Archive import validates and consumes
supported config snapshots; vault sync version 1 only reports live JSON drift.

## Stable storage identity

Project and Task paths use separate, immutable `storage_name` values. The
initial display name is normalized into a portable kebab-case stem and receives
`--<short-id>` from the stable UUID:

```text
Project: Kanleaf            -> kanleaf--d4e5f6
Task: Implement export      -> implement-export--b7c8d9.md
```

The normalization boundary rejects separators, control characters, reserved
desktop filenames, `.` and `..`, trailing dots/spaces, and overlong UTF-8
segments. The UUID suffix makes collisions deterministic without consulting the
filesystem. The `.md` extension is not stored in PostgreSQL.

Renaming a Project or Task changes its display title, not its storage name.
Import preserves archived storage names even though it remaps UUIDs, so links
and readable paths do not change after restoration. The short suffix therefore
records the identity that originally created the path; it is not recalculated.

Library notes retain their current stable storage-name and companion-directory
semantics. A root Library move between Workspace and Project scopes moves its
file and complete companion tree between the corresponding `Wiki` roots.

## Obsidian and future linking compatibility

Kanleaf writes standard UTF-8 Markdown and YAML without creating `.obsidian` or
requiring an Obsidian plugin. Relative Markdown links and Obsidian Wikilinks in
Task/Wiki bodies are preserved exactly. Stable Task and Project storage names
avoid link breakage after ordinary title changes, while the short-ID suffix
reduces ambiguous same-title targets in an Obsidian graph.

Folder hierarchy does not itself create graph edges. Obsidian displays a graph
once documents contain resolvable links. Backlink indexing, link autocomplete,
and link-aware Library reparent/rename remain a later Kanleaf capability built
on these stable paths; this migration does not guess at or rewrite authored
links.

## Domain and database changes

The existing tenant invariants remain:

- a Project belongs to exactly one Workspace;
- a Task belongs to that Workspace and optionally one of its Projects;
- a Library note belongs to that Workspace and optionally one of its Projects;
- parents, task configuration, cycles, modules, labels, and assignees may not
  cross the owning Workspace or Project constraints.

Ordered SQL migrations add:

- immutable `projects.storage_name`;
- immutable `tasks.storage_name`;
- a vault layout version for each Workspace;
- Task metadata projection version/status;
- coalescing Task projection jobs committed with metadata updates;
- durable import, export, and vault-sync operation records with expiry.

Library already has optional Project scope and stable storage names. Its
same-scope parent invariant remains; the physical path now follows that scope.

Project archive continues moving active Project Tasks to Inbox and Project Wiki
roots to Workspace scope. Under the new layout, the use case also moves the
corresponding typed vault entries before removing the empty Project directory.
Project deletion, Task moves, Library moves, and Workspace deletion retain the
existing trash-first/recovery-manifest strategy.

The projection jobs are a PostgreSQL-backed same-process reliability mechanism,
not an external queue service. There is no Redis, broker, or new runtime.

## Task Markdown properties

A Task file contains a YAML frontmatter mapping followed by the user's exact
Markdown body:

```markdown
---
Kanleaf ID: 8a86ccf1-7494-44ea-8fd1-b7c8d9e4f120
Reference: KAN-42
Title: Implement workspace export
Project:
  - Kanleaf
State:
  - In Progress
Type:
  - Task
Priority:
  - High
Assignees:
  - user@example.com
Labels:
  - Backend
Cycle:
  - Sprint 4
Modules:
  - Vault
Start date: 2026-08-30
Due date: 2026-09-05
Estimate: 3
Parent:
  - KAN-12
---

# Export behavior

The archive must preserve this body exactly.
```

Kanleaf owns these top-level keys:

- `Kanleaf ID`, `Reference`, `Title`, and `Project`;
- `State`, `Type`, and `Priority`;
- `Assignees`, `Labels`, `Cycle`, and `Modules`;
- `Start date`, `Due date`, `Estimate`, and `Parent`.

Required single-value vocabulary fields use one-item YAML lists because that is
the Obsidian property shape selected for State and Type. Optional reference
fields use a list or `[]`; dates are ISO `YYYY-MM-DD` scalars or null; Estimate
is a non-negative number or null. `Kanleaf ID` is the stable reconciliation
identity. Display values remain human-readable, while sync resolves them through
the authorized Workspace vocabulary and reports ambiguous or unknown values.

The Markdown editor reads and writes only the body. Structured controls in the
Task detail pane edit PostgreSQL metadata. API document reads return the body,
projection health, and a SHA-256 revision of the complete file. Body saves
rebuild the file from the current frontmatter plus submitted body and require
the revision that was opened.

## Source fidelity and custom properties

Kanleaf does not deserialize and reserialize the complete frontmatter on every
metadata edit. A frontmatter component has two responsibilities:

1. validate the YAML as a safe top-level mapping without duplicate keys,
   aliases, merge keys, or ambiguous Kanleaf-owned values;
2. locate the source spans of Kanleaf-owned top-level blocks and replace only
   those blocks in canonical form.

Unknown/custom property blocks and intervening comments are copied from the
source unchanged. The body after the closing delimiter is copied byte-for-byte
unless the user explicitly edits it. Updating one Kanleaf property must not
normalize line endings, indentation, whitespace, wikilinks, headings, or custom
properties elsewhere in the file.

Malformed frontmatter, a changed `Kanleaf ID`, duplicate owned keys, or a missing
closing delimiter produces a typed conflict. Kanleaf does not guess, discard
custom data, or replace the whole file. A future repair action may deliberately
regenerate owned properties after showing the affected source; it is not part
of this capability.

Raw HTML remains disabled in Markdown preview. YAML is rendered as metadata in
the detail pane, not injected into preview HTML.

## Metadata projection

PostgreSQL is canonical during normal Kanleaf operations. A Task metadata
transaction increments its metadata version and coalesces one pending
projection job for that Task. After commit, the request path attempts the
filesystem projection immediately. A same-process worker and startup recovery
retry jobs left by a crash or temporary storage failure.

Projection reads the current file, validates its identity, patches only the
owned property spans, writes a temporary sibling, and atomically renames it.
External body edits and custom properties therefore survive a metadata update.
Vocabulary renames enqueue every affected Task without performing filesystem
writes inside one large SQL transaction.

Metadata-only DB changes remain successful if a later filesystem projection
fails because PostgreSQL is canonical, but the API returns projection health
and Workspace Settings exposes the failure. Export waits for all projection
jobs to finish and refuses to produce an inconsistent archive.

Path-affecting operations are stricter. Moving a Task between Inbox and a
Project, archiving a Project, or moving a Library subtree requires a valid typed
source path and a recoverable filesystem move before the corresponding database
operation can be reported complete. Recovery manifests under
`KANLEAF_DATA_DIR/operations` reconcile a crash using committed database state.

## Explicit Sync vault

There is no filesystem watcher. `Sync vault` is an Owner/Admin operation with
two phases.

### Preview

The server walks only the managed Workspace roots, validates every segment, and
matches Task files by `Kanleaf ID`. It compares Kanleaf-owned properties with
PostgreSQL and the last projected metadata version. The preview classifies:

- valid metadata changes;
- unchanged Tasks;
- unknown or duplicate IDs;
- missing or unexpectedly moved files;
- invalid vocabulary, assignment, hierarchy, date, or Project changes;
- stale files whose DB metadata changed since the external edit;
- malformed frontmatter and checksum conflicts.

External body changes need no database import because bodies already live in
the vault. The next document read sees them and the existing revision contract
prevents a stale editor from overwriting them.

Paths remain Kanleaf-owned. Editing `Project` in frontmatter can propose a Task
move; on apply the server performs the normal authorized typed move. Manually
moving the file as well is reported rather than inferred. File renames and
Library-tree inference are deferred until link-aware rename semantics exist.

### Apply

The preview returns an expiring operation ID bound to source revisions and the
current metadata versions. The user selects valid changes; unresolved conflicts
are excluded and remain visible. Apply revalidates the complete selected set.
If any selected item changed after preview, none of the selected set is applied.
Otherwise the server applies it through normal Task use cases and recovery
manifests. Excluding a visible conflict is an explicit partial selection, never
an implicit partial failure.

## Portable configuration

Live `.kanleaf` JSON files use an explicit format version and stable exported
IDs. Their responsibilities are:

- `workspace.json`: Workspace name, identifier, public settings, portable
  feature preferences, and non-authoritative membership references;
- `task-config.json`: States, Types, Labels, defaults, and display ordering;
- `views.json`: shared Workspace/Project views and their typed filters,
  grouping, ordering, and layouts;
- `projects/<project-uuid>.json`: Project metadata, storage name, features,
  enabled Task Types, Cycles, Modules, and non-authoritative membership
  references;
- `manifest.json`: live layout/config versions and the stable entity identity
  map. The copy generated inside an export additionally contains the complete
  managed-file inventory, content revisions, restore relationships, and
  SHA-256 checksums for that snapshot.

Device-local preferences such as pane widths, active account, editor mode, and
window geometry remain client-local and are not exported. Personal views owned
by other accounts are not portable Workspace configuration; shared views are.

Kanleaf updates the JSON projection when canonical configuration changes using
the same temporary-file and atomic-rename boundary. Unknown top-level JSON keys
from a newer schema are not silently accepted by an older server. Import rejects
a schema version it cannot interpret instead of dropping fields.

Vault sync version 1 imports Task YAML properties only. External edits to
`.kanleaf` JSON are reported as configuration drift and are not applied to
PostgreSQL; the next successful projection restores the canonical JSON. Archive
import does consume the staged JSON after validating its supported schema and
manifest checksums.

## Export archive

One `.kanleaf.zip` format is both export and backup:

```text
workspace-name.kanleaf.zip
├── .kanleaf/
├── Todo/
├── Wiki/
└── Projects/
```

Before export, the server drains pending projections. It then reads a
repeatable PostgreSQL snapshot, builds the restore identity map, collects the
managed vault files, and verifies their revisions again before publishing the
archive. If data changes during collection, it retries from a fresh snapshot or
returns a typed `workspace_changed` error. It never returns an archive composed
from two logical versions.

The manifest records every included relative path, size, media type, and
checksum. It also records the structured relationships needed to rebuild Task,
Library, configuration, and shared-view rows with new IDs. Raw database rows,
SQL, authentication data, absolute paths, and server environment values are
not included.

Only Kanleaf-managed Markdown and known `.kanleaf` JSON files are included in
archive version 1. Symlinks, `.obsidian`, temporary files, and unmanaged files
are excluded and reported before the download is confirmed. This prevents an
unexpected file placed in the server data directory from becoming an exfiltration
path while making the backup boundary explicit.

Export is an asynchronous server operation. The artifact is written to typed
internal operation storage, downloaded through an authorized expiring ID, and
removed after its retention period. No filesystem path is returned to a client.

## Import archive

Any authenticated user may upload a `.kanleaf.zip` because apply always creates
a new Workspace owned by that user. Import never merges with or overwrites an
existing Workspace.

Preview extracts into a generated staging directory and enforces:

- compressed and uncompressed byte limits;
- file-count, path-depth, segment-length, and per-file limits;
- no absolute paths, parent traversal, duplicate normalized paths, symlinks,
  hardlinks, devices, or unsupported file types;
- supported manifest/config versions and exact checksums;
- unique entity IDs and valid Workspace–Project–Task–Library relationships;
- valid YAML identities and agreement between properties and the restore map.

The preview shows entity counts, source version, excluded user references,
unsupported history, warnings, and blocking errors. A failed preview changes no
Workspace data.

Apply revalidates the staged checksums, creates a new Workspace, remaps
Workspace, Project, Task, Library, vocabulary, view, cycle, module, label, and
relationship IDs, and makes the importer Owner. Archived storage names are
preserved. `Kanleaf ID` and other machine identity properties are rewritten to
the new IDs without changing Task bodies or unknown properties.

Previous membership and Project-role entries are retained only as reference
metadata in exported JSON. They neither create users nor grant access. Pending
invitations are not restored.

PostgreSQL and the filesystem cannot share one transaction. Import therefore
uses a durable operation state and a sibling staging vault. The database rows
remain non-active while the complete vault is validated and atomically renamed
into its final Workspace UUID. Startup recovery finishes or removes an
interrupted import based on the operation record. A half-imported Workspace is
never listed to users.

## API design

The server exposes resource-oriented operation endpoints:

```text
POST   /api/workspace-imports/preview
GET    /api/workspace-imports/{import_id}
POST   /api/workspace-imports/{import_id}/apply
DELETE /api/workspace-imports/{import_id}

POST   /api/workspaces/{workspace_id}/exports
GET    /api/workspace-exports/{export_id}
GET    /api/workspace-exports/{export_id}/download
DELETE /api/workspace-exports/{export_id}

POST   /api/workspaces/{workspace_id}/vault-syncs/preview
GET    /api/workspaces/{workspace_id}/vault-syncs/{sync_id}
POST   /api/workspaces/{workspace_id}/vault-syncs/{sync_id}/apply
DELETE /api/workspaces/{workspace_id}/vault-syncs/{sync_id}
```

Long-running operations use `preparing`, `ready`, `applying`, `completed`, and
`failed` states. The resource `GET` returns status and preview/error details;
only the export `/download` endpoint returns archive bytes. Operation IDs are
random, scoped to the authenticated actor and Workspace, and expire. Cancelling
removes staged files when no apply is active.

All errors use the existing stable API envelope. New typed error codes cover
permission denial, invalid archive, unsupported schema, checksum mismatch,
invalid metadata, stale preview, projection conflict, Workspace changes during
export, and unavailable vault storage. Database errors and internal paths are
never exposed.

## Authorization

- Any authenticated user may preview and apply an import because it creates a
  new Workspace they own.
- Workspace Owner/Admin may preview/apply vault sync and export the complete
  Workspace.
- Other Workspace and Project roles keep their existing Task and Library edit
  rights but cannot export all Workspace data or import external metadata into
  canonical configuration.
- Every file access follows a resolved Workspace/Project/Task/Library identity
  after authorization. The API never accepts an arbitrary vault path.
- Downloading an export re-checks current Owner/Admin access even if the actor
  created the operation earlier.

## Desktop interaction

The Workspace switcher remains compact:

```text
user@example.com
────────────────────────
✓ Personal Workspace    ⚙
  Kanleaf               ⚙
────────────────────────
＋ Create workspace
⇩ Import workspace
  Workspace invitations
```

`Import workspace` opens a `.kanleaf.zip` file picker, uploads the archive, and
shows a preview before enabling apply. The preview lists Workspace, Project,
Task, Wiki, and configuration counts; identity/permission behavior; warnings;
and blocking validation errors. Apply selects the newly created Workspace when
complete.

Workspace Settings remains a floating settings window separate from Account
Settings. A `Storage & portability` section shows:

- vault health and the last successful projection/sync;
- `Sync vault`, followed by a change/conflict preview and explicit Apply;
- `Export workspace`, followed by preparation and download state;
- unsupported-history and unmanaged-file notices when relevant.

There is no second Backup button: Export Workspace is the portable backup. The
Workspace switcher exposes Settings only where the actor has permission, and
the retired three-dot Workspace menu does not return.

The UI uses existing Kanleaf rows, separators, focus states, dropdowns, and
floating-window primitives. Operation progress is compact and cancellable; it
does not become a dashboard or a stack of statistic cards. Buttons remain real
buttons, file controls have labels, focus is trapped within confirmation
dialogs, and errors remain selectable/readable for recovery.

## Legacy migration

The existing layout is:

```text
vaults/<workspace-uuid>/
├── Tasks/<task-uuid>.md
└── Library/...
```

The new migration is an application startup migration after SQL migrations and
before the HTTP listener accepts writes. It is idempotent and operates one
Workspace at a time:

1. acquire the Workspace migration lock;
2. derive deterministic Project and Task storage names from current titles and
   UUIDs;
3. construct a complete v2 vault in a sibling staging directory;
4. copy each Task body into its target `Todo` file with projected properties;
5. copy the current Library companion tree into Workspace `Wiki` without
   changing its Markdown bytes;
6. emit and validate `.kanleaf` configuration and manifest files;
7. verify entity counts, identities, revisions, checksums, and the ability to
   parse every generated file;
8. record the intended directory swap in a recovery operation;
9. rename the legacy vault to a timestamped recovery sibling, then rename the
   staged v2 vault to the canonical Workspace UUID;
10. commit the layout/storage/projection versions and complete the operation.

Existing Library notes with Project scope initially remain Workspace Wiki
content only if the pre-migration physical tree cannot separate them without a
safe typed subtree move. The migration uses PostgreSQL scope to move each root
and its companion tree into the correct Project `Wiki`; conflicting mixed-scope
trees stop migration with a recovery error rather than guessing.

If validation or staging fails, the canonical legacy vault is untouched. If a
crash occurs during the two renames, startup uses the operation record and
checksums to finish or restore the known-good legacy directory. The timestamped
recovery vault is never deleted automatically; operator documentation explains
how to inspect and remove it after successful verification.

Fresh Workspaces use layout v2 immediately and create content directories
lazily. Empty Project `Todo` and `Wiki` directories are not required until the
first item is created.

## Testing strategy

### Domain and unit tests

- Project/Task portable storage-name construction and immutability.
- Typed Workspace, Project, Todo, Wiki, staging, and archive paths.
- Frontmatter parsing, owned-span replacement, unknown-property preservation,
  malformed YAML, duplicate keys, and byte-faithful bodies.
- Archive manifest versions, checksum verification, ID remapping, and config
  validation.

### PostgreSQL and vault integration tests

- Workspace and Project isolation for every new endpoint.
- Owner/Admin versus Member/Guest export and sync authorization.
- Task move, Project archive, Library scope/subtree move, and compensation.
- Projection enqueue, coalescing, immediate apply, crash retry, and fan-out
  after vocabulary rename.
- Sync preview/apply, stale preview, invalid configuration, and conflict
  exclusion.
- Migration success, failure before swap, crash between swaps, restart, and
  preservation of the legacy recovery directory.
- Export/import round trip preserving Markdown, custom properties, config,
  relationships, storage names, and isolation from the source Workspace.
- Zip Slip, normalized duplicate paths, symlinks, archive bombs, invalid
  checksums, unsupported versions, and oversized inputs.

Filesystem tests use temporary directories. Database tests use isolated
databases and never share operation or vault roots.

### Desktop tests

Vitest and React Testing Library cover Workspace switcher Import, permission
visibility, preview/apply/cancel, sync conflicts, export progress/download, and
error recovery. Tests assert user behavior and accessibility rather than query
implementation details.

Playwright covers the core portable workflow:

```text
create Workspace and Project
→ create Inbox and Project Tasks
→ create Workspace and Project Wiki notes
→ edit structured metadata and Markdown
→ export
→ import as a new Workspace
→ open restored Tasks/Wiki
→ verify properties, relationships, paths, and bodies
```

Backend integration tests, rather than browser-only tests, inject external
frontmatter edits and malicious archives because they can validate filesystem
and authorization invariants directly.

## Delivery sequence

The work lands as coherent capability commits, each leaving current workflows
usable:

1. add schema, typed storage identities, and domain rules;
2. add layout v2 and restartable legacy migration;
3. add YAML projection and explicit vault sync;
4. add portable config and import/export operations;
5. add Workspace Settings and switcher flows;
6. add round-trip E2E, security regression coverage, architecture docs, and
   deployment guidance.

The implementation should update `docs/architecture.md` when the new boundary
actually lands, not before. It should not introduce reusable crates or generic
repository abstractions unless concrete reuse appears while implementing these
capabilities.

## Completion criteria

The capability is complete when:

- every new and migrated Workspace uses the v2 layout;
- Project Tasks and Wiki notes live under that Project's stable folder;
- Kanleaf metadata edits reliably project to YAML without changing user source;
- an external Obsidian property edit can be previewed, validated, and explicitly
  applied;
- export produces a validated portable archive from a consistent snapshot;
- import creates an isolated Workspace with remapped IDs and preserved paths;
- authorization, archive validation, recovery, and round-trip tests pass;
- the desktop UI exposes the flows without restoring inconsistent menus or
  card-heavy settings;
- the legacy vault remains recoverable after migration;
- docs and CI describe and verify the resulting behavior.
