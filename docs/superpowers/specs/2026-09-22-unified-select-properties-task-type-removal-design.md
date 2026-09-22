# Unified Select Properties and Task Type Removal Design

## Summary

Kanleaf will present State, Labels, and custom select properties through one
shared property editor while keeping their persistence and domain rules
separate. The editor uses the approved direct-form layout: property identity
and description first, followed by one aligned values table with drag, icon,
color, name, description, default where applicable, and row actions.

State remains a required system single-select and Labels remains a system
multi-select. Custom single- and multi-select definitions continue to use the
custom-property tables. Shared React components provide the common editing
experience; State, Labels, and custom properties retain dedicated server use
cases, authorization, foreign keys, projection behavior, and lifecycle rules.

Task Type is removed from the product, APIs, database, saved views, portable
configuration, webhook snapshots, Task UI, and fixed Markdown frontmatter.
Workspaces that used Task Types meaningfully are migrated to a custom
single-select property named `Type`; workspaces that only contain the protected
default `Task` type lose the redundant field and its Markdown key is cleaned by
the durable projection queue.

State Group is also removed. Three required State values carry immutable
internal semantic roles: `todo`, `in_progress`, and `done`. Tasks continue to
store the stable State UUID. Completion and workflow calculations resolve the
State's semantic role rather than its display name or a user-editable group.

## Approved product decisions

- Use the direct property-editor layout selected in the visual preview.
- Share the editor and option-table UI, but keep State, Labels, and custom
  property storage domain-specific.
- Keep Labels as multi-select.
- Remove Task Type completely from Kanleaf.
- Remove State Group completely from the data and UI.
- Every Workspace has exactly one active `Todo`, `In Progress`, and `Done`
  system State.
- The three system State names are immutable. Their icon and color are also
  product-owned; users may edit only their descriptions and order.
- System States remain draggable. Users may add, order, edit, archive, and
  delete additional custom State values.
- Use a stable semantic role, not a display name, for workflow calculations.
- Preserve existing Backlog and Canceled rows as ordinary custom State values.
- Custom select and Label values start with no icon. State values receive
  appropriate monochrome Lucide icons.
- Icons use `currentColor`; changing the value color changes the icon color.

## Goals

- Make the same property type look and behave the same in Settings.
- Put property description and value descriptions in every select editor.
- Give ordered values the same pointer and keyboard drag behavior.
- Add a searchable, categorized, keyboard-accessible icon picker with a larger
  curated Lucide catalog and an explicit no-icon choice.
- Guarantee stable UUID identity for every State, Label, and custom option.
- Preserve meaningful legacy Task Type data without keeping Task Type as a
  special system concept.
- Make core workflow semantics independent of user-visible names and order.
- Migrate saved views and portable archives deterministically.
- Preserve the PostgreSQL/Markdown ownership boundary and retryable projection
  behavior.

## Non-goals

- Moving State or Labels into custom-property tables.
- A schema-driven CRUD renderer or generic server repository.
- Formulas, relations, rollups, or computed custom properties.
- Custom-property filtering, grouping, or list columns in this change.
- Project-specific defaults for custom properties.
- Arbitrary SVG uploads, emoji, or a user-managed icon library.
- Treating Markdown and PostgreSQL as an atomic transaction.

## Considered approaches

### Selected: shared editor with domain-specific persistence

One property form and select-value table are composed by explicit State,
Labels, and custom-property feature components. Data stays in `task_states`,
`task_labels`, and `custom_property_options`. This gives users a coherent
editor without weakening system invariants or forcing domain behavior into
opaque generic configuration.

### Rejected: store State and Labels as custom properties

This would make State assignment, inbox/project defaults, task foreign keys,
completion calculations, and Label joins indirect. It would require a much
larger data migration and make core Task queries less explicit for no user
benefit.

### Rejected: UI-only convergence

Keeping State Group and Task Type behind a shared-looking form would leave the
inconsistent model, Markdown contract, and calculations in place. It would not
satisfy the removal requirements.

## Property editor contract

The common editor is a page-level Settings form with this order:

```text
Name                                  Type
[property name]                       [property type]

Property description
[description textarea]

Property values
drag | icon | color | name | description | default? | actions
```

State and Labels expose fixed, read-only names and types:

- `State` / `Single select`;
- `Labels` / `Multi select`.

Their descriptions are Workspace-editable. New Workspaces start with:

- State: `The current step of work.`
- Labels: `Shared tags used to organize work.`

Custom property name and description remain editable, while its type remains
immutable after creation. The value table is shared by all select variants:

- State and custom single-select show a Default column;
- Labels and custom multi-select omit Default;
- all active values are draggable;
- archived values appear in the shared compact archived section;
- row actions expose only legal operations;
- a new custom option or Label has `icon = null`;
- a new custom State also starts without an icon, while system States have
  product-owned icons;
- empty descriptions are permitted and remain visually compact.

The State Default control changes the Workspace Inbox default. Project default
State remains a Project setting and may point to any active State. A custom
single-select default is Workspace-wide and applies only to Tasks created after
the default is set. Multi-select properties have no implicit values.

Normal rows render compact values rather than permanent inputs. Edit switches
the affected row into the same semantic grid. Create, edit, and header rows use
one feature-defined grid template so columns cannot drift.

## Icon and color behavior

The shared icon registry uses stable lowercase keys mapped to statically
imported Lucide outline components. Every icon renders with `currentColor`, so
the value's selected color controls the swatch and icon consistently.

The picker provides:

- an explicit `No icon` option;
- search by key and human label;
- semantic categories such as Status, Work, Communication, People, Objects,
  Direction, and Symbols;
- pointer and arrow-key navigation, Home/End, Enter/Space selection, Escape,
  focus restoration, and visible focus;
- a harmless fallback for an unknown legacy key;
- a server-owned allowlist for new and updated values.

The initial system State presentation is fixed:

| Role          | Name        | Icon key        | Color     |
| ------------- | ----------- | --------------- | --------- |
| `todo`        | Todo        | `circle`        | `#64748B` |
| `in_progress` | In Progress | `loader-circle` | `#3B82F6` |
| `done`        | Done        | `circle-check`  | `#22A06B` |

Legacy Backlog and Canceled values receive `circle-dashed` and `circle-x`
respectively during migration, but become fully editable custom States. Other
legacy custom States receive the icon corresponding to their former group as a
one-time migration suggestion; users may then change or clear it.

## Data model

### Workspace property descriptions

`workspaces` receives two bounded text columns:

- `state_property_description`;
- `label_property_description`.

Dedicated columns are preferred to a generic system-property settings table
because Kanleaf has exactly two system property editors and their behavior is
not otherwise generic.

### State

`task_states` keeps its UUID, Workspace ownership, name, color, position,
archive, and timestamp fields. It adds:

- `icon TEXT NULL`;
- `description TEXT NOT NULL DEFAULT ''`;
- `system_role TEXT NULL`, constrained to `todo`, `in_progress`, or `done`.

`state_group` is removed. A partial unique index guarantees at most one row per
non-null semantic role in a Workspace. Database checks keep a system State
active and give it the canonical name, icon, and color shown above. Application
authorization and validation reject attempts to mutate those fields, archive,
or delete a system State. Position and description remain editable.

Tasks, Workspace Inbox defaults, and Project defaults continue to reference a
State UUID. A custom State may be a default. Removing a custom State accepts any
other active State as replacement; the former same-group restriction no longer
exists.

### Labels

`task_labels` adds:

- `icon TEXT NULL`;
- `position INTEGER NOT NULL`.

Existing Labels receive deterministic positions ordered by case-folded name
and UUID. Active positions are unique per Workspace. Labels gain the shared
reorder endpoint and remain many-to-many Task values through
`task_label_assignments`.

### Custom select options

`custom_property_options` adds:

- `icon TEXT NULL`;
- `description TEXT NOT NULL DEFAULT ''`.

`custom_property_definitions` adds nullable `default_option_id`. A deferrable
composite foreign key ties it to an option of the same Workspace and property.
It may be set only for a `single_select` definition. Archiving or permanently
deleting the selected option clears the default in the same transaction.

Select values continue to store option UUIDs in
`task_custom_property_values`; PostgreSQL never stores a selected option by its
display label.

## System State creation and migration

New Workspaces create only the three system States. Their UUIDs are random and
stable after creation. Todo is the initial Workspace Inbox and Project default.

For each existing Workspace, migration chooses one active row for each role:

1. prefer an active State whose name matches the canonical name
   case-insensitively;
2. otherwise choose the first active State in the corresponding old group by
   position and UUID;
3. if no active candidate exists, insert a new system State.

The chosen row keeps its UUID so Task and default references remain valid. Its
name, icon, and color are normalized to the system values, its description is
preserved, and its `system_role` is set. All non-selected rows keep their UUID,
name, color, order, archive state, and Task references, receive a one-time icon
from the old group, and become custom States with `system_role = null`.

After semantic roles are assigned, workflow behavior resolves them by role:

- completion totals count only Tasks whose State role is `done`;
- `include_completed = false` excludes only `done` Tasks;
- core transition actions target the three role IDs;
- default grouping changes from State Group to State;
- presentation may expose the role for styling but never infers it from name.

Canceled is no longer a special terminal category. A preserved Canceled custom
State behaves like any other custom value until an explicit future terminal
State feature is designed.

## Task Type data migration

A Workspace has meaningful Task Type data when it contains any type other than
the single protected default `Task`, including archived types. This captures
user-created vocabulary even when no current Task references it.

For a Workspace with no meaningful data:

- do not create a custom property;
- enqueue every Task for projection with `Type` in
  `cleanup_property_names`;
- remove the Task Type rows and defaults.

For a Workspace with meaningful data:

- create one custom `single_select` definition named `Type` with description
  `The kind of work this task represents.`;
- reuse every Task Type UUID as the corresponding custom option UUID;
- preserve option name, icon, color, description, position, and archive state;
- set the property's default to the former Workspace default Task Type;
- insert one custom-property value per Task containing its former Task Type
  option UUID;
- enqueue Task projection so the existing top-level Markdown `Type` key becomes
  owned by the custom property without changing its human-readable value.

Task Type names were unique only among active rows, while custom option names
are unambiguous across active and archived rows. If archived duplicates exist,
the migration keeps the active spelling and deterministically suffixes archived
duplicates with a short UUID marker. UUID references remain unchanged.

Project-specific Task Type defaults and enabled-type restrictions are removed.
Existing Tasks retain their values. Future Tasks use the Workspace-wide custom
property default when present.

After data promotion and projection jobs are durable, the migration removes:

- `tasks.task_type_id`;
- `workspaces.default_task_type_id`;
- `projects.default_task_type_id`;
- `project_task_types`;
- `task_types`;
- their indexes, foreign keys, and projection triggers.

The fixed frontmatter key `Type` is removed from the core Task renderer and
parser. It is emitted only when a custom property with that display name has a
value. `Type` is removed from the global reserved custom-property name list.

## Task creation and mutation

Task creation resolves only a State default from the Workspace or Project. It
no longer validates a Task Type or writes `task_type_id`. In the same SQL
transaction, it inserts values for custom single-select definitions that have
an active default option, unless the creation/import flow supplied an explicit
value.

Task responses and mutations remove the special `task_type` and
`task_type_id` fields. A migrated Type appears through the existing
`custom_properties` collection. Bulk mutation, move, archive, restore, and
delete behavior likewise stop validating Project Task Type availability.

State updates remain UUID-based. No calculation, query, or transition compares
the strings `Todo`, `In Progress`, or `Done`.

## API changes

`GET /api/workspaces/{workspace_id}/task-configuration` returns States, Labels,
their property descriptions, and the Workspace default State. It no longer
returns Task Types or a Task Type default.

`PATCH /api/workspaces/{workspace_id}/task-configuration` accepts State and
Labels property-description updates and the Workspace default State. Existing
State and Label routes remain domain-specific. Labels gain a reorder route.

State DTOs add `icon`, `description`, and nullable `system_role`, and remove
`state_group`. Label DTOs add `icon` and `position`. Custom option DTOs add
`icon` and `description`; custom definition DTOs add `default_option_id`.

The Task Type routes are removed rather than retained as deprecated aliases.
Unknown requests receive the normal not-found response.

Task webhook snapshots remove `task_type_id` and increment the webhook payload
version from 1 to 2. Stored version-1 deliveries remain immutable and readable;
new examples, fixtures, and documentation describe version 2.

## Saved views and queries

The task-query contract advances to version 2. The migration rewrites every
stored view before the version-1 validator is removed:

- expand each `state_groups` filter into the UUIDs of States that belonged to
  those groups and merge them with an existing State filter;
- replace State Group grouping with State grouping;
- remove Task Type filters and display fields;
- remove Task Type grouping, promote a remaining secondary grouping when
  necessary, and deduplicate grouping after State conversion;
- set `query_version` and embedded `version` to 2.

Task Type filters cannot be translated to the migrated custom property because
custom-property view filtering is intentionally outside this change. Removing
such a filter widens the affected view rather than making it invalid. The
migration is deterministic and covered by database tests.

The default All Tasks grouping becomes State. Filter, grouping, display,
keyboard, and empty-state frontend controls remove State Group and Task Type.

## Markdown projection and external sync

PostgreSQL remains canonical. Schema migration only changes structured rows and
enqueues durable projection work; it does not write vault files directly.

The fixed Task frontmatter contract removes `Type`. Projection cleanup behaves
as follows:

- all-default legacy Workspace: remove the old `Type` key;
- meaningful legacy Workspace: rewrite `Type` through the migrated custom
  property using the same visible option name;
- retry or crash: retain the projection job and recorded cleanup name until a
  revision-checked write succeeds.

External Markdown sync loads custom definitions before classifying top-level
fields. `Type` resolves as a normal custom property only where that definition
exists; otherwise it is unowned after migration and is removed by the queued
cleanup for upgraded Tasks. Unknown unrelated fields remain preserved exactly
as before.

## Portable configuration and import compatibility

New exports:

- remove Task Type defaults from Workspace and Project configuration;
- remove Task Type definitions and Project enabled-type lists;
- export State icon, description, and `system_role` instead of group;
- export Label icon and position;
- export custom-option icon and description plus single-select default IDs.

The Workspace, Task configuration, and Project format versions advance. Import
continues to accept the immediately preceding legacy versions. Legacy archives
are normalized in memory using the same rules as the live database migration:
meaningful Task Types become a custom `Type` property; protected-default-only
types disappear; State groups select the three system roles; old Task Markdown
`Type` values are consumed during normalization rather than exposed as unknown
fields.

New-format import remaps UUIDs while preserving `system_role` and validates
exactly one active State for each role. Default option IDs are remapped with
their property options. Exported display names remain ordinary top-level
Markdown fields rather than a nested JSON object.

## Authorization and errors

- Reading configuration requires Workspace membership.
- Changing property metadata, values vocabulary, defaults, ordering, archive,
  or deletion requires Workspace Admin rights.
- Editing a Task's assigned State, Labels, or custom values continues to use
  Task-location authorization.
- Server validation remains authoritative for icon keys, colors, description
  lengths, UUID ownership, protected system State fields, defaults, and reorder
  sets.
- Mutation errors remain adjacent to the affected row or form and retain
  unsaved input.

## Delivery sequence

1. Add the new columns, semantic-role constraints, Label ordering, custom
   option fields/defaults, and data migration in a new ordered migration.
2. Normalize saved views and enqueue Task/config projections in the same
   migration before removing Task Type storage.
3. Update server domain values, Task configuration, queries, task creation,
   projection, sync, portability, webhook payloads, and integration tests.
4. Expand the shared icon registry and select-option editor.
5. Adapt State, Labels, and custom-property Settings pages to the common editor
   and remove Task Type routes and UI.
6. Update current architecture, webhook, and development documentation.
7. Run focused tests, full frontend and Rust checks, migration tests against a
   populated legacy fixture, builds, and essential Playwright workflows.
8. Review the complete diff, commit focused changes, push `dev`, and monitor
   GitHub Actions to completion.

## Test strategy

### Migration and database

- fresh Workspace creates exactly three system States;
- populated legacy Workspace preserves Task and default State UUID references;
- renamed or missing legacy group candidates normalize deterministically;
- Backlog, Canceled, and other states remain custom values;
- system-role uniqueness and protected fields are enforced;
- Label positions and custom-option fields backfill deterministically;
- protected-default-only Task Types disappear and enqueue `Type` cleanup;
- meaningful Task Types preserve IDs, assignments, option metadata, archive
  state, and Workspace default;
- archived duplicate type names normalize without losing references;
- task/project/workspace Type columns and tables no longer exist;
- saved view version-1 JSON migrates to a valid version-2 query.

### Server behavior

- members can read and Admins can mutate configuration;
- non-Admins receive the existing non-disclosing authorization response;
- system State name/icon/color/archive/delete mutations fail;
- system State descriptions and all State positions can change;
- custom State deletion replaces Tasks and defaults transactionally;
- custom single-select defaults apply to new Tasks and clear safely when the
  option is archived or removed;
- Task responses, mutations, queries, events, and Markdown contain no special
  Task Type contract;
- completion calculations use `system_role = done`;
- projection cleanup and retry behavior preserve unrelated frontmatter;
- current and legacy portable archives import with stable option identities.

### Frontend behavior

- State, Labels, custom single-select, and custom multi-select render the same
  editor scaffold and aligned value rows;
- default controls appear only where supported;
- core State controls expose only description and drag interactions;
- icon search, categories, no-icon selection, color inheritance, focus,
  keyboard navigation, and Escape work;
- drag operations ignore inputs and action buttons and announce keyboard moves;
- Task Type and State Group are absent from Settings, Task detail, filters,
  grouping, display properties, and Project configuration;
- loading, empty, permission, mutation-error, archived, and responsive states
  remain accessible.

### Release verification

Run the canonical formatting, lint, typecheck, unit, integration, build, Tauri,
Playwright, and self-host checks applicable to the changed surfaces. Capture the
approved Settings pages at wide and narrow viewports for visual comparison.
After push, inspect GitHub Actions and report every workflow conclusion; a
pending workflow is monitored rather than described as successful.
