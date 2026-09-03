# Workspace Settings and Custom Properties Design

## Summary

Kanleaf will make Workspace Settings one coherent application instead of a
collection of independently styled pages. The existing shell remains the only
owner of modal bounds, navigation, and content placement. Shared page, list,
action, color, icon, sorting, feedback, and empty-state primitives will replace
the repeated implementations in States, Labels, and Task types without hiding
their distinct domain rules behind a generic CRUD engine.

Workspace custom Properties will be added as a complete vertical capability.
Workspace Admins define ordered fields and select options; authorized Task
editors assign type-checked values; PostgreSQL remains canonical for structured
metadata; and each value is projected to an Obsidian-compatible, top-level YAML
property using its visible definition name. Definitions, options, and values
use stable UUIDs internally. Unowned top-level Markdown properties remain
intact, appear as raw `Undefined` fields in Task detail, and can be deliberately
adopted through a revision-checked definition flow in Workspace Settings.

The first release supports `text`, `number`, `date`, `single_select`,
`multi_select`, `checkbox`, and `url`. It does not add formulas, relations,
rollups, computed fields, custom-property filtering, or a generalized metadata
query engine.

## Repository audit findings

The current Settings foundation is useful but incomplete:

- `SettingsFrame` already owns common account, Workspace, and host settings
  bounds and navigation.
- `SettingsArticle` already provides the common header structure, but pages
  override content widths and implement sections independently.
- the recently grouped Workspace sidebar already separates General from Task
  properties and uses a shared navigation item;
- `StateSettings`, `LabelSettings`, and `TaskTypeSettings` repeat form, row,
  archived-list, action, validation, and feedback structures;
- their header, create, and data rows use unrelated grids, including responsive
  `nth-child` rules, so columns cannot remain aligned by construction;
- normal rows render primarily as permanent inputs and look like active forms;
- States and Task types expose separate up/down controls, while no sortable
  library is installed;
- all three pages use separate native color inputs;
- Task types expose a raw icon-key input;
- Project creation already has a curated Lucide registry and a hand-written
  icon picker with search, outside-click, Escape, and grid keyboard logic;
- Base UI-backed Select, Menu, Popover, and dialog conventions are already the
  product's single headless primitive system;
- TanStack Query owns remote frontend state and the feature `api.ts` modules own
  HTTP calls;
- State, Label, and Task type mutation rules already live in the server feature,
  with Workspace Admin authorization and PostgreSQL integration tests;
- structured Task metadata is canonical in PostgreSQL and projected into
  Markdown frontmatter through durable projection jobs;
- the frontmatter patcher deliberately preserves top-level YAML keys it does
  not own;
- Obsidian does not support nested properties in its normal Properties UI, so a
  nested `Properties` map would be valid YAML but a poor Obsidian experience;
- portable Workspace configuration already exports/imports States, Labels, and
  Task types through `.kanleaf/task-config.json`.

These findings favor small shared visual/interaction primitives, dedicated
domain components and server use cases, and a new Properties feature module.
They do not justify a generic settings schema renderer or a second UI system.

## Goals

- Keep every Workspace Settings route within identical shell bounds and page
  placement.
- Give States, Labels, Task types, and Properties one page/list language.
- Define each structured list's columns once for its header, create/edit row,
  and data rows.
- Make normal rows readable and compact rather than permanently form-like.
- Reuse one accessible color picker, icon picker, action menu, archived section,
  feedback state, and sortable behavior where the concepts genuinely repeat.
- Preserve all current State, Label, and Task type lifecycle and authorization
  behavior while making constraints visible before an invalid action.
- Add stable, Workspace-scoped property definitions, options, and Task values.
- Validate every custom value and option relationship on the server.
- Make custom properties usable from Task detail, not only configurable in
  Settings.
- Preserve the Markdown-first portability of Task bodies and the existing
  PostgreSQL/Markdown ownership boundary.
- Preserve unowned Markdown properties exactly, surface them without pretending
  they are typed Kanleaf data, and let Admins define them intentionally.
- Allow a permanently deleted property name to be reused without stale
  projection work deleting the new property's Markdown value.
- Keep Settings usable in the supported desktop minimum and narrower web
  viewports with keyboard and assistive technology.

## Non-goals

- Replacing State, Labels, or Task type with generic custom properties.
- A generic CRUD/table/form framework.
- A second primitive, icon, state, form, validation, or toast library.
- Rewriting Project, account, host, or unrelated Settings content.
- Adding Label ordering when the current domain has no Label position.
- Formulas, relations, rollups, computed values, date-and-time, numeric formats,
  property templates, property permissions, or conditional fields.
- Custom-property filters, saved-view predicates, list columns, bulk editing,
  automation, or an analytics/query engine.
- Automatic type inference or automatic select-option creation from undefined
  Markdown properties.
- Arbitrary uploaded icons or colors as a new asset system.
- Changing Task Markdown bodies or treating Markdown frontmatter as an atomic
  transaction participant with PostgreSQL.

## Considered approaches

### Selected: focused shared primitives with dedicated domain features

Common Settings structure and interaction become reusable components. Each
entity continues to own its data, permissions, validation, replacement,
default, protection, and archive rules. Properties use a focused backend module
and targeted Task-value endpoints.

This removes real duplication without making States, Labels, Task types, and
Properties pretend to have identical behavior.

### Rejected: schema-driven generic settings editor

A renderer configured by columns, fields, and arbitrary actions would reduce
some JSX but move domain behavior into opaque configuration. Default State,
protected Task type, replacement deletion, select options, and Task values
would quickly turn it into a large bespoke framework.

### Rejected: CSS-only alignment plus standalone Properties UI

This would improve screenshots while retaining duplicated pickers, actions,
feedback, sorting, and accessibility behavior. It would also make the new
Properties page another one-off implementation.

## Settings shell and page structure

`SettingsFrame` remains the sole owner of:

- dialog/panel bounds;
- sidebar width;
- sidebar/content grid;
- content scrolling;
- content left edge and horizontal padding;
- route-level close and return behavior.

No Workspace page creates another outer shell. Page-specific width overrides
such as the current configuration width are removed. All Workspace pages share
one content width policy: prose remains bounded to a readable measure while a
structured Settings list may occupy the available standard content width.

`SettingsArticle` is evolved as the shared page primitive rather than replaced
by a competing component. It owns:

- eyebrow/category;
- `h1` title;
- concise description and its maximum measure;
- an optional primary header action;
- the header divider;
- spacing before the first section.

General, Members, Archived Projects, Storage & backup, Danger zone, States,
Labels, Task types, and Properties therefore retain the same title X/Y position
and divider width while navigating.

The Workspace sidebar remains grouped as:

```text
GENERAL
  General
  Members
  Archived Projects
  Storage & backup
  Danger zone

TASK PROPERTIES                         +
  States
  Labels
  Task types
  Properties
```

`Properties` is a typed route section under the existing
`/w/:workspaceIdentifier/settings/workspace/:section` route. Route builders,
parsers, labels, icons, and tests are updated together. The section-level plus
button is available to Workspace Owners/Admins and opens the same property
definition dialog used by the Properties page.

## Shared Settings components

Shared components live in `apps/desktop/src/features/settings` when they are
domain-neutral. State/Label/Task type composition remains in
`features/task-config`; custom-property composition lives in a focused
`features/custom-properties` directory.

The shared concepts are:

- `SettingsSection`: consistent section heading, supporting copy, divider, and
  vertical rhythm;
- `SettingsList`: list surface, optional header, body, loading state, compact
  empty state, and archived section composition;
- `SettingsListRow` and `SettingsListCell`: semantic row/cell structure and
  visual states without knowing entity fields;
- `SettingsActionsMenu`: Base UI Menu-based overflow actions with separators,
  disabled state, destructive state, and accessible trigger labels;
- `SettingsArchivedList`: the common compact archived heading, rows, and
  Restore treatment;
- `SortableSettingsList` and `SettingsDragHandle`: one sortable integration and
  one drag affordance for all ordered Settings lists;
- `ColorSwatchPicker`: one controlled color primitive;
- `IconPicker`: one registry-driven icon primitive.

There is no component that accepts arbitrary endpoint names, field schemas, or
CRUD callbacks. Feature components remain explicit and readable.

## Settings list layout contract

Each list declares a single semantic grid template and applies it to its header,
create/edit row, and data rows. Shared CSS owns row surface, height, border,
hover, focus-within, muted text, truncation, and action placement. Feature CSS
only owns the semantic column template and genuinely unique content.

Repeated fixed columns use shared CSS custom properties for drag, swatch, icon,
and actions. Flexible columns use `minmax()` and truncate long display text
without clipping controls. A title or description exposes its full value via
the normal accessible name/title treatment where truncation occurs.

The desktop grids are conceptually:

```text
States       drag | color | name | group | default/status | actions
Labels              color | name | description            | actions
Task types   drag | icon  | color | name | description | status | actions
Properties  drag | name  | type  | status                 | actions
Options      drag | color | name                         | actions
```

Labels remain alphabetically presented because they do not have a persisted
position today. A fake drag column is not added.

Normal rows render text, swatches, icons, and compact badges. Selecting `Edit`
turns only that row into form controls in the same grid. Save and Cancel replace
the overflow menu while editing. Create rows remain visibly form-like. Property
creation uses a dialog because type-specific option configuration is too large
for a row.

At narrow widths, the same breakpoint changes header/create/data grids
together. Description yields space first; status becomes secondary metadata
within the primary cell; low-information headers may be visually hidden while
remaining accessible. Actions remain reachable. Horizontal scrolling is a last
resort below the supported desktop minimum, not the first response.

## Shared feedback and lifecycle presentation

Queries use the existing TanStack Query conventions. Mutations disable only the
affected form/row plus conflicting actions, prevent duplicate submission, and
keep a stable layout. A failure remains adjacent to the initiating row or
dialog and uses the server's structured message. Successful mutations update or
invalidate the owning feature query consistently; success toasts are reserved
for operations whose result is not otherwise visible.

Empty Settings lists use one compact pattern: a short title, one supporting
sentence, and the existing primary creation affordance. They do not use large
illustrations or dashboard cards.

Archived entities are shown in a consistent secondary section below the active
list. Restore places an ordered entity at the end of active order. Existing
values that reference an archived entity remain readable.

## Color system

`ColorSwatchPicker` is the only user-selectable color control for States,
Labels, Task types, and custom select options. It is controlled and supports:

- normalized uppercase `#RRGGBB` values;
- disabled state;
- a context-specific accessible label;
- a 32–36px trigger with a 16–20px visible swatch;
- Base UI Popover focus management, Escape, and outside interaction;
- a centrally defined, theme-compatible palette organized by semantic color
  families;
- keyboard selection and visible focus;
- a secondary custom-hex input and native color affordance;
- text/check indication of the selected color so selection is not conveyed by
  color alone.

Palette values are centralized. Product surface colors continue to use design
tokens; user-authored swatch values are the intentional exception.

New States receive a suggested palette value based on semantic group. The
create form tracks whether the user explicitly changed color. Changing group
updates the suggestion only while color remains untouched. Existing State
colors are always treated as explicit and never change implicitly.

## Icon system

The existing Project icon registry becomes the foundation for one curated
Lucide registry/resolver. The shared `IconPicker` accepts the allowed registry,
current stable key, accessible label, disabled state, and change callback. It
provides grouped icons, search, pointer selection, arrow-key navigation,
Enter/Space selection, visible focus, Escape, outside interaction, and focus
restoration through Base UI Popover.

Project creation is migrated to this picker so Task type does not introduce a
second implementation. Task types use a curated superset that includes the
current seeded and legacy keys. One resolver supplies a harmless fallback for
an unknown stored key; a bad legacy value cannot crash Settings or Task detail.
New and updated icon keys are validated against the server-owned allowlist.
Existing unknown values remain readable and can be replaced, rather than making
the whole record uneditable.

## Sorting

Ordered Settings collections use the current `@dnd-kit/react` API and its small
array helper rather than hand-written pointer/keyboard infrastructure. The
dependency is justified by four concrete lists: States, Task types, property
definitions, and select options.

The shared sortable layer provides vertical pointer sorting, keyboard sorting,
Escape cancellation, a consistent drag handle, movement announcements, visible
drag/focus states, and mutation rollback on error. Inputs and action controls do
not initiate dragging. The complete ordered active-ID set is sent to the
existing style of server reorder endpoint. Archived rows do not participate.

The old separate State and Task type up/down implementations are removed. A
screen-reader-accessible action remains available through the drag handle's
keyboard behavior rather than a second visual ordering system.

## States

States use the common header copy: “Define the steps work moves through.” The
active list uses the State grid for header, create, edit, and display rows.

Display rows show:

- drag handle;
- compact color swatch;
- name;
- human-readable semantic group;
- `Inbox default` and applicable default/protection metadata;
- overflow actions.

The action menu contains only legal actions, including Edit, Make inbox
default, Archive, and Delete where applicable. Project defaults remain a
Project setting; the Workspace page does not pretend to replace every Project
default. Archive/delete constraints and replacement selection remain enforced
by the existing server use case and are explained in the confirmation dialog.
Invalid default/protected actions are disabled or omitted before submission,
but server validation remains authoritative.

## Labels

Labels use the common header copy: “Create a shared vocabulary for organizing
work.” Header, create, edit, and display rows share the Label grid and the
common picker/actions/feedback styles.

Display rows show color, name, description, and actions. Editing supports name,
description, and color. Archive/restore behavior remains supported. Permanent
deletion explicitly confirms that assigned Labels will be removed from Tasks;
the existing transactional projection behavior remains authoritative. Label
ordering is not added.

## Task types

Task types use the common header copy: “Define the kinds of work your workspace
tracks.” Header, create, edit, and display rows share the Task type grid.

The raw icon-key input is removed. Create and edit use `IconPicker`; display
uses the central resolver. The status cell shows `Workspace default`,
`Protected`, and applicable archived/default information as compact metadata.
Protected Task types never expose an action that the server cannot perform.
Deletion with replacement and current Project/default cleanup rules remain in
the owning server use case.

## Property definitions

The new migration adds three Workspace-scoped tables.

### `task_property_definitions`

- `id UUID`;
- `workspace_id UUID`;
- `name`;
- `property_type` constrained to the seven initial stable string values;
- `description`;
- `position`;
- `configuration JSONB NOT NULL DEFAULT '{}'`, constrained to an object;
- `archived_at`, `created_at`, and `updated_at`;
- composite identity/foreign-key support matching existing tenant tables.

Names are unique case-insensitively across all active and archived definitions
in one Workspace. Creation also rejects every fixed Kanleaf frontmatter key and
every currently discovered unowned top-level key, including values not shown in
the normal Task UI. This is stricter than active-only State/Label names because
the visible definition name is also the Markdown key. Permanent deletion
releases the name for immediate reuse.

Property type is immutable after creation. Type conversion is not silently
attempted. The initial configuration object is empty for every supported type;
select options remain normalized rows instead of embedded JSON. The column is a
versioned extension point, not a license for untyped arbitrary settings.

### `task_property_options`

- `id UUID`;
- `workspace_id UUID`;
- `property_id UUID`;
- `name`, normalized hex `color`, and `position`;
- `archived_at`, `created_at`, and `updated_at`;
- composite foreign keys proving Workspace and property ownership.

Options exist only for single- and multi-select definitions. Names are unique
case-insensitively across active and archived options for a property so a
Markdown value always resolves unambiguously.

### `task_property_values`

- `workspace_id UUID`;
- `task_id UUID`;
- `property_id UUID`;
- `value JSONB NOT NULL`;
- `created_at` and `updated_at`;
- primary key `(workspace_id, task_id, property_id)`;
- composite foreign keys to the Task and definition.

This is one row per Task/property, not one schema column per custom field.
Workspace/Task deletion cascades remain a database safety net. Interactive
property deletion uses an explicit transaction that identifies affected Tasks,
clears values, records the change, and enqueues their projections.

## Value contract and validation

The wire/storage value is untagged because the definition is the discriminator:

| Property type   | JSON value               | Validation                                   |
| --------------- | ------------------------ | -------------------------------------------- |
| `text`          | string                   | trimmed length limit; empty clears the value |
| `number`        | JSON number              | finite integer or decimal                    |
| `date`          | `YYYY-MM-DD` string      | valid calendar date                          |
| `single_select` | option UUID string       | exactly one option owned by the property     |
| `multi_select`  | unique option UUID array | every option owned by the property           |
| `checkbox`      | boolean                  | strict boolean, not truthy strings/numbers   |
| `url`           | string                   | valid absolute HTTP or HTTPS URL             |

The Rust feature converts `serde_json::Value` into a typed internal enum after
loading and locking the definition. URL parsing uses the maintained `url` crate
rather than a handwritten parser. Size/count limits apply before persistence.
Empty text, date, URL, single selection, or multi selection clear the row;
explicit `false` remains a valid stored checkbox value.

The server authorizes the Task location before looking up the property or
returning ownership/type detail. It validates Workspace ownership, property
lifecycle, option ownership, option lifecycle, and value type inside the owning
transaction. A property/option from another Workspace or property is rejected
without disclosure.

## Property lifecycle

Workspace Owners/Admins manage definitions and options. Workspace members with
effective write access to a Task manage its values.

Archiving a property preserves all values. A Task with a value continues to
show the field with an `Archived` indication and a Clear action, but no new
value can be assigned until restore. An archived empty property is absent from
the Task property catalog. Restore appends it to active order.

Archiving an option preserves existing selections and display. It cannot be
newly selected. Restore appends it to option order.

Permanent property deletion uses two confirmation stages: impact summary, then
exact property-name entry. The server locks the Workspace, rechecks the exact
name, gathers affected Task IDs, deletes their values and the definition in one
transaction, enqueues removal of the old Markdown key, and releases the name.
The field disappears rather than leaving a displayed `None` row. A later
definition may immediately reuse that name.

Projection cleanup is durable and value-aware. Each affected Task projection
job carries the old property names it must remove; coalescing jobs unions these
cleanup names. The projector removes queued old keys first and then writes the
current canonical property values. Therefore a newly created property that
reuses the same name wins even if an older deletion projection has not run yet.
Cleanup metadata is removed only with successful projection. Pending cleanup
keys are treated as owned stale data, not as undefined-name collisions.

Permanent option deletion uses the same two stages. For single select, affected
Task values are cleared. For multi select, only the deleted UUID is removed;
an empty resulting selection clears the value row. Other selections remain.
The operation gathers and projects every affected Task. No orphaned JSON option
reference remains.

## Properties Settings page

The Properties route uses the same page and list system, with description “Add
custom fields for structured Task information.” The page header owns a
`New property` button. `Defined` and `Undefined` views keep configured fields
distinct from unowned Markdown. The Defined list shows ordered active
definitions as name, readable type, lifecycle/usage metadata, and overflow
actions. Archived definitions use the shared archived section. The Undefined
list is an on-demand Workspace scan grouped case-insensitively by raw property
name and shows only the name and affected Task count until the user chooses to
define it.

Create and Edit use the established Settings dialog pattern. Create contains:

- Name;
- Type Select;
- optional Description;
- only the configuration relevant to the selected type;
- a shared option editor for single/multi select;
- Cancel and Create actions with stable pending/error behavior.

Typing a name already present in the current Undefined inventory does not
create a competing definition. The dialog changes to the Define flow and asks
the user to review the discovered field instead. A normal create/rename that
collides with an undefined field outside the current preview fails with a
structured conflict and prompts a refreshed scan.

Edit keeps Type read-only and permits name, description, and select options.
`SelectOptionEditor` is one custom-property component used by both select types.
It composes the shared Settings option grid, sortable behavior,
`ColorSwatchPicker`, inline option editing, validation, and action menu. It is
not duplicated for single and multi select.

Undefined rows expose `Define property`. That action opens a deliberate
definition dialog with the existing name locked, a manually chosen type, an
optional description, and manually entered select options when applicable. No
type or option is inferred. Text adoption stringifies parsed scalar, list, and
mapping values; lists and mappings use compact JSON text. Other types must
validate every discovered value before apply. Single-select options must cover
all raw scalar names and multi-select options must cover all raw list entries.
An incompatible set blocks the operation without partially adopting values.

## HTTP API

The server adds a focused `custom_property` feature and nests routes below the
existing authenticated Workspace/Task routers.

Definitions:

```text
GET    /api/workspaces/:workspace_id/properties
POST   /api/workspaces/:workspace_id/properties
PATCH  /api/workspaces/:workspace_id/properties/:property_id
POST   /api/workspaces/:workspace_id/properties/reorder
DELETE /api/workspaces/:workspace_id/properties/:property_id
```

Options:

```text
POST   /api/workspaces/:workspace_id/properties/:property_id/options
PATCH  /api/workspaces/:workspace_id/properties/:property_id/options/:option_id
POST   /api/workspaces/:workspace_id/properties/:property_id/options/reorder
DELETE /api/workspaces/:workspace_id/properties/:property_id/options/:option_id
```

Undefined discovery and adoption:

```text
POST   /api/workspaces/:workspace_id/properties/discovery
GET    /api/workspaces/:workspace_id/properties/discovery/:operation_id
POST   /api/workspaces/:workspace_id/properties/discovery/:operation_id/define
DELETE /api/workspaces/:workspace_id/properties/discovery/:operation_id
```

Task values:

```text
PUT    /api/workspaces/:workspace_id/tasks/:task_id/properties/:property_id
DELETE /api/workspaces/:workspace_id/tasks/:task_id/properties/:property_id
GET    /api/workspaces/:workspace_id/tasks/:task_id/properties/undefined
```

The definition list includes active and archived definitions/options plus
Task-usage counts required for status and deletion warnings. Admin-only
configuration controls are determined from existing Workspace role data, not a
client-only assumption.

`TaskResponse` adds a compact ordered array of `{ property_id, value }`. It does
not repeat names/types/options on every Task. A separate TanStack Query entry
loads Workspace definitions after fresh Workspace access succeeds; Task detail
joins values to that cache. The Task-scoped undefined endpoint reads only that
authorized Task's frontmatter and returns unowned names plus parsed raw values;
it does not persist them. Feature API modules own all endpoint calls and
invalidation.

Definition creation may include initial select options and commits them with the
definition. Reorder requests carry the complete active ordered ID set and use
the established Workspace-lock pattern. Structured Conflict/Validation errors
replace raw database errors.

Discovery reuses the existing expiring `workspace_operations` preview model.
The stored preview records each matching Task ID, parsed raw value, metadata
version, and Markdown source revision. Apply requires both operation revision
and exact property name, then rechecks every Task/database/file revision before
creating the definition and typed values in one database transaction. A changed
Task makes the preview stale; the user refreshes instead of overwriting an
Obsidian edit. The response never includes Task bodies or unrelated properties.

## Task detail integration

The current Task property surface retains pinned system fields and its existing
system-property catalog. Custom property definitions are appended as a clearly
labeled Custom section, ordered by definition position.

Active custom properties with values are shown. Empty active properties can be
revealed from Add property. Archived properties appear only when the Task still
has a value. Unowned top-level fields from that Task's Markdown are appended as
read-only raw values with an `Undefined` badge. Workspace Owners/Admins also see
`Define property`; it flushes pending Markdown through
`DocumentSaveCoordinator` and navigates with the typed router to
`/w/:workspaceIdentifier/settings/workspace/properties?define=<property-name>`.
Refresh preserves the dialog; closing it removes only the query parameter.
Controls for defined properties are:

- text input for text;
- numeric input for number;
- native date input for date;
- Base UI Select for single select;
- the existing/refactored multi-value menu pattern for multi select;
- semantic checkbox control for checkbox;
- URL input while editing and safe external link presentation where useful.

Each property saves independently through the targeted value endpoint, disables
only itself, preserves the last server value on failure, and reports the
structured error next to the property area. Custom-property cache keys include
Workspace identity and are not read before fresh access validation.

Custom properties are not added to Task list columns, bulk update, filters, or
saved views in this release.

## Markdown and Obsidian contract

Nested YAML is deliberately not used because Obsidian's normal Properties UI
does not support nested properties. Each stored custom value is projected as a
top-level property using the definition's display name directly:

```yaml
Impact: High
Story points: 3
Due for review: 2026-09-10
Approved: true
Platforms:
  - Web
  - Desktop
Customer URL: https://example.com
```

This produces normal Obsidian text, number, date, checkbox, and list properties.
Obsidian has no native select-option or URL property type, so single select and
URL remain text there. PostgreSQL UUIDs retain stable identity across a rename;
the visible Markdown key intentionally follows the current display name.

The frontmatter renderer safely quotes dynamic YAML names/values. Projection
owns only fixed keys, currently defined names, and durable old-name cleanup keys
attached to the Task's projection job. All other top-level YAML, source body,
newline style, and safe formatting remain preserved exactly. Property creation
rejects fixed system keys including `Kanleaf ID`, `Reference`, `Title`,
`Project`, `State`, `Type`, `Priority`, `Assignees`, `Labels`, `Cycle`,
`Modules`, `Start date`, `Due date`, `Estimate`, and `Parent`. The reserved set
is shared by validation, discovery, projection, import, and tests.

A top-level key that is neither fixed nor matched case-insensitively to an
active/archived definition remains unowned. Kanleaf preserves it, exposes its
parsed raw scalar/list/mapping in the owning Task detail with an `Undefined`
badge, and includes its name/count in the Settings discovery preview. It is not
automatically written, cleared, typed, or inserted into PostgreSQL. Mappings and
other values Obsidian renders as raw data remain raw until a user explicitly
defines the field.

PostgreSQL stores property and option UUIDs. Markdown stores human-readable
property and option names as a portable projection. Definition/option rename
collects affected Tasks and projects the new names. Workspace-wide uniqueness
makes reverse lookup unambiguous.

Vault Sync recognizes current definition names and validates external edits
against their types:

- missing previously stored key clears the value;
- valid changed values update PostgreSQL and are reprojected canonically;
- unknown property names are preserved and surfaced as Undefined rather than
  treated as invalid;
- invalid types, unknown/foreign options, duplicate multi-select values, and
  newly assigned archived definitions/options produce a non-destructive sync
  issue;
- clearing an archived value remains allowed;
- malformed custom values never partially update the Task or leak raw parser or
  database details.

## Portable configuration and import

`.kanleaf/task-config.json` advances to a version that includes property
definitions and options with stable source UUIDs, types, descriptions,
positions, configuration, colors, and archive state. Older configuration files
without properties continue to import as an empty custom-property set under
their old version contract.

Import validates names, types, configuration, option ownership, positions, and
uniqueness before changing canonical data. It remaps definition and option UUIDs
alongside existing State/Type/Label maps, inserts definitions/options before
Tasks, and resolves each matching top-level frontmatter value against the
imported configuration. Unmatched fields remain untouched and Undefined.
Export/config projection triggers include definition and option changes. Task
values remain in Task Markdown and are not duplicated into the Workspace
configuration file.

## Authorization and isolation

- Workspace membership is required to list definitions needed for Task detail.
- Workspace Owner/Admin is required for definition, option, archive, reorder,
  restore, and permanent-delete operations.
- Task-value mutation first resolves and authorizes the Task's Workspace and
  effective Project access, then validates the property.
- Every SQL statement includes Workspace scope or uses a composite tenant
  foreign key.
- Option UUIDs are accepted only when they belong to the selected property and
  Workspace.
- Unauthorized, missing, and cross-tenant identities follow existing
  non-disclosing error behavior.
- Frontend filtering is presentation only and never the authorization boundary.

## Errors and destructive confirmations

Domain errors use concise actionable messages, including:

- `A property already uses this name.`
- `This name is already present in Task Markdown. Define that field instead.`
- `A Task changed after this property preview. Refresh and try again.`
- `This value must be a number.`
- `Select an option from this property.`
- `This option belongs to another property.`
- `Restore this property before assigning a new value.`
- existing State/default and Task type/protection messages.

Delete dialogs show the current usage count and exact consequence. Property and
option permanent deletion require a second exact-name confirmation. State and
Task type replacement dialogs retain their current replacement semantics.
Label deletion confirms assignment removal. Destructive menu entries are
separated and styled consistently.

## Accessibility and responsive behavior

Shared primitives use semantic buttons, lists/tables where applicable, labeled
form controls, visible focus, and deterministic tab order. Icon-only triggers
receive entity-specific labels such as `Change color for Homework`, `Change
icon for Bug`, and `Actions for In Progress`.

Base UI owns menu/popover dismissal, Escape, outside interaction, collision,
and focus restoration. Color and status are always accompanied by text,
selection markers, or accessible labels. Sorting exposes keyboard instructions
and live movement results. Dialogs have labeled titles/descriptions, initial
focus, error focus, and submit lockout.

Visual QA covers the supported desktop minimum, a narrower web viewport, and a
large viewport with empty, one-row, many-row, long-name, long-description,
archived, loading, saving, validation, and server-error states. States, Labels,
Task types, and Properties are captured at the same viewport and compared for
identical content/header/divider placement and shared control styling.

## Testing strategy

Behavior is developed test-first in dependency-ordered slices.

Frontend component tests cover:

- ColorSwatchPicker open, palette/custom change, keyboard use, Escape,
  disabled state, focus restoration, and accessible labels;
- IconPicker search, selection, keyboard use, Escape, unknown fallback, and the
  migrated Project consumer;
- action menu commands, destructive separation, and disabled items;
- sortable pointer/keyboard result, cancellation, disabled state, and rollback;
- common Settings page/list/header/empty/archived semantics;
- route parsing/navigation for Properties;
- create/edit/archive/restore/delete and validation behavior on all four pages;
- State default/group/color suggestion behavior;
- Task type protected/default and icon behavior;
- Property dialog type-specific fields and shared option editor;
- Task detail controls for every property type, archived values, pending/error,
  and cache-access gating;
- raw Undefined values, admin-only Define actions, typed routed dialog state,
  refresh/close behavior, and pending-save coordination.

Rust unit/integration tests cover:

- property/type/name/color/configuration/value domain validation;
- definition/option CRUD, uniqueness, reorder, archive/restore, and admin
  authorization;
- Task value set/clear for all seven types;
- exactly one single-select option and multiple unique multi-select options;
- cross-property/cross-Workspace option rejection;
- Task/Project permission denial and non-disclosure;
- deletion impact and transactional value cleanup semantics;
- immediate deleted-name reuse while an older cleanup projection is pending;
- undefined discovery grouping, fixed/defined/archived name collisions,
  operation revision checks, manual conversion, and all-or-nothing adoption;
- State, Label, and Task type behavior retained during UI/API refactoring;
- frontmatter render/read/patch preservation and collision behavior;
- valid/invalid external Vault Sync;
- export/import round trips and old-format compatibility;
- schema tenant constraints and cascades.

Playwright covers the essential real workflow: create each representative
property class, assign values in Task detail, reload/deep-link, observe Markdown
sync through the self-host boundary, archive/restore, and delete a referenced
select option/property with the approved consequences.

## Delivery sequence and commits

Work is split into focused commits with fresh relevant checks after each:

1. `refactor(settings): unify structured settings primitives`
2. `feat(settings): improve task configuration editors`
3. `feat(properties): add workspace property definitions`
4. `feat(properties): add task values and markdown sync`
5. `feat(ui): add custom properties to task detail`
6. `test(properties): cover custom property workflows`
7. a documentation commit only if architecture/guidance changes cannot remain
   focused in the relevant feature commit.

Exact grouping may combine inseparable migration/API tests, but unrelated
product work is never included. Every batch reviews status and full diff before
staging.

## Durable project guidance

After implementation, current architecture documentation and the relevant
project-local frontend/backend/UI skills are updated only with durable rules:

- structured Settings lists use shared row/list primitives;
- one grid definition governs header/create/edit/data rows;
- all user-selectable Settings colors use ColorSwatchPicker;
- icon selection uses the shared registry/picker with a safe resolver;
- single- and multi-select configuration shares SelectOptionEditor;
- system Task metadata remains dedicated domain behavior;
- custom property IDs/options are stable database identities and Markdown names
  are a human-readable projection.
- unowned top-level Markdown fields remain raw and are adopted only through a
  revision-checked explicit Define flow;
- property projection jobs carry durable old-key cleanup so deleted names can
  be reused safely.

The final diff explicitly reports every agent-guidance change.

## Definition of done

The work is complete only when:

- States, Labels, Task types, and Properties use the approved shared system;
- no duplicate picker/action/sortable implementation or raw Task type icon key
  field remains;
- all seven property types can be defined and used on Tasks;
- backend validation and Workspace/Project isolation tests cover negative cases;
- archive/delete/value cleanup and Markdown projection are transactional where
  PostgreSQL permits and safely compensated/projected across the filesystem;
- undefined Markdown fields remain visible/preserved, can be explicitly defined
  without racing file edits, and never become definitions through inference;
- a permanently deleted name is reusable before old cleanup jobs drain, with
  the current canonical value winning projection;
- new and old portable Workspaces validate/import correctly;
- frontend format, typecheck, lint, tests, production build, and Tauri check
  pass;
- Rust format, clippy, unit, and PostgreSQL tests pass;
- Compose validation passes;
- Playwright and self-host tests pass against disposable databases/vaults;
- visual comparison at common viewports confirms stable page placement and
  coherent row/control styling;
- the complete diff contains no magic alignment margins, duplicated settings
  CSS, dead code, debug logging, accidental TODOs, or unrelated changes;
- all logical commits are recorded and the final worktree is clean.
