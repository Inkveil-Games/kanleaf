# Kanleaf Library Vault Implementation Plan

**Design:** `docs/superpowers/specs/2026-08-29-kanleaf-library-vault-design.md`

## Delivery sequence

### 1. Portable storage-name domain and schema

Files:

- add `apps/server/migrations/0011_library_storage.sql`;
- update `apps/server/src/domain/mod.rs`;
- update `apps/server/src/document.rs` and
  `apps/server/src/document/persistence.rs`;
- update PostgreSQL schema/document tests.

Work:

1. Add a failing domain test for Unicode names, forbidden characters, reserved
   names, byte truncation, empty fallback, and suffix generation.
2. Implement the smallest `LibraryStorageName` value object using the Rust
   standard library.
3. Add `documents.storage_name`, backfill legacy rows with lowercase UUIDs,
   enforce the byte/segment checks, and add the sibling uniqueness constraint.
4. Add storage name to locked/query response records and allocate a unique
   canonical name under the Workspace document lock.
5. Add tests for root collisions across Workspace/Project metadata and child
   collisions within a parent.

Verification:

```bash
cargo test --locked -p kanleaf-server domain::tests
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked -p kanleaf-server --features postgres-tests --test postgres_schema -- --test-threads=1
```

### 2. Typed Library paths and faithful content I/O

Files:

- update `apps/server/src/vault.rs`;
- update `apps/server/src/document/persistence.rs`;
- update `apps/server/src/document/content.rs`;
- update `apps/server/src/document.rs`;
- update vault and document integration tests.

Work:

1. Add temporary-directory tests for the parent-note/companion-directory shape,
   nested content, traversal rejection, symlink rejection, and revisions.
2. Add a typed `LibraryPath` made only from validated storage-name segments.
   Keep Task document APIs unchanged.
3. Add one persistence query that resolves an authorized document's ancestor
   segments in root-to-leaf order and enforces the depth/path bounds.
4. Change Page content create/read/write APIs to accept `LibraryPath` instead of
   an arbitrary path or UUID.
5. Return `storage_name` and the vault-relative `library_path` in document API
   responses without exposing the host data root.
6. Preserve `create_new`, temporary-file rename, SHA-256 revision checks, and
   rollback of an unattached file.

Verification:

```bash
cargo test --locked -p kanleaf-server vault::tests
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked -p kanleaf-server --features postgres-tests --test documents -- --test-threads=1
```

### 3. Restartable legacy Page migration

Files:

- add `apps/server/src/library_migration.rs` only if the startup workflow is too
  cohesive for the existing `document` module;
- update `apps/server/src/lib.rs`, `apps/server/src/main.rs`, and
  `apps/server/src/vault.rs`;
- add focused migration integration tests.

Work:

1. Seed a database and temporary vault with `Pages/<uuid>.md` files and assert
   the desired nested Library result before implementing migration.
2. Run Library recovery and migration after SQLx migrations and before binding
   the HTTP listener.
3. Process one Workspace at a time in deterministic parent-before-child order.
4. Write recovery manifests under `KANLEAF_DATA_DIR/operations`, including
   document ID, generated source/destination, and source revision.
5. Move bytes without rewriting them, update `storage_name`, remove the
   manifest after commit, and remove `Pages/` only when empty.
6. Make retry after interruption converge, and fail closed on a missing or
   mismatched manifest rather than overwrite data.

Verification:

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked -p kanleaf-server --features postgres-tests --test documents -- --test-threads=1
```

### 4. Safe subtree move and deletion lifecycle

Files:

- update `apps/server/src/vault.rs`;
- update `apps/server/src/document.rs` and persistence helpers;
- extend vault/document integration tests.

Work:

1. Add failing tests for leaf reparent, parent subtree reparent, destination
   collision, database rollback, interrupted move recovery, and subtree purge.
2. Validate every destination path in the moved subtree before the first
   filesystem operation.
3. Move the root `.md` and companion directory with a recovery manifest and a
   typed compensation handle.
4. Commit the structured move only after filesystem success; restore the old
   location on SQL failure.
5. Replace per-document permanent-delete trash with one subtree file/directory
   trash operation so children are not moved twice.
6. Remove an empty companion directory only after the last child leaves it.
7. Leave title rename as metadata-only and preserve storage names.

Verification:

```bash
cargo test --locked -p kanleaf-server vault::tests
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked -p kanleaf-server --features postgres-tests --test documents -- --test-threads=1
```

### 5. Commit the server capability

Before committing:

```bash
cargo fmt --all --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf cargo test --locked --workspace --all-features -- --test-threads=1
```

Review the migration checksum, comments, path construction, SQL authorization,
and unrelated diff. Commit as:

```text
feat(library): store documents in portable Markdown trees
```

### 6. Product language and collapsible Library tree

Files:

- update `apps/desktop/src/features/document/types.ts`;
- update `apps/desktop/src/features/document/tree.ts`;
- update `apps/desktop/src/features/document/DocumentTree.tsx`;
- update `apps/desktop/src/features/document/DocumentWorkspace.tsx`;
- update `apps/desktop/src/features/document/DocumentDetail.tsx`;
- update Workspace/Project navigation, overview, feature settings, CSS, and
  focused React tests.

Work:

1. Add pure tests that flatten only visible nodes from an expanded-ID set.
2. Add interaction tests proving chevron expansion does not select, title
   selection does not toggle, child creation expands its parent, and stale
   expansion IDs are harmless.
3. Persist expanded IDs locally by Workspace and view scope. Default roots with
   children to expanded on first load so existing trees do not appear empty.
4. Implement accessible Up/Down/Left/Right/Enter/F2 behavior over visible rows.
5. Rename all user-facing Pages/Documents copy to Library while retaining
   internal `documents` and `pages_enabled` identifiers.
6. Show `library_path` read-only in the detail metadata and label the context
   action `Rename title`.
7. Confirm reparent with the temporary manual-link warning before calling the
   existing update endpoint.
8. Keep the compact pane/row styling, distinct selection and expansion states,
   ellipsis for long titles/paths, and visible focus.

Verification:

```bash
pnpm --filter @kanleaf/desktop typecheck
pnpm --filter @kanleaf/desktop lint
pnpm --filter @kanleaf/desktop test
pnpm --filter @kanleaf/desktop build
```

Commit as:

```text
feat(library): add collapsible Markdown navigation
```

### 7. End-to-end migration, persistence, and visual review

Files:

- update `apps/desktop/e2e/core-workflow.spec.ts`;
- update README and architecture/development docs;
- update existing test fixtures and copy assertions.

Work:

1. Extend E2E to create `Getting Started`, create and edit an `Installation`
   child, collapse/expand the parent independently, reload, and verify content.
2. Assert the real temporary vault contains:

   ```text
   Library/getting_started.md
   Library/getting_started/installation.md
   ```

3. Add a restart/migration fixture with legacy `Pages/<uuid>.md` content and
   verify unchanged bytes at the new path.
4. Verify a second Workspace cannot read metadata, content, or inferred paths.
5. Run the browser app and review wide/narrow layouts, light/dark themes, deep
   nesting, long titles/paths, focus, hover, selection, collapse, empty,
   loading, conflict, and error states.
6. Update docs with the new `Library/` filesystem contract and the fact that
   title rename does not rename files.

Commit coherent test/docs changes as needed, using Conventional Commit
messages rather than folding unrelated cleanup into the UI commit.

### 8. Final verification, push, and CI

Run:

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

Search for stale Pages/Documents UI copy, TODO/FIXME/template/debug output,
unsafe paths, server request-path unwrap/expect calls, dead dependencies, and
generated comments. Inspect the final tree, diff, migration order, Git history,
and clean status. Push `dev`, monitor backend/frontend/E2E jobs to completion,
and fix any failure before handing off.
