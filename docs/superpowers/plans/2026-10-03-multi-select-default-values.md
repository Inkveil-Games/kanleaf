# Multi-select default values implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement and review each task. Keep all changes uncommitted on the existing `dev` checkout until the user's preview review.

**Goal:** Select multiple default values in Workspace Settings and automatically assign them to newly created Tasks.

**Architecture:** Preserve the existing single-select `default_option_id` contract. Add `default_option_ids: UUID[]` for custom multi-select definitions, backed by a tenant-safe join table referencing options. Task creation applies active defaults in its existing Workspace-locked transaction and uses the existing Markdown projection path. If Labels are in scope, use a corresponding `default_label_ids` configuration and tenant-safe join table; omitted task labels receive defaults, explicit labels (including an empty array) remain authoritative.

**Tech Stack:** Rust/Axum/SQLx/PostgreSQL, React/TypeScript, existing Settings/checkbox controls, Vitest/Playwright.

**Spec:** User request in this conversation: Multi select values can be ticked as defaults; each new Task automatically has those values. User explicitly requested implementation and requires a hosted preview before saying “xong”. Labels scope is being clarified asynchronously; default assumption includes Labels because they are presented as Multi select.

## Global constraints

- Preserve all current uncommitted Properties redesign work on `dev`.
- No commits, pushes, merges, or production data changes while preview approval is pending.
- Server validates Workspace ownership, active options, duplicates, property type, and management permission; retain existing Workspace locks and projection/recovery mechanisms.
- Empty defaults clear the setting; omitted PATCH fields preserve it. Defaults affect new Tasks only.
- Preserve explicit values and existing single-select defaults. Archived/deleted choices cannot remain defaults or be applied.
- Existing portable archives without the new fields still import. Export/import must preserve defaults and remap option/label identities.

## Review focus

- Defaults on newly added options must persist in the same save, with client UUIDs resolved consistently.
- Foreign Workspace/property and archived option IDs must be rejected atomically.
- Removing or archiving default choices must clear defaults without changing existing Tasks.
- Explicit empty Task values must not be replaced by defaults.
- Legacy exports must remain readable; imported defaults must reference remapped IDs.

## Task 1: Server configuration, creation and portability

**Files:** `apps/server/migrations/0030_multi_select_defaults.sql`; `apps/server/src/custom_property/{definition,value}.rs`; `apps/server/src/task.rs`; `apps/server/src/portability/{config,import,import_archive}.rs`; `apps/server/tests/{custom_properties,workspace_export,workspace_import,postgres_schema}.rs`. If Labels are confirmed: owning files in `apps/server/src/task_config` plus nearest task/config tests.

**Interfaces:** Custom property response always includes `default_option_ids: Vec<Uuid>`; create/define accept an optional array (empty by default); update accepts an optional array (`[]` clears). It applies to Multi select only and coexists with unchanged nullable single-select `default_option_id`. Labels, if included, use TaskConfiguration `default_label_ids: Vec<Uuid>` and optional array in configuration PATCH. Existing task creation accepts omitted/explicit labels with the semantics above.

- [x] Add API integration tests for multiple defaults on create/update/define; task creation and Markdown projection; clear/default option removal; invalid type, duplicates, foreign and archived IDs; unchanged existing Tasks and single-select behavior.
- [x] Run the focused tests and confirm the missing behavior fails.
- [x] Implement migration, transactional validation/persistence, creation defaults, and archive/delete cleanup. Preserve existing API compatibility.
- [x] Extend portable configuration, validation and import identity remapping; add backward compatibility and round-trip tests.
- [x] Run focused PostgreSQL targets, fmt, unit tests and clippy. Supply a reviewable diff and record verification. No commit.

## Task 2: Frontend default selection

**Files:** `apps/desktop/src/features/settings/SelectValueEditor.tsx`; `apps/desktop/src/features/custom-properties/{PropertyEditor,api}.ts*`; `apps/desktop/src/features/workspace/types.ts`; nearest tests; `global.css` only if the existing checkbox styling needs adjustment. If Labels are included: `task-config/{LabelSettings,api}.ts*`, task creation UI to preserve omitted versus explicit labels.

**Interfaces:** Consume Task 1's UUID arrays. Multi select uses independent checkboxes; Single select retains its single-choice behavior. Checkboxes work both in rows and Add/Edit value popovers. Temporary IDs are mapped on save; removing/archiving a selected value clears that selection.

- [x] Add interaction tests for two defaults, unchecking one, removing/archiving a default, saving new options, loading saved defaults, and preserving single-select behavior.
- [x] Confirm failing tests, then implement with existing primitives and accessible labels.
- [x] Verify owner/admin editing and member disabled state; preserve the previous UI redesign and row ordering.
- [x] Run relevant frontend tests, typecheck, lint and format. Supply reviewable diff; no commit.

## Task 3: Integrated verification and hosted preview

**Files:** `docs/architecture.md` for the final contract; existing e2e workflow if required; ignored `/tmp/kanleaf4-properties-preview` preview tooling.

- [x] Build the changed server from this checkout; restart only the dedicated preview backend on 3114 using its isolated database/vault; keep source preview on 1435.
- [x] Exercise the real UI: select two defaults, save/reload, create a Task and verify its values and Markdown; uncheck one and verify a subsequent Task; prior Task unchanged.
- [x] Check narrow/wide layouts, keyboard interaction and read-only members; run full applicable frontend/server verification.
- [x] Obtain final code review, resolve findings, document verification, and provide the running preview link for user approval.
