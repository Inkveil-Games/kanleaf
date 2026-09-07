# Kanleaf Library Page number routing design

## Goal

Replace UUID-shaped Library selection URLs with short Workspace-scoped Page
numbers while retaining UUIDs as the internal identity.

The canonical routes are:

```text
/w/kanleaf/library?page=42
/w/kanleaf/p/my-project/library?page=42
```

This mirrors Task routing (`?task=42`), keeps Library selection in the URL, and
allows a Page to retain its public number when it moves between the Workspace
Library and a Project Library. Existing UUID path links remain valid
compatibility locators and are replaced with the canonical numbered URL after
authorization and resolution.

## Terminology and non-goals

`page` is the public URL term because it is readable and already matches the
product's Page capability and Markdown target. The persistence and application
domain remains `Document`: the `documents` table, `DocumentResponse`, feature
modules, and UUID API routes are not renamed.

This change does not:

- replace the Document UUID primary key;
- change Library Markdown paths or storage names;
- use Page numbers for foreign keys, parent relationships, or authorization;
- introduce title slugs;
- reuse numbers after archive or permanent deletion;
- add a Page reference to the visible Library header solely for this routing
  change.

## Identity model

Each Document has two identities:

```text
id               UUID    internal stable identity
document_number  BIGINT  public positive number scoped to one Workspace
```

`documents.id` remains the primary key and the identity used by CRUD endpoints,
tree relationships, TanStack Query detail keys, vault operations, recovery
manifests, and filesystem paths. `document_number` is immutable and exists only
to produce a short public locator.

Two Workspaces may both contain Page `42`. Within one Workspace,
`document_number` is unique across Workspace and Project Libraries, including
active and archived Documents. Moving a Document between scopes never changes
its number.

## Database migration

Add a new ordered migration after the current schema history. It adds:

```sql
ALTER TABLE workspaces
    ADD COLUMN next_document_number BIGINT NOT NULL DEFAULT 1,
    ADD CONSTRAINT workspaces_next_document_number_positive
        CHECK (next_document_number > 0);

ALTER TABLE documents
    ADD COLUMN document_number BIGINT;
```

Existing active and archived Documents are numbered deterministically within
each Workspace by `created_at, id`. The migration then sets each Workspace's
`next_document_number` to one greater than its maximum assigned number, or `1`
when it has no Documents. Finally it makes the new column non-null and adds:

```sql
UNIQUE (workspace_id, document_number)
CHECK (document_number > 0)
```

The migration does not rewrite any committed migration or derive the number
from tree order, title, Project, or storage name.

## Number allocation

Document creation allocates the number inside the existing owning transaction
with an atomic Workspace counter update equivalent to:

```sql
UPDATE workspaces
SET next_document_number = next_document_number + 1
WHERE id = $1
RETURNING next_document_number - 1;
```

The returned value is inserted with the Document. The existing Workspace
document lock and transaction continue to serialize the database and vault
creation invariant. A rolled-back creation may roll back its counter increment;
once a Document creation commits, its number is never reassigned, even after
archive or permanent deletion.

Concurrent creation tests must prove that successful Documents receive distinct
numbers. Number gaps are valid and are not repaired.

## Server response and resolver

`DocumentResponse` gains:

```rust
pub document_number: i64
```

Every list, detail, create, and update query returning a Document selects this
field. Existing UUID CRUD and content routes remain unchanged.

Add the public-locator resolver:

```text
GET /api/workspaces/:workspace_id/documents/by-number/:document_number
```

The handler rejects non-positive numbers, resolves by the composite
`(workspace_id, document_number)` identity, and applies the same Workspace and
effective Project access checks as UUID detail. It returns the normal
`DocumentResponse`. An inaccessible or absent Page remains non-disclosing and
uses the established not-found behavior; a public number is not an
authorization capability.

## Canonical frontend routing

React Router remains the owner of durable Library selection. The canonical
selection is the positive decimal `page` search parameter:

```text
/w/:workspaceIdentifier/library?page=:documentNumber
/w/:workspaceIdentifier/p/:projectIdentifier/library?page=:documentNumber
```

The route adapter parses the locator without treating it as a UUID. The route
screen resolves it through the by-number endpoint only after the owning
Workspace access has settled. Once resolved, the shell and Document feature use
the UUID internally; components do not introduce a second controlled selection
state.

Selecting a Library tree item writes its `document_number` to the URL. Creating
a Page uses the number from the create response. Moving the selected Page uses
the update response to replace the route with the correct Workspace or Project
Library while preserving the number. Closing or archiving the selected Page
removes only the `page` parameter and retains the Library route.

If a resolved Page belongs to a different accessible scope than the route, the
route is replaced with the canonical scope. This includes moves:

- from a Project Library to the Workspace Library;
- from the Workspace Library to a Project Library;
- between Project Libraries.

Replace navigation avoids adding stale scope URLs to browser history. Refresh,
Back, Forward, direct links, and route hashes continue to work.

## Legacy UUID URL compatibility

The existing path routes remain accepted:

```text
/w/:workspaceIdentifier/library/:documentId
/w/:workspaceIdentifier/p/:projectIdentifier/library/:documentId
```

They are compatibility inputs, not canonical output. After Workspace access is
settled, the route screen resolves the UUID using the existing authorized
Document detail endpoint. A successful lookup replaces the location with the
correct scope and `?page=<document_number>`. Any existing hash is preserved.

No new navigation emits a UUID path. Compatibility must remain in place for
existing bookmarks and shared links; removing it is outside this change.

## Invalid and unavailable selection

- A missing `page` parameter means no Page is selected.
- Empty, signed, zero, fractional, non-decimal, or overflowing values are
  malformed and are replaced with the parent Library route without a resolver
  request.
- A missing or inaccessible locator is not corrected until the owning access
  query has settled for the current identity.
- An unavailable Page clears the selection and shows the established
  non-disclosing notice: `That Page is unavailable or you no longer have
access.`
- Cached Document data from another account or from unconfirmed access cannot
  resolve or render the selection.
- A transient access or resolver error retains the requested URL and exposes
  the existing retry behavior instead of converting the error into absence.

## Portable Workspace archives

New exports persist `document_number` in each `DocumentIdentity`. The live
source manifest format advances from version 1 to version 2; the outer archive
format does not need to change because its container and inventory semantics
remain the same.

Import accepts both source manifest versions:

- Version 2 requires every Document number to be positive and unique across
  the source Workspace. Import remaps UUIDs as it does today, preserves Page
  numbers, and sets `next_document_number` to `max + 1`.
- Version 1 has no Document numbers. Import assigns deterministic positive
  numbers in stable manifest identity order, then sets the counter to
  `max + 1`.

This keeps existing Kanleaf archives importable. Imported Workspaces are new
identity domains, so allocating numbers for a version 1 archive does not break
an existing live URL. Version 2 preserves numbered references across a portable
round trip.

Manifest validation continues to reject duplicate UUIDs, invalid trees,
unsafe paths, and unsupported newer versions. Number validation is added before
any imported Workspace or vault becomes live.

## Tests

Server coverage includes:

- migration backfill for active and archived Documents and counter values;
- positive and Workspace-scoped uniqueness constraints;
- sequential and concurrent Document creation;
- by-number resolution for Workspace and Project Pages;
- unauthenticated, wrong-Workspace, inaccessible private Project, Guest, and
  malformed-number cases;
- moving a Document without changing its number;
- permanent deletion without counter reuse;
- version 2 export/import preservation and next-number allocation;
- version 1 archive compatibility with deterministic number assignment;
- rejection of duplicate or non-positive imported numbers.

Frontend coverage includes:

- parsing and building `?page=42` Workspace and Project routes;
- malformed query canonicalization without an API lookup;
- resolving a direct numbered deep link to an internal UUID;
- UUID compatibility routes replacing to numbered routes while preserving a
  hash;
- scope correction after a Page move;
- unavailable/access-pending/error behavior;
- selection, close, refresh, Back, and Forward behavior;
- create responses navigating with the assigned number.

One Playwright workflow covers a real Page selection, refresh, and legacy UUID
redirect across the browser/server boundary. Verification uses the full
applicable Rust, frontend, PostgreSQL integration, build, and end-to-end groups
from `AGENTS.md`.

## Rollout

The server migration, resolver, response field, portable format support, route
adapter, and frontend canonicalization ship as one capability. PostgreSQL
migrations run before the updated server accepts traffic. The additive response
field and retained UUID endpoints preserve current internal callers while the
new frontend stops emitting UUID Page URLs.

The implementation must audit route builders, tests, links, and navigation for
hard-coded `/library/:uuid` output. UUID APIs and storage code are deliberately
excluded from that audit because they remain internal by design.
