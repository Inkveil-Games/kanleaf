# Kanleaf Library Vault Design

**Date:** 2026-08-29

**Status:** Approved design

## Purpose

Kanleaf's document area becomes **Library**: a workspace knowledge tree where
every node is both a readable Markdown note and a possible parent of more
notes. The same vault must remain understandable when copied from a self-hosted
server and opened in Obsidian or another filesystem-based Markdown editor.

The characteristic filesystem shape is:

```text
Library/
├── getting_started.md
└── getting_started/
    ├── installation.md
    └── configuration.md
```

`getting_started.md` is the parent's content. The companion
`getting_started/` directory contains its children. A directory is derived from
the document tree; it is not an independently managed entity.

## Goals

- Rename the user-facing Pages and Documents areas to Library.
- Let a note remain selectable and editable while independently expanding its
  children.
- Store Library Markdown in a human-readable filesystem tree.
- Keep stable document identity, hierarchy, project scope, ordering, and
  authorization in PostgreSQL.
- Preserve Markdown bytes except for explicit user edits.
- Migrate existing UUID Page files without resetting existing installations.
- Establish paths that a later linking feature can use for an Obsidian graph.

## Non-goals

This capability does not add backlinks, link autocomplete, graph rendering,
attachments, filesystem watching, bidirectional import, empty folders, or an
Obsidian configuration directory. It does not rewrite manually authored links
when a note is reparented. Link indexing and link-aware moves are a subsequent
capability built on the stable Library paths introduced here.

Task Markdown remains under `Tasks/<task-id>.md`. The Library change applies
only to workspace documents and project pages.

## Domain model

The existing `documents` table remains the structured source of truth. A
document has:

- a stable UUID;
- one Workspace;
- an optional Project;
- an optional parent document in the same scope;
- a display title;
- a stable filesystem name;
- a sibling position;
- archive and audit timestamps.

Every document has Markdown content, including documents with children. There
is no file-versus-folder type and no separate folder table. A companion
directory exists only when needed to contain descendants.

`title` and `storage_name` intentionally differ. Creation derives a readable
`storage_name` from the initial title. Renaming the title does not rename the
file as a side effect. This keeps the filename segment stable across title
changes and avoids silently breaking links. A future link-aware rename
operation may change `storage_name` after it can update inbound links safely.

Project is metadata, not a filesystem directory. All Library roots share the
same physical tree, while the Kanleaf UI can continue presenting Workspace and
Project sections. Moving a root note between Workspace and Project scope does
not move its file. Changing its parent does move the note subtree because the
physical tree follows `parent_id`.

## Database changes

An ordered migration adds `storage_name TEXT NOT NULL` to `documents`. Storage
names are already canonical lowercase values. A PostgreSQL 17 `UNIQUE NULLS
NOT DISTINCT (workspace_id, parent_id, storage_name)` constraint makes them
unique among physical siblings regardless of Project scope, including root
notes whose `parent_id` is null.

Existing rows initially receive their UUID as `storage_name`. This is a
machine-detectable migration marker, not their final filename. Before the HTTP
listener starts, an idempotent Library migration visits documents in stable
parent-before-child order, assigns a readable collision-free name from the
title, moves the legacy Markdown file, and records the final `storage_name`.

The API continues to use `/documents` routes and document terminology in code.
`DocumentResponse` adds `storage_name` and a computed vault-relative
`library_path`. Clients never submit arbitrary paths. Create requests submit a
title; the server chooses the storage name. Existing title, scope, parent,
position, reorder, archive, and delete operations retain their current API
shape.

## Portable storage names

Storage-name construction is centralized in the server domain and does not
accept path separators. It:

1. trims the title;
2. lowercases Unicode characters;
3. keeps Unicode alphanumeric characters;
4. replaces runs of whitespace, hyphens, and underscores with one underscore;
5. removes control characters and characters forbidden by common desktop
   filesystems;
6. trims leading and trailing dots, spaces, and underscores;
7. avoids `.`/`..`, Windows device names, and an empty result;
8. bounds the UTF-8 byte length so the resulting path remains portable;
9. appends `_2`, `_3`, and so on when the physical sibling name is occupied.

The `.md` extension is not stored in PostgreSQL. Name matching for collisions
is case-insensitive so a vault remains transferable between case-sensitive and
case-insensitive filesystems. The server revalidates every stored name before
using it in a path, even though it originated internally.

A storage-name segment is at most 120 UTF-8 bytes. A document may be nested at
most 12 levels deep, and its `Library/`-relative file path may be at most 240
UTF-8 bytes including `.md`. Creation and reparenting validate both depth and
the complete resulting subtree paths before changing PostgreSQL or the vault.

## Path resolution

The vault receives a typed Library location made only from parsed Workspace
and document records. It resolves a document by walking its ancestor chain and
joining validated `storage_name` segments:

```text
vaults/<workspace-id>/Library/<ancestor>/<document>.md
```

For the example tree:

```text
document getting_started  -> Library/getting_started.md
child installation        -> Library/getting_started/installation.md
```

No API accepts an absolute path or a caller-provided relative path.
Authorization and document ownership are checked before path resolution or
filesystem access. Raw paths and data-directory details are never returned;
`library_path` is relative to the Workspace vault and exists only to explain
the portable document location.

## Filesystem lifecycle

### Create

The server locks the Workspace document tree, validates scope and parent,
chooses an available storage name, inserts the structured row in a transaction,
and creates the `.md` file with `create_new`. If filesystem creation fails, the
database transaction rolls back. If database commit fails, the unattached file
is moved to trash and purged using the existing compensation pattern.

Creating the first child also creates the parent's companion directory. Empty
companion directories left by a failed create are removed.

### Read and write

Content endpoints lock and authorize the document, resolve the typed Library
path, and use the existing SHA-256 revision contract. Writes still use a
same-directory temporary file followed by rename, so autosave and explicit save
remain source-faithful and conflict-aware.

### Rename title

Renaming changes only `documents.title`. The detail pane shows the stable
Library path so the distinction is visible rather than surprising. The action
is labeled **Rename title** in menus.

### Reparent

Changing `parent_id` moves both `<name>.md` and, when present, the companion
`<name>/` subtree. The server validates cycles and destination collisions before
touching the vault. Filesystem moves happen on the same mounted filesystem and
return a typed compensation handle. The database commits only after the move;
on commit failure, the handle restores both paths to their original location.

Moving a file-plus-directory pair is not one filesystem syscall. The vault
therefore records a small recovery manifest under
`KANLEAF_DATA_DIR/operations/` before the first rename. On startup, recovery
compares the committed database parent with the manifest and completes or
rolls back the interrupted move. The manifest contains generated relative
locations and stable IDs, never user-supplied paths or Markdown content.

Until link indexing is implemented, reparenting warns that manually authored
cross-note links may need updating. Kanleaf does not guess at link syntax or
rewrite unrelated Markdown in this stage.

### Project scope changes

Changing `project_id` preserves the physical path when the parent remains
unchanged. The existing same-scope parent invariant still applies. If changing
scope clears or changes the parent, the operation follows the reparent protocol
above.

### Archive and delete

Archiving remains a structured soft-delete and applies to the complete subtree.
Permanent deletion moves the subtree's root `.md` file and companion directory
to typed trash locations before deleting database rows. Database failure
restores both. Purging removes the trash only after commit. Removing the last
child cleans up its now-empty companion directory but never removes a
non-empty directory.

## Legacy Page migration

Legacy files use:

```text
vaults/<workspace-id>/Pages/<document-id>.md
```

The startup migration runs after SQL migrations and before the server binds its
socket:

1. lock one Workspace's document tree;
2. load active and archived documents in deterministic parent-before-child
   order;
3. compute final storage names, resolving sibling collisions deterministically;
4. record the document ID, source, destination, and content revision in a
   recovery manifest;
5. move each legacy file into the new Library tree without changing bytes;
6. update its database `storage_name` only after the destination exists;
7. remove the manifest after the database update commits;
8. remove the empty legacy `Pages/` directory after all documents succeed.

Each step is restartable. If a destination exists while the legacy source is
missing, migration verifies its revision against the recovery manifest before
completing the database update. It never overwrites a non-empty unattached
file. A missing or mismatched manifest stops startup with a concise recovery
error instead of choosing data loss.

Fresh Workspaces create `Library/` lazily when their first Library note is
created. No empty directory scaffolding is required.

## Desktop interaction

User-facing navigation and copy use **Library** consistently:

- Workspace `Documents` becomes `Library`.
- Project `Pages` becomes `Library`.
- The project feature toggle is labeled `Library`; its existing internal
  `pages_enabled` field remains unchanged to avoid a cosmetic schema rewrite.
- Empty, loading, error, archive, and permission copy use note/Library terms.

The collection remains a compact tree pane beside the document detail pane.
Each row has two independent targets:

- a chevron expands or collapses children without changing the active note;
- the title selects the note and opens its Markdown in the detail pane.

Leaf rows reserve the chevron space to keep alignment stable. Creating a child
expands its parent and selects the new note. Expansion state is a client-local
preference keyed by Workspace and Project view; stale document IDs are ignored.

Keyboard behavior follows an accessible tree:

- Up/Down selects the previous/next visible row;
- Right expands a collapsed parent, then selects its first child on a second
  press;
- Left collapses an expanded parent, then selects its parent on a second press;
- Enter opens/selects the focused note;
- F2 starts title rename where authorized.

Only visible rows participate in navigation. `aria-expanded` appears only on
nodes with children, and selection remains distinct from expansion.

The detail metadata shows a read-only vault-relative path. Parent and Project
controls retain current authorization behavior. A reparent confirmation
mentions the temporary manual-link limitation before starting the move.

## Future linking contract

The later linking capability builds on stable IDs and Library paths without
changing this storage model. It will:

- insert standard Markdown links by default;
- recognize both standard Markdown links and Obsidian Wikilinks;
- resolve a target path to a stable document ID;
- index source-to-target edges in PostgreSQL for backlinks and graph views;
- update inbound path references during link-aware reparent or explicit file
  rename operations;
- keep raw Markdown source unchanged outside the exact link destinations being
  updated.

Folder hierarchy alone does not create graph edges. A downloaded Library shows
an Obsidian network once notes contain links that resolve to other Library
files. No `.obsidian` directory is needed for this behavior.

## Error handling and security

- All Workspace and Project authorization remains server-side.
- Document membership is checked before vault access.
- Typed IDs and validated stored segments are the only path inputs.
- Symlinks are not followed as Library documents; an unexpected symlink or
  non-regular destination fails closed.
- Existing non-empty destinations are conflicts and are never overwritten.
- Revision conflicts preserve the user's unsaved editor content.
- Migration or recovery errors prevent the HTTP server from accepting writes
  until the vault is consistent.
- Logs may identify stable entity IDs but do not expose Markdown content,
  bearer tokens, host filesystem roots, or database credentials.

## Testing

Server domain tests cover Unicode names, reserved characters, byte bounds,
empty results, case-insensitive collisions, and deterministic suffixes.

Temporary-directory vault tests cover:

- parent `.md` plus companion directory layout;
- nested create, read, write, and revision conflicts;
- subtree moves with and without children;
- collision refusal and rollback;
- interrupted-operation recovery;
- subtree trash, restore, purge, and empty-directory cleanup;
- legacy UUID Page migration without byte changes;
- refusal to follow symlinks or accept traversal segments.

PostgreSQL integration tests cover Workspace and Project authorization,
same-scope parents, cycle prevention, stable names, tenant isolation,
transaction compensation, archive/delete behavior, and migration of an
existing schema.

React Testing Library covers visible-row flattening, independent selection and
expansion, persisted expansion state, keyboard behavior, Library copy, child
creation, and reparent confirmation.

Playwright covers creating a readable parent and child, editing both Markdown
files, collapse/expand behavior, reload persistence, restart persistence,
cross-Workspace denial, and the resulting on-disk structure. Visual review
covers long titles and paths, deep nesting, empty/error/loading states,
wide/narrow windows, focus, selection, and light/dark themes.

## Delivery boundaries

Implementation stays in the existing server `document` and `vault` modules and
desktop `document` feature. No new crate, service, watcher, repository
abstraction, or general filesystem API is introduced. The database/API keeps
document terminology internally; Library is the product-facing concept.

Delivery is split into coherent commits for schema and typed vault paths,
legacy migration and lifecycle compensation, Library tree interaction, E2E and
documentation polish. Each commit leaves existing Task Markdown behavior and
authorization intact.

## Reference

Obsidian's internal-link documentation confirms that both standard Markdown
links and Wikilinks can target notes through vault-relative folder paths, and
that standard Markdown links are the more interoperable format:
<https://obsidian.md/help/links>.
