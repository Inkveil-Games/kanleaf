# Task View and Library Shell Cleanup Design

## Scope

Refine the existing Task collection and Library document surfaces without
changing their route, authorization, API, or persistence ownership. The work
removes redundant navigation-echo headings, completes exposed Task grouping and
Table editing behavior, improves responsive controls and selection contrast,
and fixes app-level focus modality handling. The circular Task-selection
checkbox remains out of scope.

## Task query and grouping

`TaskQuery` remains the single persisted view-configuration model. Newly
created queries default to primary grouping by `state`, no secondary grouping,
and display `state`, `priority`, `assignees`, and `due_date`. Existing Saved
View queries are consumed unchanged; there is no migration or layout-specific
display schema. Optional properties such as Labels and Updated remain available
through the existing Properties menu.

`buildTaskGroups()` remains the source of grouping semantics. A small nested
group projection will compose primary and secondary results for both List and
Table rendering. This preserves distinct State and State group behavior,
no-value groups, and multi-value membership without field-specific layout
engines.

## Task collection shell and toolbar

`TaskListPane` will expose its collection or Saved View name through an
accessible section name while removing the visible eyebrow/title header. New
Task moves onto the Search row as a normal icon-and-label action that compacts
to an icon with an accessible label and tooltip only when the collection
container is narrow.

The collection pane becomes an inline-size container. Toolbar controls expose
icon and full text at normal widths and intentionally hide the text at defined
container thresholds, preserving accessible labels, tooltips, and open states.
The List-only width and Save-button truncation rules are removed. A shared
collection gutter aligns Search, toolbar, group headings, List rows, and Table
leading content.

## Table and property controls

Table will render the same primary and secondary groups as List. Group heading
rows span the active columns and carry correct counts. Flat rendering remains
when grouping is disabled.

State, Priority, Assignees, and Due use the established Task property semantics
and the existing Task patch callback. Shared property presentation metadata
owns the property labels, icons, and priority/state options needed by both the
pinned properties and Table. The existing multi-value picker and native date
input behavior will be made reusable in Table cells, including empty values and
clear operations. Task edits do not change `TaskQuery`, so Saved View
configuration dirtiness remains separate.

The Table remains dense and scrollable, with a flexible Task column, compact
State/Priority/Due columns, a medium Assignees column, subtle row separators,
and controls that read as data until hover or focus.

## Library shell

The visible Workspace/Project + Library tree header is removed. The tree keeps
its accessible name and places New Library note as a compact inline affordance
near the tree content without reserving a header-height band.

`DocumentDetail` removes the visible Library note/title heading and persistent
Location/Parent metadata bar. A document-shell action row remains separate from
the Markdown editor toolbar and contains Back where required, Move to…, Archive,
and an overflow menu. Delete lives in the destructive overflow section and
delegates to `DocumentWorkspace`'s existing delete candidate and confirmation.
Archive keeps its existing confirmation flow.

Move to… is one disclosed operation with local location and parent drafts. It
submits one existing document patch, resets invalid parent choices when the
location changes, and filters out the document and its descendants. Available
projects continue to respect current edit roles. Moving to a scope whose parent
documents are not authorized or loaded offers the safe root destination rather
than widening document access. The file path may appear as secondary overflow
information.

## Shared selection and focus behavior

Base UI checkbox menu items receive one shared, non-interactive selection
indicator rather than feature-owned checkbox imitations. Semantic control
tokens cover unchecked border, checked background/glyph, selected row, focus,
and disabled contrast in both themes.

A single app-level input-modality listener records pointer versus keyboard
navigation on the document root. Modifier-only Meta/Super, Control, Alt, and
Shift events do not activate keyboard focus presentation. Tab and relevant
navigation keys do; pointer input clears it. Existing `:focus-visible`
semantics remain, with tokenized focus styling gated by the modality state so
Base UI keyboard operation is preserved. Search uses the same subtle,
non-layout-shifting focus treatment as other inputs.

## Testing and verification

Testing Library coverage will exercise accessible naming after header removal,
fresh defaults, List and Table nested grouping, all exposed group fields,
Table property editing including empty values, Saved View configuration
separation, document Move/Archive/Delete ownership, shared menu checkbox
keyboard behavior, and Meta-versus-Tab modality changes. Existing Task and
Library tests will be updated rather than duplicated.

Verification includes focused Vitest runs, formatting, lint, TypeScript,
the full frontend unit suite, production build, relevant Playwright coverage,
rendered responsive/theme inspection, final diff review, push to `origin/dev`,
and required GitHub Actions monitoring.
