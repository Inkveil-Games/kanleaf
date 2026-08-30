# Inline Task Properties Implementation Plan

Design source:
`docs/superpowers/specs/2026-08-30-task-editor-properties-design.md`

## Delivery strategy

Implement the approved desktop-only interaction in one capability commit after
the plan commit. Work test-first in `TaskDetailPane`, reuse its existing patch
controls, and avoid backend, migration, vault, or shared-package changes.

## 1. Define visibility and add-property behavior

Files:

- Update `apps/desktop/src/features/task/TaskDetailPane.test.tsx`.
- Update `apps/desktop/src/features/task/TaskDetailPane.tsx`.

Behavior:

- Keep State, Assignee, Priority, and Due date pinned.
- Show extended fields only while locally added or when their Task value is
  meaningful.
- Offer only hidden, context-valid extended fields through `Add property`.
- Filter the catalog through a search input and preserve keyboard/outside-click
  behavior from the existing ContextMenu.
- Hide an unsaved empty field after it loses focus; hide a cleared optional
  field after the canonical Task data confirms the update.
- Omit add/edit affordances for read-only Tasks.

Focused verification:

```text
vitest run src/features/task/TaskDetailPane.test.tsx
tsc -b --pretty false
eslint . --max-warnings 0
```

## 2. Integrate Properties with the Markdown document surface

Files:

- Update `apps/desktop/src/features/task/TaskDetailPane.tsx`.
- Update `apps/desktop/src/styles/global.css`.
- Extend `apps/desktop/src/features/task/TaskDetailPane.test.tsx` where visual
  structure has user-observable semantics.

Behavior:

- Replace the long always-visible metadata form with compact property rows.
- Place the property area and MarkdownDocument on one uncarded document
  surface with a subtle separator.
- Disable only the property currently being patched and retain its row on an
  error.
- Preserve title editing, Activity mounting, relations, subtasks, and existing
  Markdown save behavior.
- Keep long values, focus rings, menus, and a narrow detail pane usable.

Focused verification:

```text
prettier --check .
tsc -b --pretty false
eslint . --max-warnings 0
vitest run src/features/task/TaskDetailPane.test.tsx src/features/markdown
vite build
```

## 3. Prove persistence and finish the UI

Files:

- Extend `apps/desktop/e2e/core-workflow.spec.ts`.
- Update concise architecture/development documentation only if supported
  behavior described there changes.

Behavior:

- Edit a pinned property, add and persist an extended property, write Markdown,
  reload, and verify both metadata and body.
- Assert the workflow produces no failed HTTP responses or console errors.
- Visually review default, populated, add-property, long-value, read-only,
  failure, and narrow-pane states.

Final verification:

```text
prettier --check .
tsc -b --pretty false
eslint . --max-warnings 0
vitest run
vite build
playwright test
```

Review the final diff for stale metadata-form CSS, temporary screenshot code,
debug output, unrelated files, and accidental changes to Markdown source or
server contracts.

Commit: `feat(task): integrate properties with Markdown editing`
