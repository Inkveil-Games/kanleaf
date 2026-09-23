# Fixed Task Properties and Task Row Design

**Date:** 2026-09-24

## Intent

Kanleaf will simplify Task property configuration and make State and Priority
visually recognizable without retaining configurable property icons.

The change has four outcomes:

1. State becomes a fixed five-value Workspace vocabulary and Priority becomes a
   fixed five-value vocabulary ending in `critical`.
2. Configurable icons disappear from State, Label, and custom select options at
   every layer. Project icon selection remains unchanged.
3. Workspace Settings has one `Task Settings` navigation item, `Properties`,
   which contains Label settings and custom property management.
4. Task rows and Task edit controls use the supplied fixed State and Priority
   SVG assets. The approved Task row is the compact B direction with final
   dimensions specified below.

## Non-goals

- Do not remove or redesign Project icons or the Project icon picker.
- Do not make State or Priority configurable through Workspace Settings.
- Do not add another icon library or a generic badge system.
- Do not change Task detail into a modal or change the existing pane hierarchy.
- Do not redesign Task cards or unrelated navigation surfaces.

## Canonical State model

Every Workspace has exactly these five active States in this order:

| System role | Name | Light | Dark | Description |
| --- | --- | --- | --- | --- |
| `backlog` | Backlog | `#727480` | `#90929F` | Ideas and unprioritized work. |
| `todo` | Todo | `#7A4DD1` | `#885CDD` | Ready to be worked on. |
| `in_progress` | In Progress | `#296DD6` | `#5896EE` | Currently being worked on. |
| `done` | Done | `#2F945C` | `#54B781` | Completed and ready to close. |
| `cancelled` | Cancelled | `#D63D3C` | `#FA8079` | Won't be completed. |

Names, roles, order, colors, descriptions, and archive status are fixed. The
database stores the light color as the canonical structured color. The frontend
uses the light/dark pairs for the fixed icon presentation.

The Workspace default State becomes Todo when its previous default cannot be
mapped. Project-level default State selection remains available because it
chooses from the fixed vocabulary rather than redefining that vocabulary.

New Workspaces create all five State rows in the Workspace creation
transaction. State create, update, reorder, archive, and delete HTTP routes are
removed so the server, rather than the Settings UI, enforces the fixed model.

## State migration

Migration `0028` will normalize every existing Workspace before strengthening
constraints:

1. Preserve the current rows carrying `todo`, `in_progress`, and `done` system
   roles as the canonical IDs for those roles.
2. For Backlog and Cancelled, reuse one active case-insensitive canonical-name
   match when available; otherwise create a new UUID.
3. Map every duplicate canonical-name State to its selected canonical State.
4. Map every other custom or archived State to Backlog.
5. Update `tasks.state_id` with that mapping.
6. Preserve Workspace and Project defaults when they map to one of the five
   canonical States; otherwise use Todo.
7. Rewrite saved-view State filter IDs through the same mapping, removing
   duplicates while preserving their first appearance.
8. Delete noncanonical State rows.
9. Normalize the five retained rows to the fixed names, roles, positions,
   colors, descriptions, and active status.
10. Replace the old three-role constraints with the five-role constraints and
    make `system_role` required.

Migration tests must cover a Workspace with canonical rows, canonical-name
duplicates, arbitrary custom States, archived States, Tasks on every category,
Workspace and Project defaults, and saved-view filters.

Current-format archive import applies the same semantic mapping while assigning
destination UUIDs: source States matching the five canonical roles or names map
to their fixed destination States, every other source State maps to Backlog, and
Workspace/Project defaults fall back to Todo. Task references are translated
through that map before insertion. This keeps archives containing custom States
importable without recreating a configurable State vocabulary.

## Canonical Priority model

Priority has these fixed values and asset colors:

| Stored/API value | Label | Color |
| --- | --- | --- |
| `none` | No priority | `#8B949E` |
| `low` | Low | `#5B9CF6` |
| `medium` | Medium | `#EAB839` |
| `high` | High | `#F28A3B` |
| `critical` | Critical | `#EF5B62` |

The migration changes every persisted `urgent` value to `critical`, updates the
Task priority constraint, and rewrites saved-view priority filters. It queues
Task projection jobs so Markdown frontmatter converges from `Urgent` to
`Critical` through the existing revision-aware projection worker.

The Rust domain enum and TypeScript union use `critical`; new APIs, exports,
events, grouping, filtering, and display labels do the same. Import and Vault
Sync accept legacy `urgent` as an alias and canonicalize it to `critical` so old
archives and existing Markdown remain importable. New output never emits
`urgent`.

## Property icon removal

The migration drops `icon` from:

- `task_states`;
- `task_labels`;
- `custom_property_options`.

The server removes these fields from response/request DTOs, SQL, validation,
portable output, and projection data. Portable config structs keep explicitly
renamed compatibility sink fields that deserialize legacy `icon` values but use
`skip_serializing` and never reach SQL. This is required because the archive
schema rejects unknown fields. Current-format export no longer emits icons.

The frontend removes icon fields from State, Label, custom option, and draft
types. Property value payloads no longer send icon data. The property-specific
icon catalog and all property icon picker code/tests are deleted. The shared
`IconPicker` remains because Project creation still uses it.

`SelectValueEditor` retains Color, Name, Description, optional Default, reorder,
archive/delete, and the approved edit popover. Its table grid no longer reserves
an Icon column. The section action and header share a layout that prevents the
Add button from overlapping column labels at supported widths.

## Workspace Settings

The Settings rail group label changes from `Task properties` to `Task Settings`.
It contains only the `Properties` destination. States and Labels are removed
from the rail and from the typed section union.

Legacy `/settings/workspace/states` and `/settings/workspace/labels` locations
canonicalize to `/settings/workspace/properties` with replace navigation so old
bookmarks do not strand the user.

The Properties page has two working areas:

1. Label settings, including property description and the shared value editor;
2. Custom properties, including Defined/Undefined lists, creation, editing,
   archive, reorder, and permanent deletion.

State and Priority do not appear on this Settings page. Label values retain
their configurable color, name, description, order, archive/delete behavior,
and no icon field.

## Fixed SVG assets

The ten supplied files move out of the untracked `uploads/` directory into a
frontend asset directory owned by Task property presentation. The final State
assets include these approved changes:

- Backlog uses seven equal-length strokes and seven equal gaps. One stroke is
  centered at the top so the odd pattern is visually balanced.
- Done is a solid circle with a transparent check cutout.
- Cancelled is a solid circle with a transparent X cutout.
- Todo and In Progress preserve their supplied geometry.

State SVG geometry is rendered as a CSS mask so the app's explicit theme, not
only the operating-system preference, controls the light/dark color. Priority
SVGs render directly rather than through a mask, preserving bar opacity and the
white exclamation mark inside Critical. All value icons are decorative and
hidden from assistive technology; their adjacent text remains the accessible
name.

Small focused components map a State system role or Priority value to its fixed
asset. They are presentation-only and contain no configurable icon registry.

## Approved Task row

The All Tasks list uses the approved B direction with these final measurements:

- row height: `50px`;
- State icon: `30px`;
- Task title: `15px`, two pixels larger than the current `13px` title;
- Priority badge: borderless, tinted with the corresponding Priority color;
- Priority content: fixed icon followed by the visible value label;
- Priority badge position: right edge of the row;
- Task number: hidden in list items;
- content: one line, with long titles truncated by ellipsis.

The existing selection checkbox, hover/selected state, keyboard semantics, and
row click target remain intact. The priority badge is metadata, not a competing
row action. `No priority` also uses its gray icon and label so every row has a
stable right-hand metadata slot.

Shared State/Priority presentation should keep equivalent list, table, board,
and grouped views consistent when those surfaces already display the values,
without redesigning their layouts.

## Task edit controls

The State and Priority controls in Task Detail show the current value's fixed
icon at the start of each trigger. Every option in the opened control uses its
corresponding icon. Changing the value updates icon and text together without
changing the existing mutation, busy, error, focus, or keyboard behavior.

## Data and API compatibility

- Existing State and Label UUID references are migrated before rows are
  removed; no Task is left with a dangling State.
- Project default-State behavior continues to validate membership in the fixed
  Workspace vocabulary.
- Old exports containing custom States, icon fields, or `urgent` remain
  importable and normalize to the fixed model.
- New exports omit property icons and emit `critical`.
- Old state-mutation endpoints intentionally become API 404s after their routes
  are removed.
- Migration and projection work stay within the existing Workspace transaction
  and projection-job boundaries; the migration does not write Markdown files
  directly.

## Testing and verification

Implementation follows test-first cycles for each boundary.

Backend coverage:

- domain parsing and serialization for `critical`, including the legacy import
  alias;
- fixed five-State Workspace creation;
- absence of State mutation routes;
- Label and custom option APIs without icon fields;
- portability import/export and Vault Sync compatibility;
- SQL migration tests for State remapping, defaults, saved views, icon-column
  removal, priority conversion, and projection-job creation;
- authorization behavior for the remaining configuration endpoints.

Frontend coverage:

- Settings rail exposes `Task Settings` with only Properties;
- legacy section URLs canonicalize to Properties;
- Label settings render and mutate within Properties;
- property value tables/popovers have no icon controls and remain accessible;
- Task rows use the approved dimensions, hide numbers, and expose State and
  Priority text accessibly;
- Task Detail triggers/options update fixed icons with State/Priority values;
- light, dark, 960×640, wide, and narrow visual checks.

Before completion, run the repository's complete applicable format, lint,
typecheck, frontend test/build, Rust fmt/Clippy/test, PostgreSQL all-features,
migration, and targeted Playwright workflows. Review the complete diff, ensure
`uploads/` and temporary demo files are not committed, commit the implementation,
push `dev`, and follow every GitHub Actions check to its terminal result.
