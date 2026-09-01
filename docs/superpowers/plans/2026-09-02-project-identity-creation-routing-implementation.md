# Project Identity, Creation, and Routing Implementation Plan

Design source:
`docs/superpowers/specs/2026-09-02-project-identity-creation-routing-design.md`

## Delivery strategy

Implement six dependency-ordered vertical slices. Every behavior starts with a
focused failing test, observes the intended failure, adds the minimum
implementation, and reruns the focused test before refactoring. Keep public
Workspace/Project identifiers and Task numbers at browser/form boundaries;
retain UUIDs for SQL relationships, authorization, API mutation paths, query
ownership, and vault paths.

Do not add a routing, form, icon, dialog, slug, or persistence dependency.
Reuse React Router, Lucide, native `dialog`, the current Project/Workspace API
adapters, domain value patterns, SQLx transactions, and vault manifests.

## 1. Migrate Project identity and retire Project task keys

Files:

- Add migration `apps/server/migrations/0019_project_public_identity.sql`.
- Update `apps/server/src/domain/mod.rs`.
- Update `apps/server/src/project.rs` and split focused creation/identity code
  into `apps/server/src/project/` only where the current file would otherwise
  mix unrelated responsibilities.
- Update Task response/projection/reference code in `apps/server/src/task.rs`,
  `task/model.rs`, `task/query_engine.rs`, `collaboration.rs`, and
  `portability/sync.rs`.
- Update portability config, export, archive validation, and import upgrade
  paths.
- Update domain tests plus `apps/server/tests/project_access.rs`,
  `workspace_import.rs`, and `workspace_export.rs`.

RED behaviors:

- Project identifiers accept canonical lowercase slugs and reject uppercase,
  malformed, too-short, or too-long input.
- Existing Projects receive deterministic name-derived identifiers with
  collision suffixes.
- Project names may repeat; live/archived identifiers may not.
- `open` rows migrate to `public`.
- Project icon keys are validated and default to `folder`.
- Creation persists explicit name/identifier/description/icon/visibility/lead.
- A Member creator remains Project Admin; a selected Member lead becomes
  Project Admin; Guest creation/lead selection is rejected.
- Identifier update is no longer accepted.
- Task references are `#<task_number>` and do not depend on Project identity.
- Existing Tasks are queued for Markdown projection.
- New archives round-trip the new identity/icon/public values; old archives
  with uppercase identifiers, `open`, and `KEY-42` references remain accepted
  and upgrade on import.

Implementation constraints:

- Drop only the active Project-name unique index; preserve tenant foreign keys.
- Use a Workspace lock plus the database unique constraint for concurrent
  identifier allocation.
- Generate collision suffixes deterministically without reserving identifiers
  after permanent row deletion.
- Validate icon keys from a server-owned allowlist synchronized with the
  frontend registry.
- Keep old archive validation versioned rather than weakening the new domain
  type to accept both identity formats.

Focused checks:

```text
cargo test -p kanleaf-server --locked domain::tests::validates_project_vocabulary
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test project_access
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test workspace_import
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test workspace_export
```

Commit: `feat(project): add public project identity`

## 2. Make Project archive reversible and deletion recoverable

Files:

- Move Project lifecycle handlers from `apps/server/src/project.rs` into a
  focused `apps/server/src/project/lifecycle.rs` module.
- Add a typed Project deletion manifest/trash boundary under
  `apps/server/src/vault`.
- Wire Project deletion recovery into server startup beside existing recovery
  work.
- Add `apps/server/tests/project_lifecycle.rs` for cross-store lifecycle and
  recovery; update adjacent Project, vault, Task, document, Saved View, and
  planning tests where their behavior changes.

RED behaviors:

- Archive changes only `archived_at`; Project Tasks, documents, members,
  planning/configuration, storage names, and Markdown remain unchanged.
- Archived listing returns all rows to Workspace Owner/Admin, only explicitly
  administered rows to regular Members, and none to Guests.
- Restore clears `archived_at` and returns the same Project identity and data.
- An archived identifier still conflicts with creation.
- Permanent deletion requires current Project Admin access and the exact
  lowercase identifier for active and archived Projects.
- Permanent deletion removes all Project-owned relational rows and the complete
  managed Project vault directory; it never moves content to Inbox/Workspace
  Library.
- A pre-commit failure restores the staged directory and retains database data.
- A post-commit/startup recovery completes trash cleanup and retires the
  manifest.
- A crash before commit is recovered by restoring the live directory.
- Only committed permanent deletion permits identifier reuse; Task numbers are
  not reused.

Implementation constraints:

- Lock and recheck Project-admin authority inside the owning transaction.
- Construct all paths from Workspace UUID and database-owned Project
  `storage_name`; request identifiers never become paths.
- Synchronize manifest and parent directory durability before database commit.
- Keep live Project directory, deletion manifest, and Project trash below the
  persisted Workspace vault filesystem so rename is atomic.
- Prefer verified foreign-key cascades, but explicitly test every Project-owned
  relation and cross-Project Task relation outcome.
- Recovery is idempotent and non-disclosing; inconsistent committed data/vault
  state fails safely rather than accepting data loss.

Focused checks:

```text
cargo test -p kanleaf-server --locked vault::tests
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test project_lifecycle archive
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test project_lifecycle delete
```

Commit: `feat(project): add recoverable project lifecycle`

## 3. Route Workspaces and Projects by public identity and Tasks by number

Files:

- Add a non-disclosing Task-number detail lookup in `apps/server/src/task.rs`
  and its integration tests.
- Update `apps/desktop/src/app/routing/routePaths.ts`,
  `AuthenticatedRoutes.tsx`, and their tests.
- Update `features/workspace/WorkspaceRouteScreen.tsx`,
  `workspaceRouteAdapter.ts`, `workspaceLocation.ts`, and focused tests.
- Update Task feature API/types only where the browser locator must resolve to
  the existing internal UUID.
- Update self-host SPA fallback route tests.

RED behaviors:

- Typed builders emit `/w/<wid>/...` and
  `/w/<wid>/p/<pid>/...` for every current surface and Settings return path.
- Project route parameters resolve the authorized Project identifier to UUID;
  UUID remains the value passed to feature APIs and query keys.
- `?task=<positive integer>` resolves within the current Workspace to the Task
  UUID after authorization.
- Reload, Back, Forward, selected Task, and settings return paths remain durable.
- An authorized mismatched Project/Task route canonicalizes to the Task's owner;
  inaccessible/missing selection is removed without rendering stale detail.
- Exact Workspace identifier resolution precedes legacy UUID interpretation.
- Current `/<wid>/*`, `/<wid>/projects/<project-uuid>/*`,
  `/w/<workspace-uuid>/*`, and `?task=<task-uuid>` locations redirect with
  replacement history while preserving applicable suffix/query/hash.
- Missing/unauthorized legacy identities do not disclose existence.

Implementation constraints:

- Extend the existing typed location and route adapters; do not create parallel
  URL state.
- Preserve `DocumentSaveCoordinator` before a canonicalization that changes
  scope or selected content.
- Do not fetch Project/Task child data until fresh Workspace/Project access has
  settled for the current identity.
- Keep non-API SPA fallback support for every new deep route; `/api/*` remains a
  structured 404 boundary.

Focused checks:

```text
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test tasks task_number
pnpm --filter @kanleaf/desktop exec vitest run \
  src/app/routing \
  src/features/workspace/workspaceLocation.test.ts \
  src/features/workspace/WorkspaceShell.routing.test.tsx
pnpm typecheck
pnpm lint
```

Commit: `feat(ui): add compact workspace project routes`

## 4. Build the spacious Create Project dialog and icon picker

Files:

- Add focused components under
  `apps/desktop/src/features/project/create/`.
- Add `apps/desktop/src/features/project/projectIcons.tsx` as the single
  frontend icon registry.
- Update `features/workspace/WorkspaceNavigation.tsx`, `WorkspaceShell.tsx`,
  feature API/types, and focused behavior tests.
- Reuse/extend the existing `Select` or popover behavior only where its current
  semantics fit; keep Project-specific grids and copy in the Project feature.
- Add tokenized styles to `apps/desktop/src/styles/tokens.css` and
  `global.css`.

RED behaviors:

- Both New Project triggers open one labeled modal and restore focus on close.
- Name suggests a normalized ID until manual ID input; Reset resumes suggestion.
- The form submits name, identifier, description, selected icon, lead, and
  visibility together.
- Name/ID and lead/visibility share rows at wide widths and stack at narrow
  widths; description remains full width.
- URL preview uses the exact new typed route.
- Lead defaults to the creator; Guest candidates are absent; regular Members
  show `Becomes Project Admin` inside the menu only.
- Visibility menu explains Private/Public inside its options and has no helper
  line below the control.
- Server conflict/validation stays inline without clearing the draft.
- Busy state prevents dismissal and duplicate submission.
- Command/Ctrl+Enter submits from description; normal Enter submits from
  single-line fields.
- Success invalidates Project data and navigates to the new identifier route.
- Icon search, groups, arrow-key navigation, Enter/Space selection, Escape,
  outside close, selected state, accessible names, and Folder fallback work.

Visual direction:

- Keep the established Inter/system type and warm restrained palette.
- Use one signature element: a shallow, geometric, theme-aware Project cover
  with the 52px icon control overlapping its lower edge.
- The surrounding modal remains quiet: subtle border/elevation, aligned form
  grid, no cards, gradients, marketing copy, or ornamental motion.
- Width target is about 860px with stable header/footer and viewport-safe
  scrolling.
- Background is CSS-only and has no persistence or editing control.

Focused checks:

```text
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/project/create \
  src/features/workspace/WorkspaceNavigation.test.tsx \
  src/features/workspace/WorkspaceShell.routing.test.tsx
pnpm typecheck
pnpm lint
pnpm format:check
```

Commit: `feat(ui): add project creation dialog`

## 5. Apply Project identity to Overview, navigation, Settings, and archive UI

Files:

- Update `features/project/ProjectOverview.tsx` and its tests.
- Update Project navigation icon rendering.
- Update `ProjectGeneralSettings.tsx` to show immutable Project ID and remove
  task-key editing.
- Add an Archived Projects section to the routed Workspace Settings surface and
  API adapters.
- Update `ProjectDangerSettings.tsx` for exact slug confirmation and complete
  deletion language.
- Add responsive/token styles and focused tests.

RED behaviors:

- Selected Project icon renders consistently in navigation and Overview.
- Overview displays the default cover without becoming an oversized hero.
- Project ID is read-only in General Settings; name/description/lead/visibility
  remain editable within their authorization rules.
- Archived Projects are filtered by server authorization, support Restore and
  permanent deletion, and do not leak inaccessible private metadata.
- Archive warning promises preservation, not Inbox reassignment.
- Permanent deletion warning enumerates Project-owned structured and Markdown
  data and requires the exact slug.
- Long content, loading, error, empty, retry, disabled, and narrow states remain
  usable by keyboard in light/dark themes.

Focused checks:

```text
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/project \
  src/features/workspace/WorkspaceSettings.test.tsx
pnpm typecheck
pnpm lint
pnpm format:check
```

Commit: `feat(ui): complete project identity lifecycle`

## 6. Integrate, document, review, and ship

Files:

- Update `apps/desktop/e2e/core-workflow.spec.ts` and route helpers.
- Add only the self-host E2E assertions needed for real SPA deep links.
- Update README/current architecture docs and any now-stale repository-local
  agent guidance.
- Do not modify global skills.

Integration behavior:

- Create a Project with icon, description, selected lead, and both visibility
  modes against the real server.
- Reload `/w/<wid>/p/<pid>/work-items?task=<number>` and exercise Back/Forward.
- Verify Public discovery/join and Private denial without stale cache exposure.
- Verify representative old Workspace/Project/Task UUID locations redirect.
- Archive, reload, Restore, and permanently delete a Project containing Tasks,
  documents, planning data, views, relations, and Markdown.
- Verify identifier reuse only after committed permanent deletion and Task
  number non-reuse.
- Exercise startup deletion recovery and a real persisted vault mount.

Visual review:

- Inspect modal, icon picker, navigation, Overview cover, archived list, and
  delete confirmation in light/dark/system themes.
- Inspect wide, 960×640, and existing narrow Workspace layouts.
- Exercise keyboard-only focus order, Escape/outside close, long names,
  long descriptions, loading, conflict, error, and busy states.
- Remove decorative or redundant copy that weakens the approved hierarchy.

Full verification:

```text
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --locked
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test --workspace --all-features --locked

pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm tauri build --no-bundle

DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_e2e \
  pnpm test:e2e
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_e2e \
  pnpm test:e2e:self-host

docker compose --env-file infra/self-host/.env.example \
  -f infra/self-host/compose.yaml config --quiet
docker build -f apps/server/Dockerfile -t kanleaf:project-identity-verify .
```

Finalization:

- Request independent review against the approved spec and this plan; fix every
  Critical/Important finding.
- Review complete diff and status, including any `AGENTS.md` or local-skill
  changes, and run `git diff --check`.
- Keep capability commits focused using the messages above plus a separate
  documentation/agent-guidance commit if durable instructions changed.
- Push `dev`, monitor Quality and multi-architecture container workflows, and
  confirm the published `dev` image includes `linux/amd64` and `linux/arm64`.
