# Project Identity, Creation, and Routing Design

## Summary

Kanleaf will replace the name-only inline Project composer with a spacious,
single-screen creation dialog. A Project is created with a name, immutable
public Project ID, optional description, curated Lucide icon, lead, and
Private/Public visibility. The dialog previews the Project's default cover and
uses the existing restrained Kanleaf visual language rather than copying Plane
verbatim.

Browser routes will use readable Workspace and Project identifiers:

```text
/w/<workspace-id>/p/<project-id>/work-items?task=<task-number>
```

Workspace IDs and Project IDs are browser-facing identities. Project and Task
UUIDs remain internal database, API, authorization, query, portability, and
vault identities. Task numbers already increase monotonically within a
Workspace; they become the public Task locator and the visible Task reference,
such as `#42`. The existing uppercase Project identifier and Task reference
semantics, such as `KAN-42`, are retired.

Project archive becomes genuinely reversible. Permanent Project deletion,
unlike archive, removes all relational data and managed Markdown through a
recoverable trash-first cross-store operation.

## Goals

- Replace the cramped inline Project name form with an accessible wide dialog.
- Let users review name, Project ID, description, icon, lead, and visibility
  before creation.
- Use a lowercase, readable Project ID in every canonical Project browser URL.
- Allow duplicate Project names while preventing duplicate live or archived
  Project IDs in one Workspace.
- Keep browser URLs free of Workspace, Project, and Task UUIDs.
- Use the existing Workspace-scoped monotonic Task number in URLs and display.
- Preserve authorized old bookmarks through membership-aware redirects.
- Support Private Projects and Public-within-the-Workspace Projects.
- Make archive non-destructive and restorable.
- Make permanent deletion remove the Project's complete PostgreSQL and Markdown
  footprint without leaving an unrecoverable cross-store partial operation.
- Give Projects a consistent icon and a theme-aware default cover.

## Non-goals

- Public Internet access or unauthenticated Project discovery.
- Mutable Project IDs or Project ID alias history.
- Reusing a deleted Task number.
- User-selectable cover backgrounds in this capability.
- Uploaded Project icons, emoji, arbitrary SVG, or a second icon library.
- Replacing UUIDs in API paths, foreign keys, query keys, vault storage names,
  or authorization checks.
- Adding a generic wizard, form framework, repository layer, or new UI
  dependency.
- Bulk Project creation, archive, restore, or deletion.

## Considered approaches

### Selected: public identifiers at the routing boundary, UUIDs internally

Projects receive a lowercase public identifier while the UI resolves the
authorized Workspace and Project to their UUIDs before using existing feature
APIs. Tasks use their existing Workspace-unique `task_number` in the URL and
resolve to a UUID after authorization.

This keeps URLs readable without spreading human-facing identifiers through
every persistence and security boundary.

### Rejected: use one Project slug for both routes and Task references

This produces long Task references such as `mobile-app-42`, preserves an
unnecessary Project task-key concept, and works against the goal of shorter,
clearer Task locations.

### Rejected: replace UUIDs throughout the HTTP API

Changing every Project and Task endpoint to public identifiers would enlarge
the authorization, migration, and compatibility surface without improving the
browser experience. UUIDs remain appropriate internal identities.

### Rejected: keep the current uppercase Project identifier as the URL ID

Short keys such as `KAN` are optimized as Task prefixes, not readable durable
Project locations. They also do not match the approved name-normalized URL
model.

## Persistent model and migration

One or more ordered migrations update the current Project model:

- `projects.identifier` becomes the public Project ID;
- it is canonical lowercase ASCII, 2–48 characters, starts and ends with a
  letter or number, and contains only single hyphen-separated runs;
- it is immutable after creation;
- `(workspace_id, identifier)` is unique while the Project row exists;
- archived Projects retain the identifier;
- permanent deletion removes the row and therefore permits reuse of that
  identifier in the same Workspace;
- the active Project-name unique index is removed so names may repeat;
- `projects.icon` stores a stable key from the supported Lucide Project-icon
  registry and defaults to `folder`;
- visibility becomes `private | public`; stored `open` values are migrated to
  `public`.

No cover column is added. The current capability has one tokenized,
theme-aware default cover and exposes no edit affordance. Persistence should be
added only when a real customization capability exists.

Existing Project IDs are deterministically derived from Project names. The
normalizer:

- applies Unicode decomposition and removes combining marks;
- maps Vietnamese `đ`/`Đ` to `d`;
- lowercases ASCII output;
- converts punctuation and whitespace runs to one hyphen;
- trims leading/trailing hyphens;
- limits output to 48 characters;
- falls back to `project` when no valid characters remain.

Within each Workspace, collisions receive the first available numeric suffix
(`project`, `project-2`, `project-3`). Ordering by creation time and UUID makes
the backfill deterministic. Existing names, UUIDs, storage names, memberships,
and vault paths do not change.

The existing Project identifier currently produces Task references such as
`KAN-42`. That task-key role is removed rather than copied to a second column.
Task responses, collaboration summaries, queries, and frontmatter use `#42`.
The migration enqueues every existing Task for projection so managed Markdown
converges to the new reference without changing its body or storage path.

Portability output advances its format to store the Project public identifier,
icon, and `public` visibility. Import continues to accept the previous archive
format, including uppercase Project identifiers, `open` visibility, and
`KAN-42` references. The importer validates the old archive under its old
contract, allocates collision-free public identifiers in the destination, and
projects Task references as `#<task-number>`.

## Canonical routes

Canonical Workspace routes move under the explicit `/w` namespace so `/host`
and `/setup` remain unmistakably deployment-level surfaces:

```text
/w/<workspace-id>/my-work
/w/<workspace-id>/inbox
/w/<workspace-id>/tasks
/w/<workspace-id>/views/<view-uuid>
/w/<workspace-id>/library[/<document-uuid>]
/w/<workspace-id>/settings/account/<section>
/w/<workspace-id>/settings/workspace/<section>
```

Canonical Project routes use the compact `/p` namespace:

```text
/w/<workspace-id>/p/<project-id>
/w/<workspace-id>/p/<project-id>/work-items
/w/<workspace-id>/p/<project-id>/cycles[/<cycle-uuid>]
/w/<workspace-id>/p/<project-id>/modules[/<module-uuid>]
/w/<workspace-id>/p/<project-id>/library[/<document-uuid>]
/w/<workspace-id>/p/<project-id>/views[/<view-uuid>]
/w/<workspace-id>/p/<project-id>/settings/<section>
```

Task selection remains a query parameter so Task detail can coexist with the
current collection or planning surface:

```text
?task=42
```

The URL parser accepts only a positive integer in the Task parameter. A
Workspace-scoped authenticated lookup resolves `(workspace UUID, task_number)`
to the Task UUID. Missing and unauthorized Tasks have the same non-disclosing
behavior. If an authorized Task is selected from a mismatched Project route,
the existing location reconciliation moves to its owning Project surface. An
inaccessible Task is removed from the location without rendering cached detail.

Typed route builders own every new path; product components do not concatenate
segments. Back, Forward, refresh, deep links, validated Settings return paths,
and `DocumentSaveCoordinator` remain part of the routing contract.

## Legacy route compatibility

The authenticated route boundary supports and replaces all current forms:

- `/<workspace-id>/...`;
- `/<workspace-id>/projects/<project-uuid>/...`;
- `/w/<workspace-uuid>/...`;
- Task query parameters containing a Task UUID.

For `/w/<value>`, routing first resolves an exact identifier from the
authenticated Workspace list. Only when no identifier matches may a
syntactically valid UUID be treated as a legacy Workspace UUID. This preserves
a valid identifier even if it happens to look UUID-shaped. Redirects resolve
only through authorized Workspace, Project, and Task data, use history
replacement, and preserve the applicable suffix, query parameters, and hash. A
missing or unauthorized legacy identity redirects to a safe authorized
location without confirming that the resource exists.

## Project creation authorization and transaction

Workspace Owners, Admins, and Members may create Projects. Guests may not.
Creation accepts:

- required `name`;
- required `identifier`;
- optional `description`;
- required supported `icon`, defaulted by compatible clients to `folder`;
- required `visibility` (`private` or `public`);
- required `lead_user_id`, defaulted by the interactive client to the creator.

The server validates the complete request, locks the Workspace, checks Project
ID uniqueness, and performs Project creation and access changes in one SQLx
transaction. It also installs the current Workspace Task-type defaults.

A Member who creates a Project receives explicit Project Admin access even when
another lead is selected. Selecting a different Workspace Member as lead adds
or promotes that person to Project Admin in the same transaction. Workspace
Owners/Admins already have implicit Project Admin access and do not receive a
redundant membership. Guests cannot be selected as lead.

`public` means discoverable and joinable by authenticated Workspace Members.
It never grants access outside the Workspace. `private` is visible only to its
Project members plus Workspace Owners/Admins.

## Create Project dialog

The navigation heading action and zero-Project action open one native modal
dialog. The inline name composer is removed. The dialog is approximately 860px
wide, constrained by the viewport, and uses one screen rather than a wizard.

Its hierarchy is:

1. header with **Create a Project**, concise supporting copy, and Close;
2. theme-aware default cover preview;
3. Project icon control overlapping the lower cover edge;
4. one row containing Project name and Project ID;
5. one full-width optional description textarea;
6. one row containing Project lead and visibility controls;
7. fixed footer with Cancel and primary **Create Project**.

Name receives more horizontal width than Project ID. The Project ID follows the
normalized name until the user edits it directly. Manual editing stops
automatic replacement. A quiet **Reset from name** action resumes it. A URL
preview shows the exact prospective location, for example
`/w/acme/p/mobile-app`.

Description uses approximately four visible rows and the existing 2,000
character limit. Lead and visibility use readable popover triggers rather than
small native selects. There is no persistent helper copy below these two
controls. The lead menu shows each candidate's Workspace role and marks a
regular Member with concise `Becomes Project Admin` copy. Visibility choices
carry their explanation inside the menu:

- **Private** — Project members only;
- **Public** — Workspace Members can discover and join.

Submission disables all actions, changes the primary label to `Creating…`, and
prevents duplicate requests. Enter submits from single-line fields;
Command/Ctrl+Enter submits from the textarea. Escape, Close, backdrop click, and
Cancel dismiss only while no request is in flight. Success closes the dialog,
refreshes Project data, and navigates to the new Project overview. Failure keeps
the complete draft.

At narrow widths, both two-column rows stack, the modal approaches the usable
viewport, and header/footer remain stable. The design must work at the existing
960×640 desktop minimum and the established narrow Workspace layout.

## Project icon picker and default cover

The Project icon control opens a 320–360px popover containing:

- a search field;
- curated `General`, `Product`, `Engineering`, and `Creative` groups;
- approximately 24–32 Lucide icons in a six-column desktop grid and a
  five-column narrow grid;
- selected, hover, active, and visible focus states;
- accessible icon names and tooltips.

Arrow keys move through the grid. Enter/Space selects. Escape and outside
interaction close the picker and restore focus. The icon registry is the one
source for creation, navigation, Project Overview, and fallback behavior.
Unknown keys render `Folder` rather than breaking the surface.

The default cover is a restrained warm-green surface with a subtle geometric
CSS treatment expressed through existing or explicit light/dark tokens. It is
shown in the creation preview and Project Overview. No edit button, empty
placeholder, upload control, or stored background value is exposed.

## Project Overview and navigation

Project navigation replaces the generic Folder with the selected Project icon.
Project Overview adds the default cover above the identity header, with the
Project icon anchored to it. Name, Project ID, visibility, access, actions, and
description retain the current compact hierarchy below the cover.

The cover must not turn the overview into a marketing hero. It provides
identity and separation, not oversized copy or decorative dashboard cards.
Long names and descriptions wrap without covering actions or clipping the icon.

## Archive and restore

Archive becomes a non-destructive lifecycle state:

- set `archived_at` while retaining the Project row and identifier;
- retain Tasks, documents, views, planning data, memberships, configuration,
  storage names, and Markdown in place;
- remove the Project from normal navigation and active Project queries;
- do not reassign Project content to Workspace Inbox or Library.

Workspace Settings gains an **Archived Projects** section. Workspace
Owners/Admins see every archived Project. A regular Member sees only archived
Projects for which they retain explicit Project Admin access. Guests see none.
Authorized users may Restore, returning the Project to its previous route and
state, or start permanent deletion. Listing and restoration apply the same
non-disclosing authorization rules as active Project administration.

Archive keeps the identifier reserved. Restore fails visibly if another
invariant changed while archived and never silently creates replacement data.

## Permanent Project deletion

Permanent deletion requires current Project-admin authority and exact entry of
the Project ID. The confirmation states that all Project Tasks, planning,
documents, members, configuration, and Markdown will be removed. It does not
move anything to Inbox or Workspace Library.

The owning use case locks the Workspace and Project, records a durable deletion
manifest below the persisted `vaults/` mount, and atomically renames the complete
Project vault directory into local trash before committing relational deletion.
Relational cleanup includes Tasks and their comments, relations, assignments,
labels, planning links, Saved Views, cycles, modules, Project documents,
memberships, task configuration links, projections, and other Project-owned
rows. Foreign-key cascades may perform individual deletes only when their
ownership and behavior are verified by tests.

If filesystem preparation fails, the database transaction is rolled back. If
the database commit fails, the directory is restored. After commit, trash is
removed and the manifest is retired. Startup recovery inspects a surviving
manifest and database state to restore a pre-commit operation or finish a
post-commit deletion. Manifest and trash paths remain on the same persisted
filesystem as the live Project directory so required renames are atomic.

Only committed permanent deletion frees the Project ID for reuse. Task numbers
remain consumed and are never decremented or reused.

## Errors and asynchronous states

- Name, ID, description, icon, visibility, and lead errors remain associated
  with their controls.
- The client may reject a conflict visible in its authorized Project list, but
  only the server is authoritative. It does not claim an ID is globally
  available before creation.
- An ID conflict returns inline without clearing the form.
- Lead loading keeps the modal layout stable. Failure offers Retry and retains
  the creator as the valid default lead.
- If a selected lead leaves the Workspace or becomes ineligible, creation
  returns a validation error, refreshes candidates, and preserves all other
  fields.
- Unknown icon input is rejected by the server; unknown stored icon output uses
  the client fallback.
- Closing the dialog restores focus to the trigger. Popovers close on selection,
  Escape, outside interaction, route change, or modal dismissal.
- Cached Project or Task content never renders before fresh owning access is
  established for the current account.

## Code ownership

Frontend Project-creation behavior belongs under a focused feature directory:

```text
apps/desktop/src/features/project/create/
  ProjectCreateDialog.tsx
  ProjectCreateForm.tsx
  ProjectIconPicker.tsx
  projectCreateModel.ts

apps/desktop/src/features/project/projectIcons.tsx
apps/desktop/src/app/routing/*
```

The dialog owns transient draft/popover state. TanStack Query owns server data.
The typed routing boundary owns URL serialization and compatibility redirects.
The Project icon registry is feature-owned rather than a generic UI primitive.
Small deviations in filenames are acceptable when implementation evidence
shows a clearer existing boundary; responsibilities must remain separated.

The already-large server Project module should move creation and lifecycle
behavior behind focused modules such as `project/create.rs` and
`project/lifecycle.rs`. Domain validation remains framework-independent, and
SQL/transaction ownership remains in the Project feature. No generic repository
or speculative shared crate is introduced.

## Testing and verification

Backend coverage includes:

- Project slug normalization, deterministic collision suffixes, validation,
  immutable update rejection, duplicate names, and concurrent creation;
- icon allowlist and Private/Public validation;
- creator and selected-lead Project Admin rules, including negative Guest and
  removed-member cases;
- authorized Task-number lookup, Workspace scoping, missing/unauthorized
  non-disclosure, and numbers never being reused;
- archive data preservation, filtered archived listing, Restore, and identifier
  retention;
- permanent deletion of every relational class and managed Markdown;
- failure before rename, before commit, after commit, and startup recovery;
- old and new portability archive validation and round-trip behavior.

Frontend coverage includes:

- automatic Project ID suggestion, manual-edit freeze, and reset;
- complete modal submission, inline conflict, failure draft retention, busy
  behavior, close/focus restoration, and narrow stacking;
- lead and visibility menu content and keyboard behavior;
- icon search, groups, grid navigation, selection, fallback, and propagation to
  navigation/overview;
- canonical route parsing/building, refresh, Back/Forward, Settings return
  paths, mismatched Task reconciliation, and every legacy redirect.

Playwright covers one real Project lifecycle: create with icon/lead/visibility,
land on the identifier route, open a Task through `?task=<number>`, reload the
deep link, verify Public join and Private denial, Archive/Restore, and permanent
deletion. Compatibility coverage verifies representative old Workspace,
Project, and Task UUID URLs.

Visual verification covers light, dark, wide, 960×640, and the existing narrow
layout, plus long names, long descriptions, loading, validation, conflict,
disabled, and keyboard-only states.

## Definition of done

- The name-only inline creator no longer exists.
- A Project can be created with the approved fields through the spacious modal.
- Canonical browser locations use `/w/<wid>/p/<pid>` and Workspace-scoped Task
  numbers, with no UUIDs.
- Authorized legacy links redirect without losing meaningful location state.
- Task display and managed Markdown use `#<number>` rather than a Project task
  key.
- Duplicate names work; identifier collisions fail; archived identifiers stay
  reserved; permanently deleted identifiers can be reused.
- Icon and default cover appear consistently and accessibly.
- Archive/Restore preserves all data, while permanent deletion removes all
  relational and Markdown data recoverably.
- Fresh backend, frontend, routing, import/export, E2E, visual, formatting,
  linting, type-checking, and build evidence passes for the changed scope.
