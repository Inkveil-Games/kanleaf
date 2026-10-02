# Canonical Vault and Shared Milkdown Editor Design

## Intent

Kanleaf will expose a readable, portable Workspace vault while retaining
PostgreSQL identity and authorization. Tasks and Library Pages will continue to
persist Markdown, and both product surfaces will use the same continuously
editable session implemented by `MarkdownDocument`.

## Canonical vault contract

The Workspace directory is its immutable public `WorkspaceIdentifier`. The
Workspace UUID remains the database identity and remains in recovery manifests.
Project directories use the immutable `ProjectIdentifier`. Task files are flat
and use the workspace-unique monotonic task number. Library Page paths retain
their stable hierarchical `LibraryStorageName` segments; Project-owned Library
Pages remain physically scoped to their Project because Project access is an
authoritative ownership boundary.

```text
vaults/<workspace-identifier>/
├── tasks/<task-number>.md
├── library/<stable-page-path>.md
├── projects/<project-identifier>/library/<stable-page-path>.md
├── assets/images/<opaque-id>.<validated-extension>
├── assets/files/
└── .trash/{tasks,library,projects,assets}/
```

A Page file may have a same-stem companion directory for children. Task title
and Project membership changes never move the Task file. Project display-name
changes never move the Project directory.

## Migration and recovery

Database migration 0032 introduces vault layout version 3 while retaining
versions 0 and 2 for startup migration. Startup first recovers old structural
operations against their recorded layout, then stages every non-v3 Workspace
under a hidden v3 directory. The stage is built only from authorized database
identity plus regular source files, rejects duplicate destinations and unsafe
entries, verifies the complete expected inventory, writes a durable manifest
containing both UUID and public identifier, then atomically renames the old root
aside and the staged root into place. Database version update and activation
retain the existing compensation/reconciliation pattern. Recovery chooses
commit or rollback from the database layout version and never overwrites a live
or staged entry silently.

Version 0 and 2 inputs remain compatibility-only. All live path generation,
sync, export, and newly imported Workspaces use version 3.

Workspace-local structural trash lives below the Workspace `.trash` tree.
Workspace deletion itself remains in the vaults-level recovery area because
the Workspace directory is the object being renamed.

## Assets

One authenticated Workspace asset endpoint accepts image uploads from all
editor entry points. It validates size, declared MIME, magic bytes, emptiness,
and never uses the client filename for a path. Files receive random opaque
names. Markdown stores `kanleaf-asset://images/<opaque-name>`, which is portable
across hosts and Workspace copies. One client resolver converts that reference
to an authenticated object URL for read-only rendering and Milkdown.

Deletion of a Markdown image removes only the reference. Physical assets remain
until a future reference index and garbage collector can prove they are
unreferenced. The filesystem implementation stays behind the existing vault
boundary; no speculative remote-storage interface is added yet.

## Shared editor

`MarkdownDocument` remains the only Task/Library document session. Editable
documents open directly in a single canonical Markdown draft whose default
visual tab is lazy-loaded Milkdown Crepe and whose raw tab is lazy-loaded
CodeMirror Source. There is no separate Reading state for editable documents.
Read-only users retain the lightweight `react-markdown` renderer. Tab changes
serialize/parse locally and do not themselves call the backend.

Draft changes autosave after a short debounce with the current revision.
Ctrl/Cmd+S flushes immediately. Editable sessions register with the save
coordinator; a transition flushes pending changes and blocks on an error/conflict.
There is no Split mode or CodeMirror Live Preview.

Crepe supplies per-block drag handles, the slash menu, commonmark/GFM nodes,
and listener-based canonical Markdown updates. A shared Kanleaf formatting
toolbar replaces the inline `+` and selection toolbars. Programmatic
Source-to-Editor changes use `replaceAll`. Recognized unsupported syntax
(frontmatter, raw HTML, footnotes) opens Source with an explicit warning;
this guard is not a general proof of lossless parsing. Representative semantic
round-trip tests cover supported Markdown. Crepe UI is mapped to Kanleaf tokens
for both themes and remains compact at narrow widths.

## Verification

Rust coverage owns path construction, v0/v2 migration, rollback/recovery,
deletion, sync/import/export, and upload validation. Frontend coverage owns the
direct editing, one canonical draft, autosave/conflict behavior, Task/Library
reuse, Crepe block controls, formatting/round-trip semantics, asset inputs, and
theme/responsive contracts. A real self-hosted Kanleaf instance with representative
Task and Library data is the user-review gate before any commit or push.
