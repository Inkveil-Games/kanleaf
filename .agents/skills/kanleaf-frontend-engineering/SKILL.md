---
name: kanleaf-frontend-engineering
description: Implement, fix, refactor, or review Kanleaf React/TypeScript behavior in apps/desktop, including routing, TanStack Query data flow, account or Workspace transitions, Markdown save coordination, feature API adapters, and frontend tests. Use for product behavior in the browser/Tauri UI; do not use for CSS-only visual direction or server-only work.
---

# Kanleaf frontend engineering

Use this skill for changes under `apps/desktop/src` that affect application
behavior, routing, remote data, state ownership, or user interaction. Read the
root `AGENTS.md`, then inspect the current feature and its adjacent tests before
editing.

Do not use it for:

- a server-only route, SQL, migration, or vault change;
- a CSS-only visual redesign with no behavior change (use the Kanleaf product UI
  skill);
- generic React advice outside this repository;
- speculative Tauri abstractions. The current native shell is intentionally thin.

## Know the boundary

```text
main.tsx
  -> app providers and AppRouter
  -> authenticated route tree
  -> typed Workspace location/presentation
  -> feature component and feature api.ts
  -> lib/api authenticated HTTP client
```

Relevant paths:

- `apps/desktop/src/app/routing`: `BrowserRouter`, route matching, and canonical
  builders. This layer does not fetch application data.
- `apps/desktop/src/features/workspace/workspaceLocation.ts`: typed durable
  locations and reconciliation.
- `apps/desktop/src/features/workspace/workspaceRouteAdapter.ts`: translates
  feature intent to URL changes.
- `apps/desktop/src/features/workspace/WorkspaceRouteScreen.tsx`: parses route
  params/search/state, canonicalizes typed locations, and mounts the shell for
  the current identity.
- `apps/desktop/src/features/workspace/WorkspaceShell.tsx`: coordinates
  authorized Workspace state, navigation, and cross-feature actions.
- `apps/desktop/src/features/<feature>/api.ts`: feature HTTP adapters.
- `apps/desktop/src/lib/api`: shared authenticated JSON transport and errors.
- `apps/desktop/src/features/markdown/DocumentSaveCoordinator.tsx`: pending
  document-save boundary, installed by `apps/desktop/src/app/providers.tsx`.
- `apps/desktop/src/components/ui` and `apps/desktop/src/styles`: shared UI
  primitives and tokens.
- `apps/desktop/e2e`: essential real browser/server workflows.

## Work in this order

1. Identify the owning feature and existing source of truth. Search for its API,
   query key, route builder, and nearest behavior tests.
2. Write or adjust a failing behavior test before implementation. Test the
   public interaction or typed boundary, not private component internals.
3. Implement the smallest coherent vertical change. Extend an existing type,
   adapter, component, or feature API before creating another layer.
4. Exercise loading, empty, error, access-pending, success, and retry behavior
   where the request can produce them.
5. Review the diff for state duplication, stale closures, races, raw path
   strings, accessibility regressions, and unrelated formatting.
6. Run fresh targeted checks, then the full frontend group appropriate to the
   risk.

For review or diagnosis only, stop after tracing the boundary, inspecting tests,
and reporting evidence-ranked findings. Do not write tests or implementation
unless the user also asked for a change.

## Routing and state rules

- React Router owns durable application location: Host sections, Workspace and
  Project surfaces, Saved Views, selected Tasks/documents/planning items, and
  Settings sections. Build paths through the existing typed route helpers.
- Preserve clean direct links, refresh, Back, and Forward. Normalize syntactic
  forms such as trailing slashes and wildcards immediately; replace a
  semantically missing or unauthorized location only after the owning query can
  prove absence. Loading and transient failures retain the requested URL.
- A route-selected Workspace wins after membership validation.
  `active_workspace_id` is synchronized afterward and must not clobber a valid
  deep link.
- Keep selected Task in the established query parameter and preserve validated
  Settings return locations. Do not create a second representation of the same
  location in component state.
- TanStack Query owns remote data. React state owns drafts, open menus, temporary
  filters, and other interaction state. Local storage owns only the versioned
  account registry and device preferences already established by the app.
- Workspace activation/create/import/removal intents use a serialized
  latest-intent-wins coordinator. Account transitions are deliberately
  single-flight: reject/disable a concurrent choice instead of converting them
  to Workspace semantics. Do not let a background refetch canonicalize a route
  while a newer Workspace transition is pending.
- Flush through `DocumentSaveCoordinator` before identity, Workspace, scope, or
  route changes that could abandon an editor. A failed flush blocks navigation
  and remains visible.

## Authorization and async safety

- The server is authoritative. Cache from another identity is never trusted;
  account transitions clear account-scoped queries. Sensitive child queries,
  editors, Settings, and mutation controls require a fresh owning
  Workspace/Project access result for the current identity.
- Already-confirmed parent overview content may remain visible during its
  initial refresh, and confirmed sensitive UI stays mounted through later
  background refetches. An access error must hide stale scoped surfaces and
  offer the established retry path.
- Query children only after their parent scope settles. Do not rely on a
  disabled query's cached data as proof of access.
- Keep error handling typed through the shared API boundary. Do not silently
  convert authorization, conflict, or save failures into empty states.
- Account data must not cross normalized server URL or bearer-session
  boundaries. Identity transitions clear account-scoped query data only after
  pending Markdown is handled.

## Component and TypeScript rules

- Reuse existing primitives and feature patterns before creating a component.
  Keep reusable controls in `components/ui`; keep domain interaction in the
  owning feature.
- Prefer controlled props at a route boundary so the URL remains authoritative.
  Keep components internally controlled only for truly transient state.
- Keep strict types across DTO, adapter, and component boundaries. Avoid `any`,
  unchecked casts, and non-null assertions that replace lifecycle reasoning.
- Preserve visible focus, keyboard operation, semantic roles, accessible names,
  and explicit disabled/busy state. Test the accessible interaction.
- Keep raw HTML disabled in Markdown rendering. Preserve revision-conflict and
  unsaved-source behavior when touching Task or Library editors.
- Do not call Tauri APIs from a normal feature unless the requested behavior is
  genuinely native and the capability boundary has been reviewed.

## Tests and verification

Start focused:

```bash
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/workspace/workspaceLocation.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
```

Replace the example test with the nearest changed test file.

For a completed frontend capability, run:

```bash
pnpm test
pnpm build
```

Run real workflows when routing, authentication, authorization, Markdown
durability, history/reload, or server integration changes. Install the pinned
browser once with
`pnpm --filter @kanleaf/desktop exec playwright install chromium`. Select the
suite that proves the changed boundary:

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_e2e \
  pnpm test:e2e
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_e2e \
  pnpm test:e2e:self-host
```

Create the example `kanleaf_e2e` database as disposable state before those
commands; Playwright isolates its vault but not the supplied PostgreSQL database.
Use the normal suite for core Task/Library/account workflows; add the self-host
suite for SPA fallback, same-origin, Host, and deep-link browser behavior. Run
`pnpm tauri build --no-bundle` when startup, configuration, dependencies, or the
desktop artifact could be affected. A native `src-tauri` change also requires
the root Rust format, Clippy, and test checks.

## Common failures

- Hand-built paths drift from the route contract.
- Cached Project/Library/Settings children mount before parent access settles.
- A refetch or older activation overwrites the latest Workspace intent.
- A mutation moves a document but leaves the URL in the old scope.
- Navigation bypasses pending Markdown saves.
- A controlled route prop is copied into state and resets on refresh.
- A mocked shell test bypasses the production component behavior that carries
  the bug; add a component-level regression too.
- Only a happy-state snapshot is tested; loading, retry, keyboard, or history
  behavior remains broken.

## Definition of done

The typed URL, remote cache, transient state, and save boundary each have one
owner; access is gated; failure and retry are visible; relevant keyboard and
ARIA behavior remains; focused and full applicable checks have fresh passing
output; and the final diff contains no unrelated change.
