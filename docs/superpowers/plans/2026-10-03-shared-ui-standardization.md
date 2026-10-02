# Shared UI standardization implementation plan

> **For agentic workers:** Use the frontend/product UI skills and the parallel-agent workflow for the independent file groups below. Keep integration and final verification sequential.

**Goal:** Standardize the ten UI groups approved in the independent design preview and replace their repeated implementations in real product screens.

**Architecture:** Shared controls live in `apps/desktop/src/components/ui`, with feature-owned API calls and state coordination. Extend `AppDialog` instead of introducing a competing dialog system. Use the installed Base UI Toast primitives for notification lifecycle and accessibility.

**Tech stack:** React 19, strict TypeScript, Base UI, Lucide, CSS tokens, Vitest/Testing Library, Playwright.

**Design:** The reviewed independent preview at `/tmp/kanleaf-component-design/source` (10 groups), including the corrected retry-button padding. Product copy remains English, consistent with the application.

## Global constraints

- Work directly on `dev`, as requested. Keep the preview outside the repository.
- No new dependencies, API changes, authorization changes, or routing changes.
- Keep pending actions single-flight, failed drafts recoverable, and keyboard/focus behavior accessible.
- Preserve existing feature-specific limits and permission checks.
- Delete superseded markup/CSS; do not leave a second primitive system.
- Commit and push to `dev` after the subsequently requested full verification.

## Review focus

- Pending forms must reject duplicate submissions and accidental cancellation.
- Clipboard failure must retain selectable content and expose an accessible error.
- Toast timers must respect hover/focus, and errors must remain actionable.
- Account/Workspace transitions must not display stale notifications from a previous scope.
- Compact metadata and controls must remain readable in both themes and narrow layouts.

### Task 1: Dialog and inline forms

**Files:** shared `InlineTextForm` implementation/styles/tests; `SavedViewDialog`; `InlineNameForm`; `DocumentTree`; `TaskListPane`; their adjacent tests.

**Interfaces:** Reuse `AppDialog` for saved views. `InlineTextForm` owns draft/submission/error interaction; callers supply labels, initial value, maximum length, submit/cancel callbacks and optional presentation slots.

- [x] Add failing interaction coverage for pending cancellation, rejected submissions and retained drafts.
- [x] Replace the custom saved-view modal with `AppDialog`.
- [x] Extract inline text submission, migrate Library and quick-Task forms, and remove the unused Workspace form.
- [x] Run the complete relevant component/feature test group and format changed files.

### Task 2: Status and identity primitives

**Files:** shared `InlineAlert`, `Badge`, `Avatar`, `EmptyState`, `LoadError`; Settings controls/list; account chooser/switcher; Workspace identity surfaces; Host badge and Task-property callers; adjacent tests.

**Interfaces:** `InlineAlert` accepts semantic variant, optional title, content and optional dismiss/action controls. `Badge` accepts variant, size and soft/outline appearance. `Avatar` derives readable initials with an explicit fallback. `EmptyState` accepts title/description/action; `LoadError` adds retry. Features format domain errors before passing display content.

- [x] Add meaningful accessibility/retry/initials tests before implementation.
- [x] Implement token-based primitives matching the reviewed density and retry padding.
- [x] Migrate repeated identity, metadata, error and empty markup in the assigned callers.
- [x] Run the relevant component/feature tests and report obsolete CSS to integration.

### Task 3: Search, copying and segmented selection

**Files:** shared `SearchField`, `CopyButton`, `SegmentedControl`; `IconPicker`; member search; auth/setup choices; invitation-token and webhook-copy callers; adjacent tests.

**Interfaces:** `SearchField` is a controlled input with forwarded input ref, accessible label, clear action and Escape handling. `CopyButton` accepts current text and accessible copy/success/error labels. `SegmentedControl` accepts controlled value and typed options, with disabled options and keyboard navigation.

- [x] Add failing coverage for clearing/ref focus, clipboard rejection/value changes, and disabled keyboard selection.
- [x] Implement the shared controls without changing feature ownership of filtering or remote calls.
- [x] Migrate current callers while preserving labels and selectable clipboard fallback content.
- [x] Run the relevant component/feature tests and report obsolete CSS to integration.

### Task 4: Toasts, remaining callers and verification

**Files:** shared Toast provider/API/styles/tests; Workspace-scoped provider; `WorkspaceShell` and tests; remaining notification/Task callers; `styles/global.css`; current development documentation.

**Interfaces:** Toast lifecycle uses the installed Base UI API; feature actions publish success only after successful Task creation/deletion. Existing persistent action errors use the same notification surface, with scope cleanup.

- [x] Add failing coverage for Toast semantics/lifecycle and Task mutation feedback.
- [x] Implement success/info/warning/error notifications and integrate create/delete/error flows.
- [x] Integrate the other shared primitives into remaining overlapping callers once their owners finish.
- [x] Remove obsolete styles and document the shared component entry points concisely.
- [x] Run full frontend format, typecheck, lint, tests and build with fresh output.
- [x] Review the full diff and inspect browser rendering, interaction and narrow/light/dark states.

The existing shared `Tooltip` also replaces native interactive hints in navigation, Markdown controls, Settings controls and Task layouts. Static full-text/title metadata remains unchanged.

## Verification result

- Full frontend suite: 113 files, 986 tests passed.
- TypeScript, ESLint, Prettier and production Vite build passed. Vite reports the large main-chunk warning.
- Chromium checked real shared components, Task quick creation and Saved View dialogs in a temporary harness outside the repository: light/dark, 375px width, keyboard tooltips, retained focus/drafts after failures, clipboard success/fallback, Toast F6/dismissal/hover pause and retry-button spacing. No browser exceptions or horizontal page overflow.
- Final review findings for StrictMode error replay, IME Escape and pending-input focus were fixed and rechecked.

Checks used the installed Node CLI entry points equivalent to the repository scripts because the local pnpm launcher tries to write its global store in this sandbox. No dependencies were changed.

## Full verification before push

- Rust format and Clippy (all targets/features, locked) passed.
- Rust default-feature tests: 95 passed. All-feature tests against a dedicated temporary PostgreSQL 17 container: 245 passed, including all 12 schema/migration tests; none ignored.
- The complete frontend checks passed again: format, TypeScript, lint, 986 tests and production build.
- Real-service E2E exposed a substring locator matching both the Story points input and its clear button. The test now selects the exact spinbutton within Task detail; the complete 16-test application E2E suite passed after that correction.
- The complete 8-test self-host E2E suite passed after targeting the exact policy-success status separately from the new contextual warning. Both E2E suites used isolated ports and a disposable database; the product configuration was unchanged.
- Tauri Linux release build (`--no-bundle`) and Docker Compose configuration validation passed.
