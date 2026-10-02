# Date and built-in property defaults implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement and review each task. Keep work uncommitted on the current dev checkout; the user requires the running source preview before saying “xong”.

**Goal:** Finish the user's three queued requests: Date defaults, Type tooltip, and consistent built-in property forms with editable defaults.

**Architecture:** Extend the existing property and Workspace configuration APIs. Persist typed Date defaults for custom Date and built-in Start/Due; compute dates once at Task creation using the creator's account timezone. Reuse existing Workspace State defaults and add Workspace Priority default. Keep fixed built-in identities and values immutable while permitting default selection. Existing projection, permissions, portability and draft-save behavior remain authoritative.

**Tech Stack:** Rust/Axum/SQLx/PostgreSQL, existing chrono/jiff, React/TypeScript, shared Settings/Select/Tooltip/date controls, Vitest and Playwright.

**Spec:** User queue and authorization in this conversation: Fixed/Dynamic Date defaults, compact number plus units before/after; move Type immutability helper to a tooltip; State/Priority same format as equivalent properties, no lock treatment, editable defaults but no adding/editing/deleting fixed values. “làm tiếp đi” authorizes implementing all three now.

## Global constraints

- Preserve all existing uncommitted Properties and multi-select-default changes on dev. No commit, push, merge, or real user-data mutation.
- Retain existing Workspace/admin authorization, transaction/locking and task/config projection boundaries.
- Date default API type: `null | {mode: "fixed", date: "YYYY-MM-DD"} | {mode: "dynamic", amount: integer >= 0, unit: "day" | "week" | "month" | "year", direction: "before" | "after"}`. Invalid, negative/fractional/overflowing settings fail validation. Month/year offsets clamp to the target month's last valid day. Zero means today.
- Dynamic dates are relative to the creator's local calendar date at Task creation using their saved account timezone. Resolve once, persist ordinary dates, and leave existing Tasks unchanged when defaults change. Do not add dependencies for timezone/calendar calculations; chrono/jiff already exist.
- Custom property GET/create/define/PATCH uses nullable `default_date`; valid only for Date. PATCH omission preserves, null clears. Archived definitions do not apply defaults. Define/import preserve existing explicit values.
- TaskConfiguration GET/PATCH adds `default_priority` (existing priority enum, default none), nullable `default_start_date`, nullable `default_due_date`. PATCH omission preserves; null date clears. Existing `state_id` PATCH / `default_state_id` GET remain unchanged.
- Task creation: omitted priority/start_date/due_date use defaults; explicit priority none and explicit date null stay authoritative. Validate effective start/due schedule after resolving defaults; no partial creation on invalid schedules. State respects existing Project default precedence; Workspace State setting applies to Inbox.
- Include new fields in portable configuration, validation and import. Old archives missing them import with none/null defaults. Add ordered migration0031; do not modify0030 already applied to preview.
- Built-in Names/Types and State/Priority value identities/names/descriptions/colors/order remain fixed. State description uses its existing editable configuration; no new renaming/vocabulary-editing capability. Other built-in descriptions may remain read-only in the shared form. Owners/admins edit defaults; members view disabled controls.
- Keep Labels first, existing requested builtin subset above custom properties, no Status column. Tooltip replaces inline Type helper for all existing property types and supports pointer/keyboard.

## Review focus

- Month ends, leap days, before offsets, zero and local date near UTC midnight.
- Distinguish omitted Task create fields from explicit null/none; validate combined default dates with explicit dates.
- Date defaults on archived/non-Date definitions and malformed imported JSON must not silently apply.
- API load/error/refetch and Save retry must not discard edits; member controls remain nonmutating.
- Tooltip must be reachable even when Type itself cannot be changed; keep Name/Type and value headers aligned at narrow widths.

## Task 1: Server defaults and portability

**Files:** create `apps/server/migrations/0031_date_and_builtin_defaults.sql`, `apps/server/src/domain/date_default.rs`; modify domain module export, `custom_property/{definition,value}.rs`, `task_config/mod.rs`, `task.rs`, `portability/{config,import,import_archive}.rs`; nearest domain/SQLx tests.

**Interfaces:** Implement the exact DateDefault union and fields in Global constraints. Expose all new response fields consistently. A pure date resolver accepts an explicit reference date for deterministic testing; the Task handler computes one creator-local reference date shared by built-in and custom defaults. Preserve existing scalar/plural select defaults.

- [x] Add failing date arithmetic and API tests for create/update/define, fixed/dynamic resolution, priority defaults, explicit overrides/clears, unchanged existing Tasks, permissions/foreign State, invalid types/date settings, Markdown and portability/backward imports.
- [x] Implement validation, persistence, migration/projection and creation semantics, reusing chrono/jiff and existing transactions.
- [x] Run focused PostgreSQL groups plus fmt/clippy/unit and all-features suites. No commits; report evidence for task review.

## Task 2: Consistent property editors

**Files:** create shared `apps/desktop/src/features/settings/DateDefaultEditor.tsx` and nearest tests; modify custom-property `PropertyEditor`, `BuiltInPropertyDetails`, `builtInProperties`, `PropertiesSettings`, shared `SelectPropertyEditor`/`SelectValueEditor` if needed, feature API/types/fixtures, `global.css`, nearest tests/e2e.

**Interfaces:** Consume Task1 fields exactly. A shared DateDefaultEditor works for custom Date and Start/Due. None/Fixed/Dynamic selector; Fixed uses existing date control; Dynamic uses an amount input beside one compact offset selector (Days/Weeks/Months/Years after or before), backed by separate unit/direction fields, with concise calendar explanation and a date example if useful. Built-in State/Priority use the same shared value row grid with radio defaults and existing State/Priority icons, while hiding add/edit/delete/archive/reorder controls. Keep names/types fixed, remove lock badges/icons/readonly banner. Save through TaskConfiguration, refresh after success, preserve error/retry.

- [x] Write failing tests for Date mode transitions, save/load/clear, built-in State/Priority default selection, member disabled controls, fixed value immutability, and keyboard Type tooltip.
- [x] Implement compact responsive controls using existing tokens/primitives; no new generic framework. Remove the inline immutability helper everywhere.
- [x] Run relevant tests/typecheck/lint/format and report evidence; preserve earlier Labels retry fix and multi-select defaults.

## Task 3: Preview, documentation and final review

**Files:** `docs/architecture.md`; ignored preview tools and task ledger/report.

- [x] Build updated backend and restart only isolated preview3114; keep Vite1435 running.
- [x] Real-browser save/reload/create workflow verifies custom Date, Start/Due, Priority and State defaults plus explicit empty fields, persisted Markdown, unchanged existing Tasks, Type tooltip and immutable fixed values.
- [x] Inspect wide960/narrow740 layouts in both themes and keyboard interactions. Run full frontend suite/build and current diff/format checks.
- [x] Review final integrated changes; resolve concrete findings and provide running source preview. No commit/signoff on user's behalf.
