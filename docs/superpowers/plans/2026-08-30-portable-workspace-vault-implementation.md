# Portable Workspace Vault Implementation Plan

**Design:**
`docs/superpowers/specs/2026-08-30-portable-workspace-vault-design.md`

## Delivery rules

- Implement one capability at a time and keep `dev` runnable after every
  commit.
- Write the failing domain/integration/interaction test before changing the
  owning behavior.
- Keep PostgreSQL canonical for structured data; filesystem modules receive
  typed identities and never authorize users themselves.
- Reuse the existing trash/recovery patterns instead of creating a generic
  repository or distributed job system.
- Never edit an applied migration. Add ordered migrations after `0011`.
- Run the focused checks listed for a task before its commit, then inspect the
  full staged diff and comments.

## 1. Add portable Project and Task storage identities

Files:

- add `apps/server/migrations/0012_portable_vault_identity.sql`;
- update `apps/server/src/domain/mod.rs`;
- update `apps/server/src/project.rs`;
- update `apps/server/src/task.rs` and `apps/server/src/task/model.rs`;
- update `apps/server/src/auth.rs` and `apps/server/src/workspace.rs` only for
  the new Workspace layout-version field;
- update `apps/server/tests/postgres_schema.rs`, `project_access.rs`, and
  `tasks.rs`.

Work:

1. Add failing domain tests for readable `name--shortid` construction,
   Unicode, reserved desktop names, byte truncation, empty stems, separators,
   and parse rejection.
2. Add one cohesive `VaultStorageName` value object. Keep the existing
   `LibraryStorageName` because companion-tree names have different collision
   semantics.
3. Add immutable `projects.storage_name` and `tasks.storage_name`, with SQL
   backfills based on the initial stored name/title and UUID suffix. Add
   portable-name checks and Workspace-scoped uniqueness.
4. Add `workspaces.vault_layout_version` with legacy value `0`; do not switch
   existing I/O in this commit.
5. Generate and insert storage names when Projects and Tasks are created.
   Renames must prove the storage name is unchanged.
6. Return storage names in the internal/API response records needed by later
   typed path resolution. Do not return host paths.
7. Assert composite foreign keys still reject Project/Task cross-Workspace
   references.

Focused verification:

```bash
cargo test --locked -p kanleaf-server domain::tests
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked -p kanleaf-server --features postgres-tests --test postgres_schema -- --test-threads=1
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked -p kanleaf-server --features postgres-tests --test tasks -- --test-threads=1
```

Commit:

```text
feat(vault): add portable storage identities
```

## 2. Implement the source-faithful Task frontmatter component

Files:

- update `apps/server/Cargo.toml` and `Cargo.lock` with one maintained YAML
  parser dependency;
- add `apps/server/src/task/frontmatter.rs`;
- update the module declarations in `apps/server/src/task.rs`;
- keep tests beside the pure frontmatter component.

Work:

1. Add failing tests for the approved property schema, empty optional values,
   Unicode/quoted values, CRLF/LF input, and a body beginning with `---`.
2. Parse a safe top-level YAML mapping and reject duplicate keys, aliases,
   merge keys, malformed delimiters, and duplicate/invalid `Kanleaf ID`.
3. Split a Task file into frontmatter source spans and body without normalizing
   either part.
4. Render Kanleaf-owned keys in the approved order and Obsidian-compatible
   scalar/list shapes.
5. Patch only owned top-level spans. Preserve unknown property blocks,
   comments, line endings, wikilinks, and body bytes.
6. Add round-trip edge cases for values that require YAML quoting. Keep the
   renderer limited to Kanleaf's known scalar/list schema.
7. Keep raw HTML handling unchanged; this component produces source, not
   preview HTML.

Focused verification:

```bash
cargo test --locked -p kanleaf-server task::frontmatter::tests
cargo clippy --locked -p kanleaf-server --all-targets -- -D warnings
```

Commit:

```text
feat(markdown): define portable task properties
```

## 3. Switch to the Workspace/Project Todo and Wiki layout

Files:

- add `apps/server/src/vault/layout.rs`;
- add `apps/server/src/vault/workspace_operation.rs`;
- add `apps/server/src/vault/migration.rs`;
- update `apps/server/src/vault.rs` and
  `apps/server/src/vault/library_operation.rs`;
- update `apps/server/src/document/persistence.rs`, `content.rs`,
  `migration.rs`, and `recovery.rs`;
- update `apps/server/src/task.rs`, `project.rs`, `workspace.rs`, `auth.rs`,
  `main.rs`, and `lib.rs`;
- extend `apps/server/tests/tasks.rs`, `documents.rs`, `project_access.rs`, and
  focused vault unit tests.

Work:

1. Add temporary-directory tests for the complete approved v2 shape, including
   Inbox/Project Tasks, Workspace/Project Wiki companion trees, traversal and
   symlink rejection, and stable paths after title rename.
2. Introduce typed `TaskPath`, scoped `LibraryPath`, and Project directory
   identities. Construct them only from parsed Workspace/Project/Task/Library
   records.
3. Change Task create/read/write/trash to use `Todo/<storage>.md` or
   `Projects/<project-storage>/Todo/<storage>.md`.
4. Make Task document endpoints read/write body only while the revision covers
   the complete frontmatter-plus-body file. Path-affecting Task changes patch
   the owned Project/Reference properties before reporting success.
5. Change Library path resolution and API `library_path` to use `Wiki` or the
   owning Project `Wiki`. Preserve companion-tree behavior and source bytes.
6. Add recoverable Task and Library scope moves. A Task `project_id` update
   moves the same basename; a Library root scope change moves the file and
   companion subtree.
7. Refactor Project archive/delete so all Project Tasks and Wiki roots move to
   Workspace roots with a durable multi-entry manifest before the SQL state is
   committed. Roll back every completed move in reverse order on failure.
8. Build each legacy Workspace in a sibling staging directory. Copy current
   `Tasks` into their typed `Todo` roots with generated Task frontmatter and
   copy current `Library` roots into the correct `Wiki` scope.
9. Verify IDs, file counts, revisions, frontmatter, and bodies before recording
   and performing the two-directory swap. Retain the legacy directory with a
   timestamp and recover a crash between renames at startup.
10. Mark migrated Workspaces layout `2`. Registration and Workspace creation use
    layout `2` immediately; content directories remain lazy.
11. Run current Page-to-Library recovery before the v2 Workspace migration so
    installations that skipped an intermediate release still converge.

Focused verification:

```bash
cargo test --locked -p kanleaf-server vault::tests
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked -p kanleaf-server --features postgres-tests --test tasks -- --test-threads=1
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked -p kanleaf-server --features postgres-tests --test documents -- --test-threads=1
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked -p kanleaf-server --features postgres-tests --test project_access -- --test-threads=1
```

Commit:

```text
feat(vault): add project-scoped workspace layout
```

## 4. Project canonical Task metadata into Markdown

Files:

- add `apps/server/migrations/0013_vault_projection.sql`;
- add `apps/server/src/task/projection.rs`;
- update `apps/server/src/task.rs`, `task/model.rs`, and `state.rs`;
- update `apps/server/src/task_config/state.rs`, `label.rs`, and
  `task_type.rs`;
- update `apps/server/src/project.rs`, `project/cycle.rs`, and
  `project/module.rs`;
- update `apps/server/src/main.rs` for startup drain and the small retry worker;
- extend Task configuration, planning, project, and Task integration tests.

Work:

1. Add `tasks.metadata_version`, projected version/error state, and one
   coalescing projection job per Task. Add indexes for pending retry work.
2. Build a single authorized projection query that loads the complete approved
   property set, including Project, State, Type, Priority, assignee emails,
   Labels, Cycle, Modules, dates, estimate, and parent reference.
3. Make every owning metadata transaction increment the Task version and
   upsert the job. Vocabulary/Project/Cycle/Module renames enqueue all affected
   Tasks without writing files inside the SQL transaction.
4. After a successful API commit, attempt projection immediately. A bounded
   same-process worker retries pending jobs; startup drains recoverable jobs
   before reporting healthy vault state.
5. Patch the current file under the Task lock, preserve external body/custom
   properties, and atomically replace it. Store a concise internal error when
   YAML cannot be safely patched.
6. Extend the existing body-only Task document response with projection health
   while retaining the SHA-256 revision of the complete file. Do not leak an
   internal path or parser detail.
7. Prove metadata edits update YAML, body edits do not change properties,
   vocabulary rename fans out, failed storage retries, and a malformed external
   frontmatter never gets overwritten.

Focused verification:

```bash
cargo test --locked -p kanleaf-server task::frontmatter::tests
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked -p kanleaf-server --features postgres-tests --test tasks -- --test-threads=1
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked -p kanleaf-server --features postgres-tests --test task_configuration -- --test-threads=1
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked -p kanleaf-server --features postgres-tests --test project_planning -- --test-threads=1
```

Commit:

```text
feat(markdown): project task metadata to YAML
```

## 5. Add explicit, conflict-aware vault sync

Files:

- add `apps/server/migrations/0014_workspace_operations.sql`;
- add `apps/server/src/portability/mod.rs` and
  `apps/server/src/portability/operation.rs`;
- add `apps/server/src/portability/sync.rs`;
- extract the reusable Task update use case into
  `apps/server/src/task/update.rs` only now that HTTP and sync both consume it;
- update `apps/server/src/lib.rs`, `workspace.rs`, `http.rs`, and `error.rs`;
- add `apps/server/tests/vault_sync.rs`.

Work:

1. Add a durable operation table with actor, optional Workspace, operation
   kind, state, revision-bound JSON result, expiry, and non-path staging key.
2. Add authorization tests proving only Workspace Owner/Admin can scan or
   apply and a guessed operation ID cannot cross actor/Workspace boundaries.
3. Walk only managed typed roots. Match Task files by `Kanleaf ID`; report
   unknown/duplicate/missing/moved identities and `.kanleaf` JSON drift.
4. Resolve human property values inside the authorized Workspace/Project and
   run the same task validation used by normal edits. Do not infer renamed or
   manually moved paths.
5. Return an expiring preview with valid changes, validation failures,
   conflicts, and source/metadata revisions.
6. Apply an explicitly selected valid set only after rechecking every revision.
   If one selected item is stale, apply none of the selected set. Leave
   excluded conflicts visible.
7. Use normal Task/path-move/projection use cases so sync cannot bypass role,
   assignment, hierarchy, planning, or filesystem invariants.
8. Add startup/expiry cleanup for abandoned preview records without deleting
   user Markdown.

Focused verification:

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked -p kanleaf-server --features postgres-tests --test vault_sync -- --test-threads=1
cargo clippy --locked -p kanleaf-server --all-targets --all-features -- -D warnings
```

Commit:

```text
feat(vault): sync external task properties
```

## 6. Project portable configuration and export archives

Files:

- update `apps/server/Cargo.toml` and `Cargo.lock` with the ZIP and streaming
  dependencies required by the server;
- add `apps/server/src/portability/config.rs`;
- add `apps/server/src/portability/archive.rs`;
- extend `apps/server/src/portability/operation.rs` and `mod.rs`;
- update the owning Workspace, Project, Task configuration, Saved View,
  Cycle/Module, and membership transactions to mark config projection dirty;
- update `apps/server/src/state.rs`, `main.rs`, `workspace.rs`, and `http.rs`;
- add `apps/server/tests/workspace_export.rs`.

Work:

1. Add versioned Serde models for `workspace.json`, `task-config.json`,
   `views.json`, `projects/*.json`, and the live/archived manifest variants.
2. Add a coalescing Workspace config version/projection marker. Each owning
   structured mutation marks the Workspace dirty; immediate and worker-driven
   projection writes JSON through temporary sibling files and rename.
3. Test that account/device/session/notification state, invitation tokens, and
   comment/activity history never enter the config snapshot. Memberships are
   display-only references.
4. Add an asynchronous export operation. Drain Task/config projections, read a
   repeatable DB snapshot, build the archive in internal operation storage, and
   verify file revisions before publishing it.
5. Generate the archive manifest with relative paths, sizes, media types,
   identity/remapping data, restore relationships, and SHA-256 checksums.
6. Include only managed Markdown and known config JSON. Detect symlinks,
   `.obsidian`, temporary, and unmanaged files and expose the exclusion list in
   the ready response.
7. Add status, cancel, and authorized download endpoints. Stream bytes instead
   of loading the archive into memory; re-check Owner/Admin on download.
8. Resume or fail interrupted preparation safely at startup and expire both DB
   records and internal artifacts.

Focused verification:

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked -p kanleaf-server --features postgres-tests --test workspace_export -- --test-threads=1
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked -p kanleaf-server --features postgres-tests --test saved_views -- --test-threads=1
cargo clippy --locked -p kanleaf-server --all-targets --all-features -- -D warnings
```

Commit:

```text
feat(portability): export workspace archives
```

## 7. Validate and import archives as new Workspaces

Files:

- enable Axum's multipart feature in `apps/server/Cargo.toml`;
- add `apps/server/src/portability/import.rs`;
- extend `apps/server/src/portability/operation.rs`, `mod.rs`, and API routes;
- update `apps/server/src/workspace.rs` only through existing creation/domain
  helpers extracted for concrete reuse;
- add `apps/server/tests/workspace_import.rs`.

Work:

1. Add malicious archive tests first: absolute/traversal paths, normalized
   duplicate names, symlinks/hardlinks/devices, unsupported media, excessive
   nesting/count/size, archive bombs, bad checksums, duplicate IDs, and a newer
   schema.
2. Stream a multipart `.kanleaf.zip` into generated staging operation storage
   with compressed-size limits; never trust the uploaded filename as a path.
3. Extract only validated regular entries and verify manifest/config/YAML and
   all Workspace–Project–Task–Library relationships.
4. Return preview counts, excluded membership/history behavior, warnings, and
   blocking errors without creating Workspace rows.
5. On apply, recheck staged checksums and create a complete ID map. Preserve
   storage names, rewrite Kanleaf machine properties, and copy body/custom
   property spans unchanged.
6. Open one SQL transaction for new structured records and Owner membership,
   atomically rename the validated staging vault, then commit. If commit fails,
   move the vault back. A pre-existing durable operation lets startup remove an
   orphan if the process dies between rename and rollback.
7. Never create users, restore pending invitations, or grant archived
   membership references. Activate and return the new Workspace only after the
   operation completes.
8. Add an export→import round-trip test covering Inbox/Project Tasks, Task
   configuration, planning, relations, shared Views, Workspace/Project Wiki
   trees, custom YAML properties, and a second import of the same archive.

Focused verification:

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked -p kanleaf-server --features postgres-tests --test workspace_import -- --test-threads=1
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked -p kanleaf-server --features postgres-tests --test workspace_export -- --test-threads=1
```

Commit:

```text
feat(portability): import workspace archives
```

## 8. Add Import, Sync, and Export desktop flows

Files:

- update `apps/desktop/src/lib/api/client.ts` and its tests for FormData and
  binary responses;
- add `apps/desktop/src/features/workspace/portability/types.ts` and `api.ts`;
- add `WorkspaceImportDialog.tsx`, `WorkspaceImportDialog.test.tsx`,
  `StoragePortabilitySettings.tsx`, and its tests in that feature directory;
- update `WorkspaceControl.tsx`, `WorkspaceControl.test.tsx`,
  `WorkspaceSettings.tsx`, `WorkspaceSettings.test.tsx`,
  `features/settings/SettingsShell.tsx`, and `WorkspaceShell.tsx`;
- add a small `apps/desktop/src/lib/files/saveDownload.ts` browser adapter;
- if the WebView cannot reliably save a fetched Blob, add only the official
  Tauri dialog/filesystem plugins and a browser fallback, with the matching
  `src-tauri` capability configuration;
- update `apps/desktop/src/styles/global.css` using existing tokens.

Work:

1. Add interaction tests for the Workspace menu's Import row, file validation,
   upload/preview/cancel/apply, and automatic switch to the new Workspace.
2. Keep the switcher hierarchy: account, Workspace list with active/settings
   state, then Create, Import, and Invitations. Do not restore the old
   three-dot menu.
3. Add `Storage & portability` to the existing floating Workspace Settings
   shell only for Owner/Admin. Keep Account Settings separate.
4. Implement compact vault health, Sync preview/selection/conflicts, Export
   preparation/exclusion warning/download, cancellation, and retry states.
5. Poll only active operation resources with a bounded interval and stop on
   unmount, cancel, expiry, or completion.
6. Preserve keyboard focus through ContextMenu/dialog transitions, trap focus
   in preview confirmations, and make progress/errors readable without card
   stacks or dashboard statistics.
7. Verify Member/Guest controls are absent while direct API denial remains
   covered by Rust tests.

Focused verification:

```bash
pnpm --filter @kanleaf/desktop typecheck
pnpm --filter @kanleaf/desktop lint
pnpm --filter @kanleaf/desktop test
pnpm --filter @kanleaf/desktop build
```

Commit:

```text
feat(workspace): add portable vault controls
```

## 9. Complete round-trip E2E, migration coverage, and docs

Files:

- update `apps/desktop/e2e/core-workflow.spec.ts` and E2E environment/setup as
  needed for download/upload artifacts;
- update `docs/architecture.md`, `docs/development.md`, `README.md`, and
  `AGENTS.md` only where the supported boundary or commands changed;
- update CI only if new tests require an explicit limit, fixture, or package
  prerequisite.

Work:

1. Extend Playwright to create Workspace/Project Todo and Wiki data, edit Task
   metadata/body, export, import, switch to the restored Workspace, reload, and
   verify paths/properties/content remain intact.
2. Keep malicious archive, filesystem injection, and cross-Workspace access in
   backend integration tests rather than browser setup.
3. Add a startup fixture for the current `Tasks/` + `Library/` layout and prove
   migration preserves body bytes, creates properties, separates Project Wiki,
   and leaves the timestamped recovery vault.
4. Run the desktop UI at wide, minimum, and narrow widths. Review light/dark
   hierarchy, menu alignment, settings density, long names, focus, hover,
   selection, preview conflicts, progress, empty, and storage-error states.
5. Update architecture docs to replace the body-only and metadata-only Project
   layout rules. Document archive scope, unsupported collaboration history,
   vault recovery cleanup, and self-host data ownership.

Commit test/docs changes coherently, for example:

```text
test(e2e): cover portable workspace round trip
docs: document portable workspace vaults
```

## 10. Final review, push, and CI

Run the complete suite:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm tauri build --no-bundle
cargo fmt --all --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked --workspace --all-features -- --test-threads=1
```

Search the repository for stale layout paths, `TODO`, `FIXME`, placeholder or
template content, hard-coded server/data paths, debug console output, dead
modules/dependencies, duplicate UI constants, generated comments, and
`unwrap`/`expect` in server request paths. Inspect migration checksums, the full
tree/history, and a clean working tree.

Push `dev` without force, then monitor both quality and image workflows. Fix any
backend, frontend, E2E, amd64 image, or native arm64 image failure before handoff.
