# Canonical Vault and Shared Milkdown Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship vault layout v3, shared Workspace assets, and one autosaving Milkdown Crepe/CodeMirror Markdown edit session for real Tasks and Library Pages.

**Architecture:** Typed vault identities derive live paths from public Workspace/Project identifiers, task numbers, and stable Library segments. A recoverable staged startup migration upgrades old trees. `MarkdownDocument` owns one local Markdown draft and lazy-loads either Milkdown or CodeMirror; a shared asset pipeline stores portable opaque references.

**Tech Stack:** Rust 2024, Axum, SQLx/PostgreSQL, Tokio filesystem APIs, React 19, TypeScript, TanStack Query, Milkdown 7.22.2, CodeMirror 6, React Markdown/GFM, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-canonical-vault-milkdown-design.md`

## Global Constraints

- Markdown remains canonical; never persist ProseMirror JSON.
- Task and Library use `MarkdownDocument`; no target-specific editor components.
- Editable documents open directly in lazy Milkdown Crepe; read-only rendering stays lightweight.
- Use debounced autosave; no Split, old Live Preview, base64 images, or deployment-specific Markdown URLs.
- Existing authorization, revision, transition, migration, and recovery guarantees remain.
- Do not commit or push before explicit user approval.

## Review Focus

- An interrupted v3 activation must recover using UUID metadata while restoring the identifier-named root.
- A Task title/Project change must patch frontmatter without changing `tasks/<number>.md`.
- A nested Project Library Page must retain companion-directory semantics under the Project identifier.
- Unsupported Markdown must never be silently normalized by visual editing.
- Authenticated asset rendering must revoke object URLs and never leak one Workspace's asset to another.

---

### Task 1: Typed vault layout v3

**Files:**

- Modify: `apps/server/src/vault/layout.rs`
- Modify: `apps/server/src/vault.rs`
- Modify: `apps/server/src/domain/mod.rs`
- Test: `apps/server/src/vault.rs`

**Interfaces:**

- Produces: typed Workspace identifier root, Project identifier directory, flat numeric `TaskPath`, hierarchical `LibraryPath`, and opaque `AssetPath`.

- [ ] Write failing path/security tests for every canonical path and traversal case.
- [ ] Run focused Rust tests and confirm v2 expectations fail.
- [ ] Implement the minimal typed v3 paths and central ancestor validation.
- [ ] Run focused Rust tests and retain legacy parsers only in compatibility modules.

### Task 2: Recoverable workspace migration v3

**Files:**

- Create: `apps/server/migrations/0032_canonical_vault_layout.sql`
- Modify: `apps/server/src/vault/migration.rs`
- Modify: `apps/server/src/workspace/vault_migration.rs`
- Modify: `apps/server/src/main.rs`
- Test: `apps/server/src/vault.rs`
- Test: `apps/server/tests/workspaces.rs`

**Interfaces:**

- Consumes: Task number, Workspace/Project identifier, stable Library segments.
- Produces: staged activation/rollback/recovery manifest carrying Workspace UUID and identifier.

- [ ] Add failing v0/v2 fixture, collision, Unicode, symlink, rollback, crash recovery, and idempotency tests.
- [ ] Implement staged inventory/copy/verification and version-3 database transition.
- [ ] Run focused unit and PostgreSQL integration tests.

### Task 3: Runtime operations and portability use v3

**Files:**

- Modify: `apps/server/src/task.rs`, `apps/server/src/task/**`
- Modify: `apps/server/src/document.rs`, `apps/server/src/document/**`
- Modify: `apps/server/src/vault/{task_operation,library_operation,project_deletion,workspace_deletion}.rs`
- Modify: `apps/server/src/{project,workspace}.rs`
- Modify: `apps/server/src/portability/**`
- Test: `apps/server/tests/{tasks,documents,project_access,workspace_access,vault_sync,workspace_export,workspace_import,workspaces}.rs`

**Interfaces:**

- Consumes: v3 typed paths.
- Produces: canonical create/read/write/delete/move/export/import/sync behavior.

- [ ] Add failing Task immobility, Library move, deletion, sync, export, and import assertions.
- [ ] Remove live Task move operations; keep only old-manifest startup compatibility.
- [ ] Update Library/project/workspace operations and archive inventory/path validation.
- [ ] Run focused Rust and PostgreSQL integration tests.

### Task 4: Workspace asset API and vault storage

**Files:**

- Create: `apps/server/src/asset.rs`
- Modify: `apps/server/src/lib.rs`
- Modify: `apps/server/src/http.rs`
- Modify: `apps/server/src/vault.rs`
- Test: `apps/server/tests/assets.rs`

**Interfaces:**

- Produces: `POST /api/workspaces/:workspace_id/assets/images` and authenticated image read route returning `kanleaf-asset://images/<opaque-name>`.

- [ ] Add failing authorization, MIME/magic/size/empty/traversal/collision tests.
- [ ] Implement one bounded multipart upload path and authenticated streaming read.
- [ ] Verify opaque files remain inside `assets/images` and duplicate originals cannot collide.

### Task 5: Autosaving shared edit-session state

**Files:**

- Modify: `apps/desktop/src/features/markdown/MarkdownDocument.tsx`
- Modify: `apps/desktop/src/features/markdown/MarkdownSourceEditor.tsx`
- Modify: `apps/desktop/src/features/markdown/DocumentSaveCoordinator.tsx`
- Test: `apps/desktop/src/features/markdown/MarkdownDocument.test.tsx`

**Interfaces:**

- Produces: direct Editor/Source editing, one draft, autosave/conflict/transition state.

- [ ] Replace existing tests with failing direct-editor, autosave, tab-sync, shortcut, read-only, target-reset, error/conflict, and coordinator cases.
- [ ] Implement the minimal state machine and Source-only CodeMirror.
- [ ] Run focused Vitest and confirm a tab switch alone does not write the backend.

### Task 6: Lazy Milkdown Crepe visual editor

**Files:**

- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/desktop/src/features/markdown/MilkdownEditor.tsx`
- Create: `apps/desktop/src/features/markdown/markdownRoundTrip.ts`
- Test: adjacent `*.test.tsx` / `*.test.ts`

**Interfaces:**

- Consumes: canonical Markdown draft and shared target context.
- Produces: Milkdown Crepe 7.22.2 commonmark+GFM editing, playground-style block controls, and a lossy-input gate.

- [ ] Install matching official Milkdown packages with pnpm.
- [ ] Add failing core-format, GFM, English/Vietnamese round-trip, block-menu, drag-handle, and unsupported-input tests.
- [ ] Implement lazy Crepe editor, listener/serializer synchronization, and shared block controls.
- [ ] Run focused Vitest, typecheck, and inspect Vite chunk splitting.

### Task 7: Shared client asset pipeline and rendering

**Files:**

- Create: `apps/desktop/src/features/markdown/assets.ts`
- Create: `apps/desktop/src/features/markdown/MarkdownAssetImage.tsx`
- Modify: `apps/desktop/src/features/markdown/{api,MarkdownPreview,MarkdownVisualEditor,MarkdownEditorToolbar}.tsx`
- Test: adjacent Markdown tests.

**Interfaces:**

- Produces: one upload function for paste/drop/picker and one authenticated resolver for Reading/Milkdown.

- [ ] Add failing paste/drop/picker, failure-preservation, and reading-render tests.
- [ ] Implement multipart upload, object-URL lifecycle, and portable URI insertion.
- [ ] Run focused Vitest and server asset tests.

### Task 8: Native styling and obsolete-system removal

**Files:**

- Modify: `apps/desktop/src/styles/{tokens,global}.css`
- Delete: `apps/desktop/src/features/markdown/livePreview.tsx`
- Delete: `apps/desktop/src/features/markdown/livePreview.test.ts`
- Modify: `apps/desktop/src/features/markdown/MarkdownSourceEditor.test.tsx`
- Test: Task/Library integration tests.

**Interfaces:**

- Produces: one responsive Kanleaf toolbar/editor surface in light/dark themes.

- [ ] Add/adjust observable integration and responsive behavior tests.
- [ ] Remove Live/Split extensions and obsolete CSS; theme Milkdown with existing tokens.
- [ ] Verify Task and Library still import the same `MarkdownDocument` and preserve surrounding behavior.

### Task 9: Documentation, full local validation, and interactive preview

**Files:**

- Modify: `docs/architecture.md`
- Modify: `docs/development.md`
- Modify: relevant e2e fixtures/specs under `apps/desktop/e2e`

**Interfaces:**

- Produces: current architecture documentation and real hosted review environment.

- [ ] Document v3 paths, migration/recovery, assets, and editor semantics.
- [ ] Run format, focused/full frontend tests, typecheck, lint, build, Rust format/clippy/tests, and relevant SQLx tests.
- [ ] Seed representative Task/Library Markdown and image data.
- [ ] Start the supported Kanleaf app, verify Task and Library interactively, and report the review URL without committing or pushing.
