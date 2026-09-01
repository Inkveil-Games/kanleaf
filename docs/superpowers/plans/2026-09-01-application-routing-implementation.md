# Application URL Routing Implementation Plan

Design source:
`docs/superpowers/specs/2026-09-01-application-routing-design.md`

## Delivery strategy

Deliver routing in six dependency-ordered commits. Start with pure URL and
location contracts, then install the router at the application boundary, then
replace Workspace navigation state in coherent vertical slices. Keep TanStack
Query as the only remote-data layer and keep transient Task filters, drafts,
dialogs, and pane state local.

Every behavior slice follows test-driven development: add a focused failing
test, observe the expected failure, implement the minimum coherent behavior,
and rerun the focused suite. Adding the manifest dependency is the setup
exception. Do not mock React Router hooks or introduce a second navigation
store.

The implementation must preserve these invariants throughout:

- Client routes never replace server authorization.
- A loading or transiently failed query never causes a canonical redirect.
- Explicit stale resource IDs are removed only after an owning list has settled
  and proves absence, or after an expected authoritative `403`/`404` response.
  Loading and transient failures never count as absence.
- A parent Library, Cycle, or Module route may display its deterministic first
  item without rewriting the URL.
- Settings are routed overlays with one pushed entry, replaced section changes,
  and a validated content-route return target.
- Deliberate navigation away from Markdown waits for the existing document
  save coordinator; a failed save leaves the current URL and editor visible.

## 1. Establish the typed route contract

Files:

- Update `apps/desktop/package.json` and `pnpm-lock.yaml` with
  `react-router@^7.16.0`.
- Add `apps/desktop/src/app/routing/routePaths.ts`.
- Add `apps/desktop/src/app/routing/routePaths.test.ts`.
- Add focused `settingsSections.ts` contracts beside Account, Workspace, and
  Project Settings, then update the existing Settings imports.

Behavior:

- Define one typed builder for every canonical Host, Workspace, Project,
  Library, planning, Saved View, and Settings path in the approved design.
- Add helpers that set or remove the single `task` search parameter without
  discarding unrelated safe search state.
- Keep section unions, allowed values, and runtime validation in the owning
  feature's small contract module; `routePaths.ts` consumes those types but
  does not import a React component or duplicate allowed values.
- Encode stable UUIDs as route identity and encode every path segment through
  `encodeURIComponent`.
- Table-test exact output for the complete route matrix, Task parameter
  addition/removal, and safe path construction.
- Do not add route generation, loaders, actions, a generic navigation service,
  or application data to this module.

Focused verification:

```text
pnpm --filter @kanleaf/desktop exec vitest run \
  src/app/routing/routePaths.test.ts
pnpm --filter @kanleaf/desktop typecheck
pnpm --filter @kanleaf/desktop lint
```

Commit: `feat(ui): define application route contract`

## 2. Install the application router and route Host Console

Files:

- Add `apps/desktop/src/app/routing/AppRouter.tsx`.
- Add `apps/desktop/src/app/routing/AuthenticatedRoutes.tsx`.
- Update `apps/desktop/src/main.tsx`.
- Update `apps/desktop/src/app/App.tsx` and `App.test.tsx`.
- Update `apps/desktop/src/features/host/HostConsole.tsx` and
  `HostConsole.test.tsx`.

Behavior:

- Make `AppRouter` the production `BrowserRouter` boundary and leave providers,
  health checking, session restoration, theme application, and unauthorized
  session cleanup in their existing layers.
- Make `AuthenticatedRoutes` own authenticated route selection without fetching
  data. In this commit it declares Host routes and a temporary Workspace
  catch-all that renders the unchanged Workspace shell; the following commits
  replace that catch-all with explicit route families while removing each
  corresponding local navigation state in the same compiling slice.
- Remove the hand-written `usePathname` History API hook from `App.tsx`.
- Preserve the requested URL while health, authentication, and session
  restoration run. Anonymous `/host/access` users see authentication at that
  URL, and authenticated non-Hosts see the existing denial surface.
- Make Host Console controlled by the route: `/host` renders Workspaces and
  `/host/access` renders Access. Host navigation uses normal router history;
  closing uses the canonical root entry.
- Canonicalize unknown Host children to `/host` with `replace`.
- Normalize trailing slashes at the authenticated routing boundary with
  `replace`, preserving search state. Cover `/host/` here and nested Workspace
  paths when those routes land.
- Convert App tests to a `MemoryRouter` harness and a location probe. Exercise
  direct `/host/access`, authentication retention, Host denial, Close,
  Back/Forward, and the removal of the manual History API boundary.

Focused verification:

```text
pnpm --filter @kanleaf/desktop exec vitest run \
  src/app/routing/routePaths.test.ts \
  src/features/host/HostConsole.test.tsx \
  src/app/App.test.tsx
pnpm --filter @kanleaf/desktop typecheck
pnpm --filter @kanleaf/desktop lint
```

Commit: `feat(ui): route the authenticated application shell`

## 3. Make Workspace content location URL-owned

Files:

- Add `apps/desktop/src/features/workspace/workspaceLocation.ts` and
  `workspaceLocation.test.ts`.
- Add `apps/desktop/src/features/workspace/WorkspaceRouteScreen.tsx` and
  `WorkspaceRouteScreen.test.tsx`.
- Update `apps/desktop/src/features/workspace/WorkspaceShell.tsx`.
- Update `apps/desktop/src/features/view/api.ts` and add
  `apps/desktop/src/features/view/api.test.ts`.
- Update focused Workspace navigation and command tests where their public
  callback contracts change.

Behavior:

- Model routed content with a discriminated union for Task collections,
  Workspace or Project Saved Views, Project Overview, Project Views index,
  Workspace or Project Library, and Cycle or Module planning.
- Add pure helpers for content identity, validated Settings return targets, and
  reconciliation. Model reconciliation as `wait`, `keep`, or `replace`, with
  resolved access data that distinguishes pending, transient error,
  authoritative absence, and forbidden access.
- Parse route parameters and `?task=` once in `WorkspaceRouteScreen` and pass
  that typed location into `WorkspaceShell`. Do not fetch or duplicate
  Workspace queries in the route screen.
- Replace the temporary authenticated catch-all with explicit collection,
  Saved View, Project Overview, Project Views index, parent Library, and parent
  planning leaves. Each leaf renders the same `WorkspaceRouteScreen` adapter
  rather than a one-file-per-route wrapper. Resource-detail leaves and Settings
  leaves join the tree when their controlled surfaces are ready in steps 4 and 5.
- Remove `activeWorkspaceId`, `collection`, `activeView`, `selectedTaskId`,
  `surface`, and `activeProjectId` as competing navigation state. Derive the
  rendered parent surface and Task selection from the route. Keep only the
  not-yet-routed Library selection and Settings overlay state until their
  controlled replacements land in steps 4 and 5.
- Keep action errors, query/layout drafts, dialogs, joining state, navigation
  collapse, and pane widths local.
- Route `/` to the active or first Workspace My Work path after the Workspace
  query settles. Keep `/` and the existing creation surface when there are no
  Workspaces.
- On explicit Workspace switching, await the existing activation request and
  only then change the URL. On failure, retain both the current URL and visible
  Workspace. On a direct deep link, validate membership before child queries
  and synchronize the active Workspace as a side effect.
- Replace all collection, Project overview, Project work-item, Project Views
  index, Library, command-palette, notification, join, import, create, and
  removal navigation handlers with centralized route builders.
- Open and close Task detail by setting/removing `?task=` while preserving the
  collection route. Resolve notifications to an authorized Task before
  choosing Workspace or Project scope.
- Route command Task results to All Tasks or Project Work Items. Route command
  documents when document-detail leaves are connected in step 4.
- Add the missing desktop `getSavedView` client for the already implemented,
  authorized server detail endpoint. Resolve a Saved View route by ID, verify
  its Workspace/Project scope, and initialize query/layout once per View
  identity. Background refetches update remote metadata without clobbering a
  locally dirty draft.
- Test that `getSavedView` sends the token-scoped `GET` to the encoded
  Workspace/View detail path and returns the canonical response unchanged.
- Preserve Task query/layout drafts by a base collection identity that excludes
  Task search state and routed Settings overlays.
- Pass `flushDocumentSaves()` from `ConfiguredApp` through the authenticated
  routing boundary. Route every deliberate Workspace navigation through one
  narrow helper that navigates only after the save coordinator resolves. A
  rejected save retains the current URL/editor and reports the existing action
  error; do not add a global navigation service or intercept browser reload or
  Back.
- Unit-test parsing and location identity without the DOM. Use MemoryRouter in
  the route-screen tests and real navigation rather than mocked hooks.
- Integration-test root and Workspace index replacement, valid navigation,
  activation success/failure, Task query history, nested trailing-slash
  replacement, and save success/failure.

Focused verification:

```text
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/workspace/workspaceLocation.test.ts \
  src/features/workspace/WorkspaceRouteScreen.test.tsx \
  src/features/view \
  src/features/command/CommandPalette.test.tsx \
  src/features/collaboration/Notifications.test.tsx
pnpm --filter @kanleaf/desktop typecheck
pnpm --filter @kanleaf/desktop lint
```

Commit: `refactor(ui): make workspace location URL-owned`

## 4. Route Saved Views, Library, and planning detail

Files:

- Update `apps/desktop/src/features/workspace/WorkspaceShell.tsx` and
  `workspaceLocation.ts` with resolved-resource reconciliation.
- Update `apps/desktop/src/app/routing/AuthenticatedRoutes.tsx` with document,
  Cycle, and Module detail leaves.
- Update `apps/desktop/src/features/view/ProjectViewsPane.tsx` and its tests.
- Update `apps/desktop/src/features/document/DocumentWorkspace.tsx` and
  `DocumentWorkspace.test.tsx`.
- Update `apps/desktop/src/features/project/ProjectPlanningPane.tsx` and
  `ProjectPlanningPane.test.tsx`.

Behavior:

- After Saved View create or duplicate, navigate to its scope-correct route.
  After delete, replace with Workspace All Tasks or the Project Views index.
- When an authorized Saved View is opened under the wrong scope, replace with
  that View's correct Workspace or Project canonical URL rather than treating
  it as absent.
- Keep `DocumentWorkspace` controlled. When an explicit document is confirmed
  absent or outside the routed scope, replace with the Library parent. When an
  explicit document is collapsed out of view, replace with the visible
  ancestor. A parent Library route may render the deterministic first note
  without changing the parent URL.
- Remove the remaining local `selectedDocumentId` only when the document-detail
  leaves and callbacks land in this same compiling slice.
- Route command documents to the correct Workspace or Project document path.
- Make `ProjectPlanningPane` controlled with `selectedId` and `onSelectId`.
  Selecting or creating an item pushes its detail route; archiving the selected
  item replaces with the planning parent. A parent route may display the first
  Cycle or Module without adding its ID to the URL.
- Keep dialogs and create/edit form state local.
- Test explicit stale IDs, parent implicit selection, scope mismatch, Saved
  View draft identity, create/delete canonical destinations, and controlled
  Cycle/Module navigation.

Focused verification:

```text
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/workspace/workspaceLocation.test.ts \
  src/features/view \
  src/features/document/DocumentWorkspace.test.tsx \
  src/features/project/ProjectPlanningPane.test.tsx
pnpm --filter @kanleaf/desktop typecheck
pnpm --filter @kanleaf/desktop lint
```

Commit: `feat(ui): route workspace detail surfaces`

## 5. Route Settings and reconcile authorized canonical locations

Files:

- Update `apps/desktop/src/features/settings/SettingsShell.tsx` and
  `SettingsShell.test.tsx`; Account and Workspace Settings content components
  remain controlled by their existing `section` props.
- Update `apps/desktop/src/features/project/ProjectSettings.tsx` and its tests.
- Update `apps/desktop/src/features/workspace/workspaceLocation.ts`,
  `WorkspaceRouteScreen.tsx`, and `WorkspaceShell.tsx`.
- Update `apps/desktop/src/app/routing/AuthenticatedRoutes.tsx` with the three
  Settings route families and scoped unknown-child fallbacks.
- Add or extend focused real-shell routing integration tests.

Behavior:

- Keep the existing controlled Account/Workspace Settings shell contract and
  make Project Settings controlled by validated `section` and
  `onSectionChange` props. Remove the local Account/Workspace/Project Settings
  and overlay state from `WorkspaceShell` only in this same slice.
- Opening Settings pushes exactly one Settings URL whose router state stores a
  validated internal content-route `returnTo`. Section changes replace the
  current Settings entry. Close replaces with `returnTo`; a direct link falls
  back to Workspace My Work or Project Overview. Back must not reopen Settings
  after Close.
- Never trust a raw return string: accept only a non-Settings application path
  in the same authenticated Workspace and, for Project Settings, the same
  Project scope.
- Reconcile only after each owning query reaches an authoritative state:
  missing Workspace to active/first My Work; undisclosed Project to Workspace
  My Work; open discoverable unjoined Project child routes to its joinable
  Overview; disabled feature to Project Overview; missing View, document,
  Cycle, or Module to its parent; forbidden Project Settings to Project
  Overview; restricted guest Workspace content to My Work; inaccessible Task
  by removing only `?task=` and showing a generic unavailable message.
- Retain the exact requested URL and render retry state for timeouts, network
  failures, and `5xx` responses. Canonical redirects always use `replace`.
- Ensure account changes cannot briefly render the previous account's routed
  Workspace data.
- Route all deliberate content navigation through one narrow Workspace-boundary
  save-aware helper introduced in step 3, including all newly routed detail and
  Settings handlers. Keep browser reload/Back best-effort as designed.
- Test the settings history contract, role-aware sections, open/unjoined
  Project behavior, guest restrictions, disabled features, transient errors,
  stale resources, task removal, account switching, and Markdown save failure.
- Explicitly cover the global unknown-path replacement to `/`, a valid
  Workspace's unknown child replacement to its My Work route, invalid Settings
  section replacement, and search-preserving trailing-slash normalization.

Focused verification:

```text
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/workspace/workspaceLocation.test.ts \
  src/features/workspace/WorkspaceRouteScreen.test.tsx \
  src/features/settings/SettingsShell.test.tsx \
  src/features/project/ProjectSettings.test.tsx \
  src/app/App.test.tsx
pnpm --filter @kanleaf/desktop typecheck
pnpm --filter @kanleaf/desktop lint
```

Commit: `feat(ui): route settings and canonical fallbacks`

## 6. Verify real deep links and update routing documentation

Files:

- Extend `apps/server/src/http.rs` SPA fallback tests.
- Extend `apps/desktop/e2e/core-workflow.spec.ts`.
- Extend `apps/desktop/e2e/self-host-smoke.spec.ts`.
- Update `docs/architecture.md` and `docs/development.md` where they describe
  the former manual Host route or local navigation ownership.

Behavior:

- Confirm the existing Axum static fallback serves HTML with `no-cache` for
  `/host/access` and a deeply nested Workspace/Project route; do not add a
  parallel server routing implementation.
- In the core browser workflow, assert canonical URLs at existing Workspace,
  Project, Saved View, document, Cycle/Module, and Task checkpoints. Reload an
  open Task, a selected Library document, and one planning detail and verify
  the reconstructed surface. Exercise one collection Back/Forward transition.
- Verify Settings open, section replacement, Close, and Back history behavior
  without duplicating every unit-test combination.
- In the self-host workflow, direct-load and reload `/host/access`, navigate to
  Workspaces, and verify Back/Forward preserves the Host section.
- Preserve existing isolated PostgreSQL and temporary vault setup; reuse
  resources already created by the workflow instead of adding a second large
  scenario.
- Document that React Router owns durable client location, TanStack Query owns
  remote state, direct client paths rely on the existing SPA fallback, and
  transient Task/view configuration remains local.

Final verification:

```text
git diff --check
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --locked
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test --workspace --all-features --locked
pnpm tauri build --no-bundle
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  pnpm test:e2e
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  pnpm test:e2e:self-host
docker compose --env-file infra/self-host/.env.example \
  -f infra/self-host/compose.yaml config --quiet
```

Run the packaged Tauri smoke check documented by the repository and visually
inspect restored deep links at wide and 960-pixel desktop widths in light and
dark themes. Review loading, retry, missing-resource, unauthorized, empty, and
Markdown-save-failure states. Finally inspect the complete diff for duplicate
navigation state, hard-coded route strings outside `routePaths.ts`, router-hook
mocks, stale manual-routing documentation, leaked identifiers, debug output,
generated data, and unrelated changes.

Commit: `test(ui): verify application deep links`
