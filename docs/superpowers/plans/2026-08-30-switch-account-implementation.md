# Switch Account Implementation Plan

Design source: `docs/superpowers/specs/2026-08-30-switch-account-design.md`

## Delivery strategy

Implement the feature as four vertical commits. Each commit must format, lint,
typecheck, and pass its focused tests. The final commit must also pass the full
frontend suite, production build, Playwright workflow, and visual review.

## 1. Add the versioned account session registry

Files:

- Add `apps/desktop/src/features/auth/accountSessionStore.ts`.
- Add `apps/desktop/src/features/auth/accountSessionStore.test.ts`.
- Replace the single-token implementation in
  `apps/desktop/src/features/auth/storage.ts` with compatibility exports backed
  by the registry where needed during migration.

Behavior:

- Parse only version `1` documents with structurally valid server and account
  entries.
- Normalize server URLs consistently with the existing server configuration.
- Keep immutable helpers for add/update, activate, remove one, and clear all.
- Order accounts by descending `last_used_at` while keeping identity keyed by
  user ID.
- Read the legacy token as a provisional active session until `/api/session`
  supplies its user metadata.
- Recover safely from malformed JSON or unavailable local storage.

Focused verification:

```text
vitest run src/features/auth/accountSessionStore.test.ts
tsc -b --pretty false
eslint . --max-warnings 0
```

Commit: `feat(auth): add account session registry`

## 2. Add the Markdown save transition barrier

Files:

- Add `apps/desktop/src/features/markdown/DocumentSaveCoordinator.tsx`.
- Add `apps/desktop/src/features/markdown/DocumentSaveCoordinator.test.tsx`.
- Update `apps/desktop/src/features/markdown/MarkdownDocument.tsx`.
- Extend `apps/desktop/src/features/markdown/MarkdownDocument.test.tsx`.
- Wrap the application with the coordinator in
  `apps/desktop/src/app/providers.tsx`.

Behavior:

- A loaded writable Markdown document registers one async flush callback while
  mounted.
- Flush waits for the existing save chain and reports failure instead of
  allowing account transition.
- Conflict and network-error states expose retry, copy local source, and
  discard/reload actions.
- Autosave and Ctrl/Cmd+S retain their current behavior.
- Read-only documents do not register a blocking save operation.

Focused verification:

```text
vitest run src/features/markdown/DocumentSaveCoordinator.test.tsx src/features/markdown/MarkdownDocument.test.tsx
tsc -b --pretty false
eslint . --max-warnings 0
```

Commit: `feat(markdown): guard identity transitions`

## 3. Implement multi-account orchestration and authentication reuse

Files:

- Add `apps/desktop/src/features/auth/useAccountSessions.ts` and tests.
- Extract `apps/desktop/src/features/auth/AuthForm.tsx` from `AuthScreen.tsx`.
- Add `apps/desktop/src/features/auth/AddAccountDialog.tsx`.
- Add `apps/desktop/src/features/auth/AccountChooser.tsx`.
- Update `apps/desktop/src/features/auth/AuthScreen.tsx` and its tests.
- Update `apps/desktop/src/app/App.tsx` and `App.test.tsx`.

Behavior:

- Restore and validate only the active account at startup.
- Migrate a valid legacy session into the registry.
- Add login and registration sessions without storing passwords.
- Validate a selected account before switching.
- Await the Markdown save coordinator before switch or sign-out.
- Remove a selected account only for a confirmed `401`; retain it for network
  failures.
- Clear TanStack Query data and remount the authenticated shell only after a
  committed identity transition.
- Replace duplicate-user sessions and attempt to revoke the previous token.
- Keep an added account inactive when Markdown blocks the transition.
- Support sign out current and best-effort sign out all.
- Synchronize current profile metadata back into the registry.

Focused verification:

```text
vitest run src/features/auth src/app/App.test.tsx
tsc -b --pretty false
eslint . --max-warnings 0
```

Commit: `feat(auth): support multiple signed-in accounts`

## 4. Add the sidebar account switcher and finish the workflow

Files:

- Add `apps/desktop/src/features/account/AccountSwitcher.tsx` and tests.
- Update `apps/desktop/src/features/workspace/WorkspaceNavigation.tsx`.
- Update `apps/desktop/src/features/workspace/WorkspaceShell.tsx`.
- Update `apps/desktop/src/styles/global.css`.
- Extend `apps/desktop/e2e/core-workflow.spec.ts`.
- Update architecture/development documentation only where supported behavior
  or commands change.

Behavior:

- Replace the footer account row and three-dot menu with one upward-opening
  account switcher.
- Render retained accounts, active state, transition state, add account,
  account settings, sign out current, and conditional sign out all.
- Keep the popover compact and aligned with the 286-pixel workspace switcher.
- Preserve focus, Escape/outside-click behavior, long-content truncation, and
  narrow-window usability.
- Cover two distinct users, preserved sessions after reload, Markdown save
  before switching, and workspace isolation in Playwright.

Final verification:

```text
prettier --check .
tsc -b --pretty false
eslint . --max-warnings 0
vitest run
vite build
playwright test
```

Visually review expanded sidebar, open switcher, add-account dialog, account
chooser, transition/error states, long account names, and a 960-pixel window.
Search the diff for stale single-session labels, obsolete account-menu CSS,
debug output, scaffold remnants, and unhandled token logging.

Commit: `feat(ui): add sidebar account switcher`
