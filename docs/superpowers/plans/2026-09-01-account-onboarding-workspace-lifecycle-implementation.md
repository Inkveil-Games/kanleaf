# Account Onboarding and Workspace Lifecycle Implementation Plan

Design source:
`docs/superpowers/specs/2026-09-01-account-onboarding-workspace-lifecycle-design.md`

## Delivery strategy

Implement five dependency-ordered vertical slices. Every behavioral slice starts
with a focused failing test, observes the intended failure, adds the minimum
implementation, and reruns the focused suite before refactoring. Keep Workspace
UUIDs inside API/security/persistence boundaries and identifiers at browser/form
boundaries.

## 1. Persist setup state and Workspace identifiers

Files:

- Add migration `0018_account_setup_workspace_identifiers.sql`.
- Update `apps/server/src/domain/mod.rs` with Workspace identifier validation.
- Update `apps/server/src/auth.rs`, `account.rs`, `workspace.rs`, and
  `workspace/invitation.rs`.
- Update nearest Rust unit and SQLx integration tests.

Behavior:

- Backfill existing users to `complete`, default new users to `account`.
- Backfill collision-proof public identifiers for existing Workspaces, add the
  lifetime identifier registry, and enforce validation/non-reuse.
- Stop creating Personal Workspace state during registration.
- Add atomic account setup and setup completion endpoints.
- Create Workspaces with explicit identifiers and correct setup transitions.
- Make invitation acceptance activate the joined Workspace and complete initial
  setup.
- Preserve backward-compatible server-side identifier generation for import and
  non-UI callers that omit the new optional request field.

Focused checks:

```text
cargo test -p kanleaf-server --locked domain::tests::validates_workspace_identifiers
DATABASE_URL=... cargo test -p kanleaf-server --features postgres-tests --locked --test auth
DATABASE_URL=... cargo test -p kanleaf-server --features postgres-tests --locked --test workspaces
```

Commit: `feat(account): add durable account setup`

## 2. Add setup UI, Workspace creation flow, and password fields

Files:

- Add `components/ui/PasswordField.tsx` and behavior tests.
- Update `features/auth/AuthForm.tsx` and auth tests.
- Add focused modules under `features/onboarding`.
- Add reusable Workspace identity and invitation-composer components under
  `features/workspace`.
- Update account/workspace API adapters, types, WorkspaceControl,
  WorkspaceShell, Workspace Settings, and their focused tests.
- Add setup CSS to the existing tokenized stylesheet.

Behavior:

- Add confirm password and accessible visibility toggles.
- Route server-owned account/workspace/invite setup stages.
- Implement required/optional Skip rules from the design.
- Implement Create/Join first Workspace and recoverable invitation states.
- Auto-suggest and validate Workspace identifier without overwriting a manual
  edit.
- Replace later inline Workspace creation with the two-step create/invite
  dialog while preserving pending Markdown flush and transition ordering.

Focused checks:

```text
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/auth src/features/onboarding \
  src/features/workspace/WorkspaceControl.test.tsx
pnpm typecheck
pnpm lint
```

Commit: `feat(ui): add guided account and workspace setup`

## 3. Move canonical routes to public Workspace identifiers

Files:

- Update `app/routing/routePaths.ts` and `AuthenticatedRoutes.tsx`.
- Update `features/workspace/WorkspaceRouteScreen.tsx`,
  `workspaceRouteAdapter.ts`, and path serialization in
  `workspaceLocation.ts`.
- Update routing and Workspace transition tests.

Behavior:

- Emit `/<workspaceIdentifier>/...` for every canonical Workspace route.
- Resolve identifier to UUID only after the authenticated Workspace query
  settles; keep all child APIs UUID-scoped.
- Map UUID navigation intents back to identifiers without UUID URL fallback.
- Redirect visible legacy `/w/<uuid>/*` paths while preserving suffix, query,
  hash, and replacement history.
- Reserve and rank Host/setup/static paths safely.

Focused checks:

```text
pnpm --filter @kanleaf/desktop exec vitest run \
  src/app/routing \
  src/features/workspace/workspaceLocation.test.ts \
  src/features/workspace/WorkspaceRouteScreen.test.tsx \
  src/features/workspace/WorkspaceShell.routing.test.tsx
pnpm typecheck
pnpm lint
```

Commit: `feat(ui): route workspaces by public identifier`

## 4. Add recoverable Host Workspace deletion

Files:

- Update `apps/server/src/host.rs`, `workspace.rs`, `vault.rs`, and startup
  recovery wiring.
- Update Host, Workspace, and vault tests.
- Add `features/host/HostWorkspaceDeleteDialog.tsx`; update Host Workspace API,
  table, tests, and responsive styling.

Behavior:

- Require Host authorization, exact identifier, and current password.
- Reuse one locked trash-first permanent deletion use case for Owner and Host.
- Keep Workspace trash and typed deletion manifests on the persisted vault
  filesystem; reconcile vault state and export artifacts after crashes at
  startup.
- Add a two-stage accessible Host dialog and invalidate metadata only after
  success.
- Preserve the explicit Host no-content-access boundary.

Focused checks:

```text
DATABASE_URL=... cargo test -p kanleaf-server --features postgres-tests --locked --test host
cargo test -p kanleaf-server --locked vault::tests::workspace_trash
pnpm --filter @kanleaf/desktop exec vitest run src/features/host
```

Commit: `feat(host): allow confirmed workspace deletion`

## 5. Integrate, document, visually verify, and ship

Files:

- Update core/self-host Playwright helpers and workflows.
- Update README, current architecture/development docs where behavior changed.
- Update project-local frontend, backend, and product UI skill invariants that
  would otherwise be stale.

Behavior and checks:

- Exercise the complete registration/setup/create/invite-skip route in a real
  browser.
- Exercise public direct links, legacy redirect, and Host deletion against the
  real server and persisted vault layout.
- Inspect setup, create/invite, password, and destructive surfaces in both
  themes and relevant wide/narrow sizes.
- Run full format, typecheck, lint, frontend tests/build, Rust format/Clippy,
  workspace tests/all-features SQLx tests, both Playwright suites, Tauri build,
  Compose validation, and a real container mount/deletion check.
- Request independent review, fix all Critical/Important findings, inspect the
  final diff/status, use focused Conventional Commits, push `dev`, and confirm
  Quality plus multi-architecture container publication.

Final commits use the focused messages above plus a separate documentation/
agent-guidance commit when durable instructions change.
