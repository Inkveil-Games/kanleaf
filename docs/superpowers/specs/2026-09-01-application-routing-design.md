# Application URL Routing Design

## Summary

Kanleaf will replace its hand-written `/host` pathname check and the durable
navigation state currently held inside React components with React Router.
Clean URLs will become the single source of truth for Host Console sections,
Workspace and Project surfaces, Saved Views, open Task and Library details,
planning selections, and Settings sections.

This change preserves the existing desktop interface. Navigation panes, detail
panes, Settings dialogs, data fetching, authorization, and Markdown editing
remain recognizable. TanStack Query continues to own remote data; the router
owns only location and browser history.

## Goals

- Preserve the exact durable application location across refreshes, direct
  links, and browser Back/Forward navigation.
- Route Host Console and all existing Workspace navigation without creating a
  second synchronized React-state representation.
- Keep authenticated and Workspace-scoped authorization boundaries intact.
- Use stable resource identifiers so renaming a Workspace, Project, Task, or
  Library note does not break a link.
- Keep route declarations, URL construction, route interpretation, and feature
  rendering in small modules with explicit responsibilities.
- Support the browser client, Vite development client, and packaged Tauri app
  with one route contract.
- Add focused route tests plus representative real-browser deep-link tests.

## Non-goals

- Server-side rendering or React Router Framework/Data mode.
- Moving API fetching from TanStack Query into route loaders or actions.
- Putting unsaved Task filters, grouping, sorting, display properties, or
  layout changes into the URL.
- Persisting form drafts, create/archive dialogs, command palette state,
  popovers, checked rows, pane widths, or narrow navigation drawer state.
- Adding Workspace or Project slugs or changing database identifiers.
- Redesigning the navigation, Settings, Task detail, Library, or Host Console
  interface.
- Changing server authorization or treating client routing as authorization.
- Adding a general before-unload Markdown draft warning. Refresh tests must
  wait until the editor reports `Saved`.

## Current state

`apps/desktop/src/app/App.tsx` contains a small `window.history` wrapper and
recognizes only the exact `/host` pathname. Host Console then stores its active
section in local state, so refreshing Access returns to Workspaces.

`WorkspaceShell.tsx` independently stores the active Workspace, collection,
Saved View, Task, surface, Project, Library document, Settings dialog, and
Settings sections. `ProjectPlanningPane` and `ProjectSettings` keep additional
route-worthy selections. Each navigation callback resets several coupled
states manually. Refreshing or opening a direct link cannot reconstruct this
state, and adding URL synchronization around it would create two competing
sources of truth.

The self-host server already falls back to the Vite `index.html` for non-API
paths. The packaged Tauri asset resolver likewise falls back to its bundled
index for an application path. Nested client routes therefore require tests
and documentation updates, not a second server-side routing implementation.

## Router choice

Add `react-router` at the current compatible v7 line and use Declarative mode:

```json
"react-router": "^7.16.0"
```

`BrowserRouter`, `Routes`, `Route`, `Navigate`, and the normal navigation and
location hooks are sufficient. React Router does not own Kanleaf API calls or
cache state. `MemoryRouter` supplies deterministic initial entries and history
in component tests.

React Router is preferred over the alternatives because:

- extending the existing hand-written History API would retain duplicate
  route/state synchronization and make nested matching fragile;
- TanStack Router's route generation, Vite plugin, and additional typed data
  conventions are not needed while Kanleaf deliberately keeps transient query
  configuration out of the URL;
- React Router Declarative mode fits the existing React/Vite application and
  lets TanStack Query remain the only remote-data abstraction.

Do not add `@react-router/dev`, a route generator, framework adapters, loaders,
actions, or server-rendering packages.

## Canonical URL contract

All resource parameters use existing UUIDs. Names, Project identifiers, and
vault storage names are mutable or belong to persistence concerns and must not
become route identity.

### Top-level and Host routes

| URL            | Surface                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| `/`            | Replace with the authenticated user's active/first Workspace My Work route |
| `/host`        | Host Console Workspaces                                                    |
| `/host/access` | Host Console Access                                                        |

`/host` remains the Workspaces index for backward compatibility. There is no
need for a separate `/host/workspaces` canonical URL.

If the authenticated account has no Workspace, `/` renders the existing empty
Workspace creation flow rather than redirecting. Creating the first Workspace
then navigates to its My Work route.

### Workspace routes

| URL                                   | Surface                                     |
| ------------------------------------- | ------------------------------------------- |
| `/w/:workspaceId`                     | Replace with that Workspace's My Work route |
| `/w/:workspaceId/my-work`             | My Work                                     |
| `/w/:workspaceId/inbox`               | Inbox                                       |
| `/w/:workspaceId/tasks`               | All Tasks                                   |
| `/w/:workspaceId/views/:viewId`       | Workspace Saved View                        |
| `/w/:workspaceId/library`             | Workspace Library                           |
| `/w/:workspaceId/library/:documentId` | Selected Workspace Library note             |

### Project routes

| URL                                                       | Surface                       |
| --------------------------------------------------------- | ----------------------------- |
| `/w/:workspaceId/projects/:projectId`                     | Project Overview              |
| `/w/:workspaceId/projects/:projectId/work-items`          | Project work items            |
| `/w/:workspaceId/projects/:projectId/cycles`              | Project Cycles                |
| `/w/:workspaceId/projects/:projectId/cycles/:cycleId`     | Selected Cycle                |
| `/w/:workspaceId/projects/:projectId/modules`             | Project Modules               |
| `/w/:workspaceId/projects/:projectId/modules/:moduleId`   | Selected Module               |
| `/w/:workspaceId/projects/:projectId/library`             | Project Library               |
| `/w/:workspaceId/projects/:projectId/library/:documentId` | Selected Project Library note |
| `/w/:workspaceId/projects/:projectId/views`               | Project Saved View index      |
| `/w/:workspaceId/projects/:projectId/views/:viewId`       | Selected Project Saved View   |

### Settings routes

| URL                                                     | Surface                   |
| ------------------------------------------------------- | ------------------------- |
| `/w/:workspaceId/settings/account/:section`             | Account Settings dialog   |
| `/w/:workspaceId/settings/workspace/:section`           | Workspace Settings dialog |
| `/w/:workspaceId/projects/:projectId/settings/:section` | Project Settings dialog   |

Valid section names remain the feature-owned union types:

- Account: `profile`, `preferences`, `security`, `invitations`,
  `notifications`.
- Workspace: `general`, `members`, `states`, `labels`, `task-types`,
  `invitations`, `storage`, `danger` subject to the current role checks.
- Project: `general`, `members`, `features`, `defaults`, `danger` subject to
  the current Project role checks.

### Task detail query parameter

Task detail is a secondary pane over a Task collection or Saved View, not a
replacement surface. It uses one optional search parameter:

```text
/w/workspace-id/my-work?task=task-id
/w/workspace-id/projects/project-id/views/view-id?task=task-id
```

This preserves the list/view context while the detail is open. No other Task
query configuration enters the URL in this change.

Trailing slashes and non-canonical index paths are replaced with their
canonical form. Canonicalization never creates an additional history entry.

## Route-owned and local state

The URL owns:

- active Workspace;
- Inbox, My Work, All Tasks, or Saved View identity;
- Project and Project sub-surface;
- open Task detail;
- Workspace- or Project-scoped Library and selected document;
- selected Cycle or Module;
- Account, Workspace, Project, and Host Settings section.

React state continues to own:

- an unsaved Task query and layout draft;
- form/editor drafts and their submission/error state;
- command palette, import, create, confirmation, menu, and popover visibility;
- checked bulk-selection rows;
- pane sizes, collapsed navigation, and responsive drawer state;
- document-tree expansion and calendar display anchor;
- ephemeral success/error presentation that is not required to recreate a
  location.

A Saved View route loads the canonical Saved View from its existing detail API
and initializes the Task query/layout editor once for that collection/View
identity; opening a Task or Settings overlay does not create a new draft.
Background refetches must update remote metadata without overwriting a locally
dirty configuration draft. Changing to another route identity creates a new
draft from that route's canonical state.

## Code organization

Routing is a small application subsystem, not another responsibility added to
`WorkspaceShell`.

```text
apps/desktop/src/app/routing/
  AppRouter.tsx
  AuthenticatedRoutes.tsx
  routePaths.ts
  routePaths.test.ts

apps/desktop/src/features/workspace/
  WorkspaceRouteScreen.tsx
  workspaceLocation.ts
  workspaceLocation.test.ts
  WorkspaceShell.tsx
```

Responsibilities are intentionally narrow:

- `AppRouter.tsx` installs `BrowserRouter` in production and contains no
  product data logic. Tests use `MemoryRouter` directly.
- `AuthenticatedRoutes.tsx` declares the top-level route tree after normal
  health/session restoration. It maps a matched leaf to Host Console or a
  `WorkspaceRouteScreen`; it does not fetch feature data.
- `routePaths.ts` is the only shared URL construction module. It exports typed
  path builders. Feature code must not concatenate route strings ad hoc.
- `workspaceLocation.ts` defines a discriminated `WorkspaceLocation` union for
  the supported Workspace surfaces plus pure reconciliation helpers that accept
  already-resolved access data and return a parent/fallback location. It
  contains no React, API, or rendering code.
- `WorkspaceRouteScreen.tsx` adapts React Router params/search to a
  `WorkspaceLocation` and passes it into `WorkspaceShell`. It does not duplicate
  Workspace, Project, Saved View, document, planning, or Task queries.
- `WorkspaceShell.tsx` remains the Workspace data/composition boundary. It
  derives visible surface, collection, active Project, and selected resource
  from `WorkspaceLocation` instead of mirroring them in local navigation state.
  Once its existing owning queries settle, it calls the pure reconciliation
  helper and replaces an invalid location when required. Its mutation handlers
  navigate through `routePaths`.

Feature-owned section types and their runtime validators remain together beside
their feature; routing imports those contracts rather than duplicating their
literals in `routePaths`. `ProjectSettings` exports its section contract and
becomes controlled, matching the existing Account and Workspace Settings
shells. `HostConsole` and `ProjectPlanningPane` also become controlled for their
durable selection. Existing components, CSS, and layout primitives are reused.

Do not introduce a generic navigation service, global state store, route
repository, generated route tree, or one file per leaf route. Split by stable
responsibility, not by arbitrary file size.

## Routing data flow

For an authenticated Workspace URL:

1. React Router matches the URL and extracts path/search parameters.
2. `WorkspaceRouteScreen` constructs the typed `WorkspaceLocation` and passes
   it to `WorkspaceShell`.
3. The existing Workspace list query in `WorkspaceShell` resolves before
   membership-dependent child queries are enabled.
4. The route Workspace is validated against the authenticated account's
   visible Workspaces.
5. Project, Saved View, document, planning, and Task queries are enabled only
   after their owning scope is established.
6. `WorkspaceShell` supplies settled query/access data to the pure route
   reconciler; invalid or inaccessible identity is replaced with its safe
   parent.
7. `WorkspaceShell` renders existing feature components from the resolved
   location.

The server remains authoritative. Finding an ID in a cached list is only a
client request gate; every API continues to perform its existing authorization.

The Saved View detail endpoint already exists. Add only the missing frontend
client function and use a feature-specific query key scoped by Workspace and
View identity. Existing identity transitions clear account-scoped query data.
The response's `project_id` must agree with the route scope; an authorized View
placed under the wrong scope is replaced with its correct canonical View URL.

## Navigation and history rules

Use `push` for explicit user navigation:

- changing primary collection or Project surface;
- opening another Workspace, Project, Saved View, Library note, Cycle, Module,
  Settings dialog, Host section, or Task detail.

Use `replace` for state correction or removal:

- `/` and Workspace index redirects;
- trailing-slash and invalid-section normalization;
- inaccessible, deleted, archived, or disabled-feature fallback;
- closing or deleting the currently open Task/document/planning detail;
- changing sections inside an already-open Settings dialog;
- post-account-switch normalization when the prior account's URL is not
  accessible.

Back and Forward must derive a fresh location directly from the router. Do not
use effects to copy router params into the old navigation `useState` values.

Deliberate in-app navigation away from a mounted Markdown editor awaits the
existing document-save coordinator before changing the route. A failed or
conflicted save leaves the URL and editor mounted so its recovery UI remains
available. Declarative browser history cannot await a hard reload or an
external Back/Forward action; those paths retain the current best-effort
unmount save behavior, and their routing tests navigate only after the editor
reports `Saved`. A general browser-unload blocker remains outside this change.

Explicit Workspace switching awaits `activateWorkspace` before navigating. A
failed activation leaves both the current UI and URL unchanged and reports the
existing action error. A valid direct Workspace link may render after
membership validation and synchronizes `active_workspace_id` as a persistence
side effect; an activation failure does not make client routing an
authorization decision.

Create/import/remove operations navigate deterministically:

- create or import Workspace -> its My Work route;
- remove/leave Workspace -> next accessible Workspace My Work;
- create Project -> new Project Overview;
- remove Project -> Workspace My Work;
- create Task -> same collection with `?task=<new-id>`;
- archive/delete open Task -> remove `task`;
- create/select document, Cycle, or Module -> its selected-resource route;
- delete the selected resource -> its parent surface;
- command-palette Workspace Task -> that Workspace's All Tasks with the Task
  detail open;
- command-palette Project Task -> that Project's work-items route with the Task
  detail open;
- notification Task -> resolve the authorized Task first, then choose the same
  Workspace- or Project-scoped destination without exposing an unavailable
  Task;
- command-palette document -> its scope-correct Library route.

Creating or duplicating a Saved View navigates to the new scope-correct View
URL. Deleting the active Saved View replaces it with Workspace All Tasks for a
Workspace View or the Project Views index for a Project View. Updating a View
does not change its route.

## Settings route behavior

Settings retain their existing dialog presentation. Opening Settings pushes
exactly one route with a router-state `returnTo` value containing the current
canonical `pathname + search`. The return target is parsed and accepted only
when it is a same-application, non-Settings location in the same authorized
scope. Changing sections replaces the current Settings URL while retaining the
same safe return target, so one dialog session occupies one history entry.

While the dialog is open, `WorkspaceShell` renders the validated `returnTo`
location as its background. A direct Settings URL without valid router state
uses the deterministic fallback background. Settings overlay state is not part
of the underlying Task query/layout draft identity.

Closing Settings replaces the dialog route with `returnTo`, preventing Back
from reopening a dialog the user explicitly closed even after several section
changes. A directly loaded or shared Settings URL has no trusted return state,
so Account/Workspace Settings fall back to Workspace My Work and Project
Settings falls back to Project Overview. Never call raw `navigate(-1)` for a
direct-entry close action.

## Authentication, account switching, and authorization

The router exists outside the authenticated surface so the requested location
survives health checks, sign-in, account selection, and session restoration.
Anonymous users see the existing authentication UI without being redirected
away from the requested location.

After authentication:

- Host routes require the existing `is_host` session signal for presentation,
  and every Host API still requires server-side Host authorization;
- non-Host accounts on any `/host/*` route see `Host access required`;
- Workspace route queries wait for the new account's Workspace list;
- account switching retains the URL only when the new account can access its
  owning Workspace and resources;
- otherwise the URL is replaced with the new account's active/first Workspace
  My Work route without rendering cached content from the prior account;
- existing Markdown flush and account-scoped query-cache clearing happen
  before identity changes exactly as they do now.

Guest and Project role restrictions still control which navigation and actions
are rendered. Direct routing never enables a query or action that the role
would not otherwise permit.

An Open Project with `effective_role === null` remains discoverable and
joinable at Project Overview. Its child surfaces and Settings are unavailable
until the user joins, and canonicalize back to that Overview. Project Settings
requires the existing Project Admin capability; a non-Admin direct link returns
to Project Overview rather than selecting a nominal "first" Settings section.

Guests cannot use Workspace-level Inbox, My Work collections, All Tasks, Saved
Views, or Workspace Library through a direct URL. Those routes canonicalize to
the Workspace My Work restricted state. Guests may use Project routes only for
Projects where the server reports an effective Project role.

## Invalid, stale, and unavailable routes

Fallback waits until the owning query finishes. Never redirect merely because
data is still loading. Canonicalize only when an owning list proves absence or
an expected missing/forbidden response is authoritative. Network, timeout, and
server failures retain the requested URL and render the existing retry/error
state; a transient outage must not erase a valid deep link.

| Condition                                        | Canonical outcome                                             |
| ------------------------------------------------ | ------------------------------------------------------------- |
| Unknown route outside known application prefixes | `/` and normal authenticated root resolution                  |
| Unknown `/host/*` child                          | `/host`                                                       |
| Unknown child under a valid Workspace            | That Workspace My Work                                        |
| Workspace missing or inaccessible                | Active/first accessible Workspace My Work                     |
| Project missing or undisclosed                   | Owning Workspace My Work                                      |
| Discoverable Open Project without membership     | Project Overview; child routes return to Overview             |
| Project feature disabled                         | Project Overview                                              |
| Saved View missing or inaccessible               | Workspace Tasks or Project Views parent, based on route scope |
| Document missing or outside the routed scope     | Matching Library parent                                       |
| Cycle or Module missing                          | Matching planning parent                                      |
| Settings section invalid while dialog permitted  | First permitted Settings section                              |
| Project Settings unavailable to the current role | Project Overview                                              |
| Task missing or inaccessible                     | Remove `task` and show generic `Task unavailable` feedback    |

Missing and forbidden resources receive the same client wording. Resource
names from another scope are never exposed. The existing server `404` behavior
remains authoritative.

Library, Cycles, and Modules parent routes intentionally mean "use the current
deterministic default selection." They preserve today's wide-pane behavior by
showing the first visible item when one exists without rewriting the parent
URL. Once the user explicitly selects an item, its ID enters the URL. An
explicit invalid ID is replaced with the parent route before the default item
is shown. `DocumentWorkspace` must not silently retain an explicit stale
`documentId` while displaying another note; collapsing an explicitly selected
child replaces its route with the effective visible ancestor.

The Task query/layout draft identity is the collection or Saved View route,
excluding the `task` search parameter and any Settings overlay. Opening another
Task or Settings dialog must not reset unsaved filter/layout changes.

## Browser, self-host, and Tauri behavior

Use `BrowserRouter` without a basename so the browser client keeps clean paths.
Vite development, the Axum web-client fallback, and the Tauri bundled-asset
fallback all resolve application paths to `index.html`.

The Axum runtime does not gain route-specific handlers. Extend its static-file
test to cover `/host/access` and a deeply nested Workspace path while retaining:

- `no-cache` for `index.html` route responses;
- immutable caching for hashed assets;
- file-not-found behavior for missing assets;
- structured JSON `404` for unknown `/api/*` routes.

The packaged Tauri app still receives a build/check smoke because HTTP
Playwright cannot prove custom-protocol fallback behavior.

## Testing strategy

### Pure route tests

Test every `routePaths` builder and `WorkspaceLocation` variant, including
UUID placement, Task search parameters, parent locations, section validation,
and canonical normalization. These tests contain no network or DOM behavior.

### React integration tests

Use `MemoryRouter` initial entries and real history transitions to cover:

- direct `/host/access` restoration and Host section navigation;
- anonymous and non-Host Host routes;
- root and Workspace index replacement;
- collection, Project, Saved View, Task, Library, planning, and Settings deep
  links;
- Back/Forward and active `aria-current` state;
- Workspace activation success/failure;
- account switch normalization without stale account data;
- invalid/deleted IDs and feature-disabled fallback;
- controlled Host, Project Settings, planning, and document selections.

Add a focused Workspace route integration test; do not force all route behavior
through the already broad `App.test.tsx`.

### Server and browser tests

- Extend `apps/server/src/http.rs` SPA fallback coverage with nested routes.
- Update the core Playwright workflow so an open Task, Library note, and one
  representative Project surface survive reload after persistence reports
  success.
- Update the self-host smoke test for direct `/host/access`, reload,
  Back/Forward, and one nested Workspace URL served by the compiled same-origin
  bundle.
- Retain the existing API authorization tests; routing is not a replacement for
  them.

Settings history coverage must open Settings, change at least two sections,
close it, and then verify that Back does not reopen an earlier Settings entry.
Guest coverage must open a Project Task from command/notification navigation
without enabling a Workspace-level collection.
Markdown navigation coverage must prove that deliberate navigation awaits a
successful save and remains on the current route when the save fails. Browser
Back/Forward and reload cases wait for the visible `Saved` state.

### Verification

Run fresh checks from the repository root:

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --locked
pnpm tauri build --no-bundle
```

Run PostgreSQL-feature tests with their existing per-test isolation. Playwright
uses the supplied database directly, so provide an explicitly disposable test
database URL; the harness isolates the vault but does not provision a database.
Run the self-host Playwright suite against its compiled same-origin browser
bundle and local Rust server; Docker image publication remains CI coverage.
Review the final diff and status before every focused commit.

## Documentation and compatibility

Update `docs/architecture.md` to replace the now-stale statement that Host
Console uses a small History API boundary without a routing dependency. Record
React Router, the route/data ownership boundary, durable URL state, and the
deep-link fallback contract. Historical dated specs and plans remain unchanged.

No API response or database migration is required. The only API-layer change
is a frontend call to an already existing Saved View detail endpoint. Existing
`/host` bookmarks remain valid. `/` remains valid and becomes a canonical
redirect after session restoration.

## Definition of done

- Every canonical route renders the intended current UI after direct load and
  refresh.
- Back/Forward changes the visible surface and selected resource without state
  synchronization loops.
- An explicit URL identity and the rendered Workspace/Project/resource never
  disagree; parent routes may use their documented deterministic default
  selection.
- Anonymous, non-Host, guest, stale-account, and inaccessible-resource cases
  preserve existing security boundaries.
- Durable navigation state is removed from duplicate local `useState` storage;
  transient drafts remain local.
- Route declarations, builders, feature route models, and rendering have the
  responsibilities described above.
- Browser, self-host, and Tauri builds pass their applicable verification.
- Architecture documentation reflects the implemented route boundary.
