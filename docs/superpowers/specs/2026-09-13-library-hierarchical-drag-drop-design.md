# Hierarchical Library drag-and-drop and permanent deletion

**Date:** 2026-09-13

## Scope

Complete the existing Library hierarchy with persistent subtree drag-and-drop,
an atomic server move operation, and direct permanent subtree deletion. Preserve
the current Library routes, editor, Markdown revisions, create/rename/archive
behavior, permissions, collapse state, and keyboard tree navigation. Moves stay
inside one Workspace/Project scope; this feature does not introduce
cross-Project moves.

## Tree and destination model

The client represents every valid drop as:

```ts
interface TreeDestination {
  parentId: string | null;
  index: number;
}
```

`index` is the destination sibling index after removing the dragged root from
its old sibling list. BEFORE and AFTER resolve against the target's parent.
INSIDE resolves to the target as parent and appends after its current children.
Dropping before or after a root row provides an explicit way to unnest a child.

Pure tree helpers operate on the full active tree and own descendant detection,
cycle checks, scope and edit checks, destination validation, subtree projection,
and contiguous position normalization. Visible-tree helpers only remove rows
hidden by collapsed ancestors and are used for rendering, hit testing, and the
existing keyboard navigation.

## Drag interaction

Each editable row reserves a fixed drag-handle column. Only the Lucide
`GripVertical` button activates dragging. Read-only rows have no interactive
handle. The installed `@dnd-kit/react` implementation provides pointer and
keyboard sensors, overlay positioning, and sortable displacement animation.

Pointer position near a row's top or bottom edge immediately selects BEFORE or
AFTER. The middle starts a stable INSIDE candidate timer while retaining one
deterministic BEFORE/AFTER fallback preview based on the pointer's relation to
the row center. The fallback does not alternate while the pointer remains in
the middle. INSIDE activates after about 400 ms. A collapsed target with
children temporarily expands after about 500 ms. Moving into that revealed
subtree keeps the temporary expansion; leaving it or canceling the drag restores
the user's collapsed state. A successful drop may retain an auto-expanded
ancestor.

An INSIDE leaf target displays a non-interactive ghost `ChevronDown`; no data is
mutated solely for that affordance. The preview projects the dragged root and
all descendants at the destination, hides that projected subtree while
preserving its height as the insertion slot, and renders only the root row in a
`DragOverlay`. Drag cancel, route changes, deletion, and mutation failures clear
all candidate timers, temporary expansion, overlay, source, and preview state.

Reduced-motion users receive no sortable transition. Normal motion is short and
non-bouncing.

## Client persistence and cache behavior

Drag end snapshots every relevant `['documents', workspaceId, ...]` list plus
cached document/routed-document records, then immediately applies hierarchy and
position changes. The selected document ID and route remain unchanged.

The move request sends only the dragged ID and `{parent_id, index}`. Its response
contains authoritative affected documents sufficient to reconcile normalized
positions and every moved subtree path. The client does not derive
`library_path` from guessed filename behavior; optimistic hierarchy/order leaves
paths unchanged until the authoritative response is merged. A move failure
restores the exact snapshots and shows the existing Library action error.

Create, rename, and archive retain their current save preflight. A move also
passes the Markdown save coordinator; a rejected preflight rolls back its
optimistic projection without issuing the request. One tree mutation persists
at a time, and conflicting move/archive/delete controls are disabled.

Permanent delete waits for server success. The response returns exact
`deleted_ids`; the client removes those IDs from aggregate and Project Library
caches, document metadata caches, routed-document caches, and Markdown content
caches. If the current selection is in that set, it navigates with replacement
to the current Library root. An unrelated selection remains open. A failed
delete leaves cache, selection, and route unchanged.

## Atomic server move

Add one document-owned move endpoint:

```text
PUT /api/workspaces/{workspace_id}/documents/{document_id}/move
{ "parent_id": UUID | null, "index": integer }
```

Under the existing Workspace document lock, one SQLx transaction:

1. locks and authorizes the active source document for edit;
2. validates the active destination parent, same scope, index, self/descendant
   cycles, and portable storage-name availability;
3. snapshots the source Library path;
4. removes the source from its old siblings, inserts it at the requested new
   sibling index, updates `parent_id`, and normalizes both affected active
   sibling lists to contiguous positions;
5. resolves the authoritative destination path and stages the Markdown file and
   companion subtree move with the existing durable Library operation manifest;
6. commits PostgreSQL, compensating the staged filesystem move if commit fails;
7. retires the manifest after commit, leaving a recoverable manifest/trash entry
   if final cleanup fails.

A same-parent reorder does not touch the filesystem. A reparent moves the file
and companion directory together, so descendants remain one logical subtree.
Startup recovery compares the manifest paths with committed PostgreSQL state and
keeps or reverses the staged move accordingly. The response returns all
documents whose position, parent, or Library path is affected.

The legacy sibling reorder endpoint is removed only after repository-wide caller
search proves that Library was its only valid caller. The normal PATCH endpoint
continues to own rename and explicit detail-pane scope/parent changes, but drag
and drop never composes PATCH with sibling reorder requests.

## Permanent subtree deletion

Archive remains the existing reversible timestamp operation and preserves
Markdown. `Delete permanently` may delete an active or archived document without
calling archive first.

The server locks and authorizes the root, validates that every recursive member
shares its Workspace/Project scope, captures exact subtree IDs, and resolves the
root Library path. It writes the durable delete manifest and renames the root
Markdown file plus companion directory into Library trash before deleting the
root database row. The existing cascading parent foreign key deletes every
descendant. Remaining active siblings are normalized in the same transaction.

If trash staging or SQL fails, PostgreSQL rolls back and the staged tree is
restored before returning the error. If commit succeeds, the records are
unreachable and trash is purged; a purge failure remains recoverable and is
logged without inviting an unsafe client retry. Startup recovery restores trash
when the root record still exists and purges it when deletion committed. The
success response contains the exact recursive `deleted_ids`.

## UI actions

The final editable-row menu is:

```text
Add nested note
Rename
----------------
Archive
Delete permanently
```

Move up/down actions and their Library-only helpers are removed. Archive is not
styled as permanent destruction. Delete uses the shared danger `AppDialog`,
requires explicit confirmation, and reports the recursive nested-note count in
its title/body.

## Verification

Pure Vitest coverage proves sibling reorder in both directions, first/last,
nest, append, reparent, unnest, subtree preservation, cycle/self/scope/permission
denials, collapsed/visible separation, and destination calculation. Component
tests use fake timers for the 400 ms INSIDE and 500 ms auto-expand thresholds,
and cover handle-only activation, ghost chevrons, cancel cleanup, optimistic
cache reconciliation/rollback, context actions, recursive delete, routing, and
existing create/rename/archive/collapse behavior.

SQLx integration tests cover reorder, reparent, unnest, filesystem subtree
movement, normalized positions, invalid/cycle/scope/authorization failures,
rollback evidence, direct leaf deletion, recursive deletion, exact IDs, no
dangling rows, storage cleanup, and archive separation. Playwright adds one
deterministic drag persistence workflow without arbitrary sleeps.

Run the complete relevant frontend, Rust, Tauri, E2E, and self-host Compose
checks from `AGENTS.md`, review the full diff/status, commit conventionally,
push `dev`, and wait for the pushed commit's GitHub Actions jobs.
