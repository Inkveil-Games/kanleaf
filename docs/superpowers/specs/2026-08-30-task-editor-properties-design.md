# Inline Task Properties design

## Purpose

Kanleaf currently places every structured Task field in a long metadata block
above the Markdown editor. The fields are useful, but the block reads like a
separate form and pushes the document away from the title. Task Details should
instead feel like one Obsidian-style document: compact structured properties at
the top and the Markdown body immediately below them.

This change is limited to the desktop interaction. PostgreSQL remains canonical
for structured Task data, the existing server projection continues to maintain
Obsidian-compatible YAML, and the Markdown body remains source-faithful.

## Document layout

The `Details` tab contains one visual document surface in this order:

1. Task title;
2. compact property rows;
3. an `Add property` row;
4. Markdown body;
5. subtasks and relations.

Properties and Markdown share the same background and scrolling context. A
subtle separator distinguishes the two editing modes, but there is no card,
nested panel, or separate `Markdown` heading. The Activity tab and the
existing rule that keeps the Markdown editor mounted remain unchanged.

Each property is a compact label/value row. Labels are left aligned and values
use the existing Kanleaf Select, multi-value menu, or native input appropriate
for the field. Read-only Tasks use the same layout without interactive chrome.

## Property visibility

Four properties are pinned and always visible:

- State;
- Assignee;
- Priority;
- Due date.

An extended property is visible when it has a meaningful value. This means a
Task may initially show more than the four pinned rows—for example, Type is
required and a Project Task has a Project value. Clearing an optional extended
property removes its row after the update succeeds.

The current extended catalog is:

- Type;
- Project;
- Labels;
- Start date;
- Estimate;
- Parent;
- Cycle;
- Modules.

Cycle and Modules are offered only when the Task belongs to a Project and the
corresponding Project feature is enabled. The catalog never offers a property
that is already visible or invalid in the current Task context.

Selecting an empty property from `Add property` reveals its row and moves focus
to its control. That temporary row remains while the user interacts with it. If
the user leaves it empty, it disappears without a server request. Once a value
is saved, normal value-based visibility applies. This deliberately avoids a new
per-Task or per-Workspace field-visibility persistence model.

## Add-property interaction

`Add property` is the final property row and opens the repository's existing
custom menu surface. The menu supports keyboard navigation and a compact search
input above the available properties. Selecting an item closes the menu,
inserts the property in catalog order, and focuses its editor. Escape closes the
menu and returns focus to the trigger.

The initial implementation uses only structured fields Kanleaf already owns.
Creating custom Workspace properties and selecting GitHub Projects-like data
types is a later Workspace Settings capability with its own schema and API; it
is not simulated with local-only metadata in this change.

## Data flow and consistency

Property controls reuse `TaskDetailPane`'s existing `onPatch` boundary and
`TaskPatch` payloads. No database migration, server endpoint, vault format, or
frontmatter parser change is required.

The server continues to validate each metadata change, commit it to PostgreSQL,
and project the result into the Task YAML. MarkdownDocument continues to read
and write only the body through its revision-aware endpoint. The current
frontmatter component preserves the body during projection, so property writes
and body autosave cannot overwrite one another.

Only the property being saved is disabled. A successful patch lets refreshed
Task data determine visibility. A failed patch keeps the row open, restores the
canonical Task value, and shows a concise error beneath the property area.
CodeMirror undo and redo remain scoped to Markdown source; structured property
changes do not enter the editor history.

## Permissions and accessibility

Editable Tasks expose the existing controls and `Add property`. Read-only Tasks
show the four pinned properties plus extended properties with values, but omit
`Add property` and all mutation affordances.

Every control retains an accessible label. Tab follows document order, Enter or
Space opens menu controls, Escape closes them, and visible focus uses existing
Kanleaf focus tokens. Compact rows must not reduce the effective button target
below the desktop design system's current control height.

## Implementation boundaries

The change belongs primarily in `features/task/TaskDetailPane` and its styles.
It should reuse the existing Select, ContextMenu, MultiValuePicker, TaskPatch,
and MarkdownDocument behavior. A small local property descriptor list is
appropriate if it removes repeated visibility and ordering logic; no generic
property framework or reusable package is introduced.

## Verification

React behavior tests cover:

- the four pinned rows;
- automatic visibility for populated extended properties;
- catalog filtering by visibility and Project context;
- adding an empty property and dismissing it without a request;
- correct TaskPatch payloads and visibility after setting or clearing values;
- failed writes, read-only behavior, and keyboard focus;
- preservation of the mounted Markdown editor while Activity is open.

The core Playwright workflow edits a pinned property, adds and persists an
extended property, writes Markdown, reloads, and verifies both structured data
and Markdown remain intact. Visual review covers normal, long-value, empty,
read-only, error, and narrow-detail-pane states.

## Deferred capability

Workspace-defined custom properties are intentionally separate. A future
Workspace Settings design may add property definitions with selectable types
similar to GitHub Projects. That capability must define storage, validation,
query behavior, YAML representation, import/export semantics, and Project
availability before the Task editor can include those definitions in its
catalog.
