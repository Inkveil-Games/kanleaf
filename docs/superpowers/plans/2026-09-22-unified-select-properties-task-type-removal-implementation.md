# Unified Select Properties and Task Type Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give State, Labels, and custom select properties one editor contract,
replace State Group with three stable system roles, and remove Task Type while
preserving meaningful legacy data as a custom `Type` property.

**Architecture:** State, Labels, and custom options keep their existing
domain-specific tables and server use cases. Two ordered migrations perform an
expand/promote/contract transition, while shared React Settings components own
the common editor and value-row presentation. PostgreSQL remains canonical;
Markdown and portable configuration are updated through the existing durable
projection and import boundaries.

**Tech Stack:** PostgreSQL 17 migrations, Rust 2024/Axum/SQLx, React 19/strict
TypeScript, TanStack Query, Base UI, Lucide, dnd-kit, Vitest/Testing Library,
Playwright.

**Spec:**
`docs/superpowers/specs/2026-09-22-unified-select-properties-task-type-removal-design.md`

## Global Constraints

- Never rewrite migrations `0001` through `0025`; add ordered migrations.
- Preserve Task, State, Label, custom definition, option, and value UUIDs where
  the spec says identity survives.
- Keep `Todo`, `In Progress`, and `Done` active with immutable name, icon, color,
  and semantic role; only description and position are mutable.
- Keep Labels as multi-select and State as single-select.
- Store selected custom options by UUID, never by label, in PostgreSQL.
- Remove Task Type and State Group from product UI, API, schema, query contract,
  Markdown fixed keys, portability, and webhook version 2.
- Keep raw HTML disabled in Markdown preview.
- Use existing Base UI, Settings, color, sorting, query, authorization, and
  projection primitives; add no dependency.
- All Workspace reads require membership; all vocabulary/default/order writes
  require Workspace Admin rights.
- Preserve unknown top-level Markdown fields and revision-check every vault
  write.
- Commits use Conventional Commit messages and contain no unrelated changes.

## Review Focus

- A Workspace whose canonical State was renamed, archived, duplicated within a
  group, or used as a default must finish with exactly one core row per role and
  no broken Task/default foreign key; Task 1 pins every branch.
- Archived Task Types may duplicate active names; promotion must suffix only
  ambiguous archived options while retaining their UUID assignments; Task 1
  pins this case.
- A crash after PostgreSQL promotion but before Markdown projection must leave a
  retryable job that either removes or re-owns `Type` without touching unknown
  fields; Task 4 pins retry and cleanup behavior.
- A saved view may combine State Group and Task Type filters/groupings; migration
  must produce a valid version-2 query with State IDs and no invalid duplicate
  grouping; Task 3 pins the combined case.
- A legacy portable archive may contain project-specific Type defaults and old
  `Type` frontmatter; import must preserve existing Task values, select one
  Workspace default, and never expose `Type` as an undefined field; Task 5 pins
  this archive.

---

## File and responsibility map

### Database and server domain

- Create `apps/server/migrations/0026_unified_select_properties_expand.sql`:
  add editor fields and defaults, choose system States, promote meaningful Task
  Types, and enqueue projections while legacy columns still exist.
- Create `apps/server/migrations/0027_remove_task_types_and_state_groups.sql`
  during the core server cutover: rewrite saved-view JSON, advance query version
  constraints, and drop legacy Type/State Group storage after promotion.
- Modify `apps/server/src/domain/mod.rs`: add validated `SystemStateRole` and
  `SelectOptionIcon` values; remove the legacy `TaskStateGroup` and
  `TaskTypeIcon` only after their core and legacy-portability consumers are
  migrated.
- Modify `apps/server/src/task_config/{mod,state,label}.rs`: expose the new
  State/Label contract, property descriptions, defaults, ordering, and core
  State guards.
- Delete `apps/server/src/task_config/task_type.rs`: remove all Task Type routes
  and mutations.
- Modify `apps/server/src/custom_property/{definition,value}.rs`: persist option
  icon/description/default and apply active single-select defaults on Task
  creation.
- Modify `apps/server/src/{workspace,project,task}.rs` and
  `apps/server/src/task/{model,query_engine,planning}.rs`: remove Type-specific
  fields and use State semantic roles.
- Modify `apps/server/src/project/{cycle,module}.rs`: count completion from the
  `done` semantic role.
- Modify `apps/server/src/{saved_view,domain_event}.rs` and
  `apps/server/src/domain/events.rs`: serve query version 2 and webhook version
  2 without Task Type.

### Markdown and portability

- Modify `apps/server/src/task/{frontmatter,projection}.rs`: remove fixed
  `Type`, render a migrated custom `Type`, and preserve cleanup jobs.
- Modify `apps/server/src/portability/{config,archive,import,import_archive,sync}.rs`:
  export new formats and normalize immediately preceding legacy formats.
- Modify `apps/server/src/portability/mod.rs` only where format dispatch needs
  an explicit legacy/current enum.

### Desktop UI

- Create `apps/desktop/src/features/settings/propertyIcons.tsx`: one curated
  Lucide option registry and resolver for selectable value icons.
- Create `apps/desktop/src/features/settings/SelectPropertyEditor.tsx`: common
  fixed/editable name, type, description, value-section, and action layout.
- Replace `apps/desktop/src/features/custom-properties/SelectOptionEditor.tsx`
  with a domain-neutral controlled value editor under
  `apps/desktop/src/features/settings/SelectValueEditor.tsx`; update imports.
- Modify `apps/desktop/src/components/ui/IconPicker.tsx`: add nullable no-icon
  selection without weakening keyboard behavior.
- Modify `apps/desktop/src/features/custom-properties/PropertyEditor.tsx` and
  `apps/desktop/src/features/custom-properties/api.ts`: edit icon, description,
  and single-select default.
- Rewrite `apps/desktop/src/features/task-config/{StateSettings,LabelSettings,TaskConfigurationSettings}.tsx`
  and `api.ts`: use the common editor and remove Task Type.
- Delete `apps/desktop/src/features/task-config/TaskTypeSettings.tsx`,
  `apps/desktop/src/features/task-config/TaskTypeIcon.tsx`, and
  `apps/desktop/src/features/task-config/taskTypeIcons.ts`.
- Modify Workspace, Project, Task, and View feature files returned by
  `rg -l 'task_type|TaskType|state_group|TaskStateGroup' apps/desktop/src` so no
  special Type or group contract remains.
- Modify `apps/desktop/src/styles/global.css`: define the shared editor grid and
  responsive behavior once.

### Tests and docs

- Update server integration tests in `apps/server/tests/{postgres_schema,task_configuration,custom_properties,tasks,task_workflow,project_access,project_planning,saved_views,vault_sync,workspace_export,workspace_import,webhooks,webhook_contract}.rs`.
- Update `apps/server/tests/fixtures/webhook-payloads.json`.
- Update desktop tests adjacent to every changed feature and
  `apps/desktop/e2e/core-workflow.spec.ts`.
- Update `docs/architecture.md` and `docs/webhooks.md`.

---

### Task 1: Expand the PostgreSQL model and promote legacy data

**Files:**

- Create: `apps/server/migrations/0026_unified_select_properties_expand.sql`
- Modify: `apps/server/tests/postgres_schema.rs`

**Interfaces:**

- Produces: `task_states(icon, description, system_role)` with one required core
  row for each role; `task_labels(icon, position)`;
  `custom_property_options(icon, description)`;
  `custom_property_definitions.default_option_id`; and Workspace property
  descriptions.
- Produces: migrated `Type` definition/options/values plus durable projection
  jobs for every affected Task.
- Preserves temporarily: Task Type and State Group tables/columns so the
  pre-cutover server remains runnable between the expansion and contraction
  commits. Task 3 removes them.
- Consumes: the exact schema through migration `0025` and the existing
  `task_projection_jobs.cleanup_property_names` mechanism.

- [ ] **Step 1: Add a migration-upgrade test that constructs legacy edge cases**

Add a `#[sqlx::test(migrations = false)]` test named
`unified_select_expand_migration_preserves_identity_and_promotes_meaningful_types`.
Apply migrations `0001` through `0025`, then insert:

```rust
let workspace_plain = Uuid::new_v4();
let workspace_meaningful = Uuid::new_v4();

// plain: only protected Task type and the seeded five States
// meaningful: renamed Todo candidate, duplicate in_progress rows,
// archived Done, active+archived duplicate "Bug" types, project defaults,
// tasks assigned to both type UUIDs, and a saved view combining
// state_groups + task_types filters and groupings.
```

After applying `0026`, assert exact core names/roles, preserved State and option
UUIDs, normalized archived duplicate names, custom values containing the former
Type UUID strings, and projection jobs containing `Type`. Also assert the
legacy columns still exist at this expansion checkpoint.

- [ ] **Step 2: Run the upgrade test and verify the missing migrations fail it**

Run:

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --test postgres_schema \
  unified_select_expand_migration_preserves_identity_and_promotes_meaningful_types \
  --features postgres-tests --locked -- --exact
```

Expected: FAIL because migration `0026` does not exist.

- [ ] **Step 3: Write the expansion migration**

Create `0026_unified_select_properties_expand.sql` with this dependency order:

```sql
ALTER TABLE workspaces
    ADD COLUMN state_property_description TEXT NOT NULL
        DEFAULT 'The current step of work.',
    ADD COLUMN label_property_description TEXT NOT NULL
        DEFAULT 'Shared tags used to organize work.';

ALTER TABLE workspaces
    ADD CONSTRAINT workspaces_state_property_description_length CHECK (
        char_length(state_property_description) <= 500
    ),
    ADD CONSTRAINT workspaces_label_property_description_length CHECK (
        char_length(label_property_description) <= 500
    );

ALTER TABLE task_states
    ADD COLUMN icon TEXT,
    ADD COLUMN description TEXT NOT NULL DEFAULT '',
    ADD COLUMN system_role TEXT;

ALTER TABLE task_labels ADD COLUMN icon TEXT, ADD COLUMN position INTEGER;
ALTER TABLE custom_property_options
    ADD COLUMN icon TEXT,
    ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE custom_property_definitions ADD COLUMN default_option_id UUID;
```

Backfill Label positions with `row_number() over (partition by workspace_id
order by lower(name), id) - 1`. Rank active State candidates per Workspace and
old group, preferring canonical case-insensitive names and then position/UUID.
Insert a missing candidate, set the selected rows to the canonical core
name/icon/color/role, and give all other legacy States a one-time icon based on
their old group.

Materialize meaningful Workspaces before inserting properties:

```sql
CREATE TEMP TABLE migrated_type_properties (
    workspace_id UUID PRIMARY KEY,
    property_id UUID NOT NULL
) ON COMMIT DROP;

INSERT INTO migrated_type_properties
SELECT workspace_id, gen_random_uuid()
FROM task_types
GROUP BY workspace_id
HAVING count(*) FILTER (
    WHERE NOT (is_protected AND name = 'Task' AND archived_at IS NULL)
) > 0;
```

Insert definition `Type`, reuse `task_types.id` for option IDs, truncate names
before appending a deterministic archived duplicate suffix, insert one
`task_custom_property_values` row per Task, and set `default_option_id` from the
former Workspace default. Enqueue every Task with cleanup name `Type`, using an
upsert that keeps the highest metadata version and unions cleanup names.

Finally add normalized constraints and indexes, including:

```sql
ALTER TABLE task_labels ALTER COLUMN position SET NOT NULL;
ALTER TABLE task_labels ADD CONSTRAINT task_labels_position_valid
    CHECK (position >= 0);
CREATE UNIQUE INDEX task_labels_workspace_position_active_idx
    ON task_labels(workspace_id, position)
    WHERE archived_at IS NULL;

CREATE UNIQUE INDEX task_states_workspace_system_role_idx
    ON task_states(workspace_id, system_role)
    WHERE system_role IS NOT NULL;

ALTER TABLE task_states ADD CONSTRAINT task_states_system_role_valid CHECK (
    system_role IS NULL OR system_role IN ('todo', 'in_progress', 'done')
);

ALTER TABLE task_states ADD CONSTRAINT task_states_system_fields_valid CHECK (
    system_role IS NULL OR (
        archived_at IS NULL AND
        (system_role, name, icon, color) IN (
            ('todo', 'Todo', 'circle', '#64748B'),
            ('in_progress', 'In Progress', 'loader-circle', '#3B82F6'),
            ('done', 'Done', 'circle-check', '#22A06B')
        )
    )
);

ALTER TABLE custom_property_definitions
    ADD CONSTRAINT custom_property_default_type_valid CHECK (
        default_option_id IS NULL OR property_type = 'single_select'
    ),
    ADD CONSTRAINT custom_property_default_option_fk
        FOREIGN KEY (workspace_id, id, default_option_id)
        REFERENCES custom_property_options(workspace_id, property_id, id)
        DEFERRABLE INITIALLY DEFERRED;
```

Add the deferrable composite default-option foreign key only after options are
inserted.

- [ ] **Step 4: Run migration tests and inspect the expanded catalog**

Run the Step 2 command again and:

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --test postgres_schema \
  --features postgres-tests --locked
```

Expected: PASS. Query `information_schema.columns` in the test to prove the new
columns and constraints exist while `task_type_id`, `default_task_type_id`, and
`state_group` remain available for the short expansion window.

- [ ] **Step 5: Commit the database expansion**

```bash
git add apps/server/migrations/0026_unified_select_properties_expand.sql \
  apps/server/tests/postgres_schema.rs
git commit -m "feat(server): expand unified select property data"
```

---

### Task 2: Implement State, Label, and custom-option server contracts

**Files:**

- Modify: `apps/server/src/domain/mod.rs`
- Modify: `apps/server/src/task_config/mod.rs`
- Modify: `apps/server/src/task_config/state.rs`
- Modify: `apps/server/src/task_config/label.rs`
- Modify: `apps/server/src/custom_property/definition.rs`
- Modify: `apps/server/src/custom_property/value.rs`
- Modify: `apps/server/src/workspace.rs`
- Modify: `apps/server/src/task.rs`
- Modify: `apps/server/tests/task_configuration.rs`
- Modify: `apps/server/tests/custom_properties.rs`
- Modify: `apps/server/tests/workspaces.rs`

**Interfaces:**

- Produces:
  `TaskStateResponse { id, workspace_id, name, icon, color, description,
system_role, position, archived_at, created_at, updated_at }`,
  `TaskLabelResponse { id, workspace_id, name, icon, color, description,
position, archived_at, created_at, updated_at }`, and
  `PropertyOptionResponse { id, workspace_id, property_id, name, icon, color,
description, position, archived_at, created_at, updated_at }`.
- Produces:
  `TaskConfigurationResponse { states, labels, default_state_id,
state_property_description, label_property_description }`.
- Produces: `SelectOptionIcon::new_supported(&str)` and
  `SystemStateRole::{Todo, InProgress, Done}`.
- Consumes: Task 1 schema and the existing Workspace lock, projection queue,
  Settings reorder, and authorization patterns.

- [ ] **Step 1: Rewrite configuration integration tests for the new contract**

Replace assertions about five groups and Task Types with assertions that a new
Workspace returns exactly:

```json
[
  { "name": "Todo", "icon": "circle", "system_role": "todo" },
  {
    "name": "In Progress",
    "icon": "loader-circle",
    "system_role": "in_progress"
  },
  { "name": "Done", "icon": "circle-check", "system_role": "done" }
]
```

Add negative tests for renaming/recoloring/re-iconing/archiving/deleting a core
State, a positive test for editing its description and order, custom State
lifecycle/replacement, Label reorder/icon/description, property-description
updates, member read access, and non-Admin write rejection.

In `custom_properties.rs`, add option icon/description round-trip tests and a
single-select default test that creates a Task and asserts its stored option
UUID. Assert archiving/deleting the default clears `default_option_id`.

- [ ] **Step 2: Run focused tests and verify old DTOs fail**

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --test task_configuration \
  --features postgres-tests --locked
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --test custom_properties \
  --features postgres-tests --locked
```

Expected: FAIL on missing fields/routes and still-present Task Type behavior.

- [ ] **Step 3: Add the new domain validators**

In `domain/mod.rs`, add:

```rust
pub enum SystemStateRole {
    Todo,
    InProgress,
    Done,
}

impl SystemStateRole {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Todo => "todo",
            Self::InProgress => "in_progress",
            Self::Done => "done",
        }
    }
}

pub struct SelectOptionIcon(String);

impl SelectOptionIcon {
    pub fn new_supported(value: &str) -> Result<Self, ValidationError>;
    pub fn as_str(&self) -> &str;
}
```

Use the same stable lowercase icon-key allowlist as the desktop catalog. Empty
icons are represented by `Option<SelectOptionIcon>`, not an empty string.
Keep `TaskStateGroup` for Task 3's query cutover and `TaskTypeIcon` for Task 5's
legacy archive normalization; delete each as soon as its last consumer is gone.

- [ ] **Step 4: Implement the new Task configuration response and defaults**

Make `NewWorkspaceTaskConfiguration` own `[Uuid; 3]` for visible States, install
only the three canonical system States, and return Todo from
`default_state_id()`. During the expansion window it also creates the one hidden
legacy `Task` type required by the still-present non-null database columns; do
not return it from any API or route it in Settings. Task 3 removes that internal
compatibility write together with migration `0027`.

Change the configuration PATCH request to:

```rust
struct UpdateTaskConfigurationRequest {
    state_id: Option<Uuid>,
    state_property_description: Option<String>,
    label_property_description: Option<String>,
}
```

Lock the Workspace, validate the active State UUID, validate both descriptions
with `ConfigurationDescription`, update only provided fields, and return the
complete response. Remove Task Type routes and response fields; leave only the
temporary internal default row creation needed by the expansion schema.

- [ ] **Step 5: Implement State and Label value behavior**

State create/update payloads accept `name`, nullable `icon`, `color`, and
`description`; response exposes nullable `system_role`. Before update, select
the row `FOR UPDATE`. If `system_role IS NOT NULL`, reject changes to name,
icon, color, archive state, or permanent deletion. Reorder continues to accept
the complete active ID set, including core rows.

Label create/update accepts nullable icon and position is assigned at the end.
Add `PUT /labels/reorder` using the State reorder transaction pattern. Restore
puts a Label at the end. Icon/name changes enqueue projections for assigned
Tasks; description/color/order-only changes do not rewrite Task Markdown.

- [ ] **Step 6: Implement custom option metadata and defaults**

Extend create/save/update option requests with:

```rust
struct SaveOptionRequest {
    id: Option<Uuid>,
    name: String,
    icon: Option<String>,
    color: String,
    description: String,
    archived: bool,
}
```

Expose `default_option_id` on property create/update/response. Validate that it
is null for non-single-select properties and otherwise names an active option
of the same definition. Clear it before archiving/deleting that option.

Add a helper called by Task creation:

```rust
pub(crate) async fn apply_default_values(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    task_id: Uuid,
) -> Result<(), AppError>;
```

It inserts one JSON string UUID value for each active single-select definition
with an active default and uses `ON CONFLICT (task_id, property_id) DO NOTHING`
so explicit import values win.

Call this helper from the existing Task creation transaction immediately after
the Task row is inserted. The temporary legacy `task_type_id` insert remains in
that SQL until Task 3 applies the contraction migration.

- [ ] **Step 7: Run focused tests and the server unit suite**

Run the Step 2 commands again, then:

```bash
cargo test -p kanleaf-server --lib --locked
cargo fmt --all --check
```

Expected: PASS.

- [ ] **Step 8: Commit the configuration contract**

```bash
git add apps/server/src/domain/mod.rs apps/server/src/task_config \
  apps/server/src/custom_property apps/server/src/workspace.rs \
  apps/server/src/task.rs \
  apps/server/tests/task_configuration.rs apps/server/tests/custom_properties.rs \
  apps/server/tests/workspaces.rs
git commit -m "feat(server): unify select property configuration"
```

---

### Task 3: Remove Task Type and State Group from core server behavior

**Files:**

- Create: `apps/server/migrations/0027_remove_task_types_and_state_groups.sql`
- Modify: `apps/server/tests/postgres_schema.rs`
- Modify: `apps/server/src/task_config/mod.rs`
- Delete: `apps/server/src/task_config/task_type.rs`
- Modify: `apps/server/src/project.rs`
- Modify: `apps/server/src/task.rs`
- Modify: `apps/server/src/task/model.rs`
- Modify: `apps/server/src/task/query_engine.rs`
- Modify: `apps/server/src/task/planning.rs`
- Modify: `apps/server/src/project/cycle.rs`
- Modify: `apps/server/src/project/module.rs`
- Modify: `apps/server/src/saved_view.rs`
- Modify: `apps/server/src/domain_event.rs`
- Modify: `apps/server/src/domain/events.rs`
- Modify: `apps/server/tests/tasks.rs`
- Modify: `apps/server/tests/task_workflow.rs`
- Modify: `apps/server/tests/project_access.rs`
- Modify: `apps/server/tests/project_planning.rs`
- Modify: `apps/server/tests/saved_views.rs`
- Modify: `apps/server/tests/webhooks.rs`
- Modify: `apps/server/tests/webhook_contract.rs`
- Modify: `apps/server/tests/fixtures/webhook-payloads.json`

**Interfaces:**

- Produces: `TaskResponse.state` with `id`, `name`, `icon`, `color`, and
  `system_role`; no `task_type`.
- Produces: Task query version 2 without `state_groups`, `task_types`,
  `StateGroup`, or `TaskType` grouping/display values.
- Produces: webhook event version 2 without `task_type_id`.
- Consumes: Task 2's
  `apply_default_values(&mut Transaction<'_, Postgres>, Uuid, Uuid) ->
Result<(), AppError>` and replaces the expansion-only tuple-returning default
  resolver with the State-only signature defined in Step 6.

- [ ] **Step 1: Add the contraction migration test**

Add `unified_select_contract_migration_rewrites_views_and_drops_legacy_schema`
to `postgres_schema.rs`. Apply migrations through `0026`, create a saved view
whose filters contain both an existing State ID and `state_groups`, whose
primary grouping is `task_type`, whose secondary grouping is `state_group`, and
whose display contains `task_type`. Apply `0027`, then assert the JSON equals a
valid version-2 query with merged/deduplicated State IDs and State grouping.

Query `information_schema` and `to_regclass` to prove `state_group`, every
`task_type_id`/`default_task_type_id` column, `task_types`, and
`project_task_types` are absent.

- [ ] **Step 2: Run the contraction test and verify the missing migration fails**

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --test postgres_schema \
  unified_select_contract_migration_rewrites_views_and_drops_legacy_schema \
  --features postgres-tests --locked -- --exact
```

Expected: FAIL because migration `0027` does not exist.

- [ ] **Step 3: Write the contraction migration**

Create `0027_remove_task_types_and_state_groups.sql`. Rewrite each view's JSON
with SQL helper functions or CTEs so the result has this shape:

```json
{
  "version": 2,
  "filters": {
    "states": { "values": [], "include_none": false }
  },
  "grouping": { "primary": "state", "secondary": null },
  "display": ["state", "priority"]
}
```

Merge old group-matched State UUIDs with existing State IDs, remove
`state_groups` and `task_types`, replace `state_group` with `state`, remove
`task_type`, promote a surviving secondary grouping, and deduplicate equal
primary/secondary values. Update the query-version check to 2 and drop, in
foreign-key order:

```sql
ALTER TABLE tasks DROP CONSTRAINT tasks_task_type_fk, DROP COLUMN task_type_id;
ALTER TABLE projects DROP CONSTRAINT projects_default_task_type_fk,
    DROP COLUMN default_task_type_id;
ALTER TABLE workspaces DROP CONSTRAINT workspaces_default_task_type_fk,
    DROP COLUMN default_task_type_id;
DROP TABLE project_task_types;
DROP TABLE task_types;
ALTER TABLE task_states DROP CONSTRAINT task_states_group, DROP COLUMN state_group;
```

- [ ] **Step 4: Update behavior tests before production queries**

Change task/project fixtures to omit Type fields. Assert Task create/update/move
works with only a State default, project responses contain no Type defaults or
enabled lists, and completed cycle/module totals count only a State whose
`system_role = 'done'`.

Add a version-2 saved-view test whose legacy precursor contains both State Group
and Task Type filters/groupings. Assert the migrated view can be fetched and run
without validation errors, its State UUID filter is preserved, and Type fields
are absent.

Update webhook fixtures to:

```json
{
  "version": 2,
  "data": {
    "task": {
      "id": "00000000-0000-0000-0000-000000000002",
      "state_id": "00000000-0000-0000-0000-000000000003",
      "priority": "medium"
    }
  }
}
```

- [ ] **Step 5: Run focused tests and record the expected SQL/shape failures**

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --test tasks --features postgres-tests --locked
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --test saved_views --features postgres-tests --locked
cargo test -p kanleaf-server --test webhook_contract --locked
```

Expected: FAIL on removed columns, version 1, and stale payload fields.

- [ ] **Step 6: Simplify Workspace, Project, and Task creation contracts**

Remove `default_task_type_id` and `enabled_task_type_ids` from every Project DTO,
request, SQL select/insert/update, validator, and permission test. Remove
`task_type_id` from Task create/update/bulk/move contracts and SQL.

Remove the expansion-only hidden Task Type UUID/insert from
`NewWorkspaceTaskConfiguration` and `workspace.rs`, delete
`task_config/task_type.rs`, and remove the last Task Type module declaration.

Change default resolution to:

```rust
pub(crate) async fn resolve_task_default(
    transaction: &mut Transaction<'_, Postgres>,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
) -> Result<Uuid, AppError>;
```

After inserting a Task, call `apply_default_values` in the same transaction.
Remove Project enabled-Type validation entirely.

- [ ] **Step 7: Cut Task hydration and query engine to version 2**

Remove Task Type joins/columns from every Task fetch. Select
`states.icon, states.system_role` and map them in `TaskStateSummary`.

Set `QUERY_VERSION` to 2 and define filters/grouping/display without removed
members:

```rust
pub(crate) struct TaskQueryFilters {
    pub(crate) states: IdFilter,
    pub(crate) priorities: Vec<TaskPriority>,
    pub(crate) assignees: IdFilter,
    pub(crate) labels: IdFilter,
    pub(crate) projects: IdFilter,
    pub(crate) cycles: IdFilter,
    pub(crate) modules: IdFilter,
    pub(crate) start_date: DateFilter,
    pub(crate) due_date: DateFilter,
    pub(crate) estimate: EstimateFilter,
}
```

Remove the State Group and Task Type enum variants. Implement
`include_completed = false` as `states.system_role IS DISTINCT FROM 'done'`.

- [ ] **Step 8: Convert workflow calculations and events**

Replace all joins or predicates against `state_group = 'done'` with
`system_role = 'done'`. Quick transitions resolve core State IDs by role and
never by name.

Remove `task_type_id` from `TaskSnapshot`, change `Event::new` to emit version
2, and update snapshot SQL. Do not rewrite stored delivery payload JSON.

Remove `TaskStateGroup` from `domain/mod.rs` after this step; legacy
portability continues to use plain strings and does not need the domain enum.

- [ ] **Step 9: Run the complete affected server group**

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --test tasks --test task_workflow \
  --test project_access --test project_planning --test saved_views \
  --test webhooks --features postgres-tests --locked
cargo test -p kanleaf-server --test webhook_contract --locked
```

Expected: PASS.

- [ ] **Step 10: Prove production server code has no removed identifiers**

```bash
rg -n "task_type|TaskType|state_group|TaskStateGroup" apps/server/src \
  --glob '!portability/**'
```

Expected: any remaining matches are confined to legacy portability code and the
temporary `TaskTypeIcon` domain validator until Task 5.

- [ ] **Step 11: Commit the core server cutover**

```bash
git add apps/server/migrations/0027_remove_task_types_and_state_groups.sql \
  apps/server/src/domain/mod.rs apps/server/src/task_config/mod.rs \
  apps/server/src/task_config/task_type.rs apps/server/src/project.rs \
  apps/server/src/task.rs apps/server/src/task/model.rs \
  apps/server/src/task/query_engine.rs apps/server/src/task/planning.rs \
  apps/server/src/project/cycle.rs apps/server/src/project/module.rs \
  apps/server/src/saved_view.rs apps/server/src/domain_event.rs \
  apps/server/src/domain/events.rs apps/server/tests/postgres_schema.rs \
  apps/server/tests/tasks.rs apps/server/tests/task_workflow.rs \
  apps/server/tests/project_access.rs apps/server/tests/project_planning.rs \
  apps/server/tests/saved_views.rs apps/server/tests/webhooks.rs \
  apps/server/tests/webhook_contract.rs \
  apps/server/tests/fixtures/webhook-payloads.json
git commit -m "feat(server): remove task type and state groups"
```

---

### Task 4: Move `Type` from fixed Markdown into custom projection

**Files:**

- Modify: `apps/server/src/task/frontmatter.rs`
- Modify: `apps/server/src/task/projection.rs`
- Modify: `apps/server/src/portability/sync.rs`
- Modify: `apps/server/src/custom_property/undefined.rs`
- Modify: `apps/server/tests/vault_sync.rs`
- Modify: `apps/server/tests/custom_properties.rs`

**Interfaces:**

- Produces: `TaskProperties` without `task_type`; `Type` renders only from
  `custom: Vec<CustomProperty>`.
- Produces: `Type` is not a reserved fixed property name, while projection jobs
  may still list it in `cleanup_property_names`.
- Consumes: Task 1's migrated custom value rows and Task 3's Type-free Task
  model.

- [ ] **Step 1: Add frontmatter and retry regression tests**

Add unit cases that prove:

```rust
// no custom Type: old fixed Type disappears
assert!(!patch_with_cleanup(source, &properties, &["Type".into()])?
    .contains("Type:"));

// migrated custom Type: exactly one Type key remains
assert_eq!(patched.matches("Type:").count(), 1);

// unknown nested/list/scalar keys and comments remain byte-equivalent
```

In `vault_sync.rs`, create one meaningful-Type Workspace and one plain
Workspace, force a projection failure/retry, then assert the pending job retains
`Type` cleanup until success and unrelated YAML survives.

- [ ] **Step 2: Run tests and verify fixed-key assumptions fail**

```bash
cargo test -p kanleaf-server task::frontmatter --locked
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --test vault_sync --features postgres-tests --locked
```

Expected: FAIL because `Type` is still required and rendered as a fixed key.

- [ ] **Step 3: Remove the fixed Type parser/renderer contract**

Remove `Type` from `OWNED_KEYS`, `TaskProperties`, required-shape validation,
read parsing, and fixed rendering. Keep cleanup names in
`patch_with_source_identity` so an explicitly queued old key is removed before
custom fields render.

Remove `Type` from `RESERVED_PROPERTY_NAMES` in custom-property definition
validation. External sync must classify `Type` using loaded custom definitions;
if there is no definition, it remains unknown until the upgrade cleanup job
removes the migrated legacy copy.

- [ ] **Step 4: Update projection loading and sync resolution**

Delete Task Type joins from `task_vault_row`/projection queries. Load custom
values exactly as other select properties, so a custom definition named `Type`
produces:

```rust
CustomProperty {
    name: "Type".to_owned(),
    property_type: "single_select".to_owned(),
    value: json!("Bug"),
}
```

Remove special Type lookup and project-enabled checks from `sync.rs`; the normal
custom-property parser validates the option UUID/name mapping.

- [ ] **Step 5: Run frontmatter, sync, and custom-property tests**

Run the Step 2 commands plus:

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --test custom_properties \
  --features postgres-tests --locked
```

Expected: PASS.

- [ ] **Step 6: Commit the Markdown ownership change**

```bash
git add apps/server/src/task/frontmatter.rs apps/server/src/task/projection.rs \
  apps/server/src/portability/sync.rs apps/server/src/custom_property/undefined.rs \
  apps/server/tests/vault_sync.rs apps/server/tests/custom_properties.rs
git commit -m "feat(server): project type as a custom property"
```

---

### Task 5: Version portable configuration and normalize legacy archives

**Files:**

- Modify: `apps/server/src/portability/config.rs`
- Modify: `apps/server/src/portability/archive.rs`
- Modify: `apps/server/src/portability/import.rs`
- Modify: `apps/server/src/portability/import_archive.rs`
- Modify: `apps/server/src/portability/mod.rs`
- Modify: `apps/server/tests/workspace_export.rs`
- Modify: `apps/server/tests/workspace_import.rs`

**Interfaces:**

- Produces: current Workspace format 2, Task config format 3, and Project format
  3 without special Type fields.
- Produces: current State/Label/custom-option metadata matching Tasks 1 and 2.
- Consumes: legacy Workspace format 1, Task config format 2, and Project format
  2 through explicit compatibility DTOs; new writes never emit them.

- [ ] **Step 1: Extend round-trip and legacy-archive tests first**

Update the current export assertions for new versions and metadata. Add a
fixture-rewrite test that turns a current export into the immediately preceding
format with:

```json
{
  "task_config": {
    "format_version": 2,
    "states": [{ "group": "todo" }],
    "types": [{ "name": "Task" }, { "name": "Bug" }]
  },
  "project": {
    "format_version": 2,
    "default_task_type_id": "00000000-0000-4000-8000-000000000041",
    "enabled_task_type_ids": [
      "00000000-0000-4000-8000-000000000041",
      "00000000-0000-4000-8000-000000000042"
    ]
  }
}
```

Give two Tasks different legacy Type values and assert import creates one custom
`Type` definition, preserves both values, chooses the old Workspace default,
and does not list `Type` as undefined. Add a protected-default-only archive case
that creates no custom definition.

- [ ] **Step 2: Run import/export tests and verify version rejection**

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --test workspace_export --test workspace_import \
  --features postgres-tests --locked
```

Expected: FAIL because old readers require Task Type and State Group fields.

- [ ] **Step 3: Define current and legacy DTOs explicitly**

Current configuration uses:

```rust
struct TaskStateConfig {
    id: Uuid,
    name: String,
    icon: Option<String>,
    color: String,
    description: String,
    system_role: Option<String>,
    position: i32,
    archived: bool,
}

struct CustomPropertyOptionConfig {
    id: Uuid,
    property_id: Uuid,
    name: String,
    icon: Option<String>,
    color: String,
    description: String,
    position: i32,
    archived: bool,
}
```

Define `LegacyWorkspaceConfigV1`, `LegacyTaskConfigV2`, and
`LegacyProjectConfigV2` with the exact previous fields. Dispatch by reading
`format_version` before strict deserialization; do not add permissive unknown
field handling to current DTOs.

- [ ] **Step 4: Normalize legacy configuration before validation**

Create a pure normalization function:

```rust
fn normalize_legacy_configuration(
    workspace: LegacyWorkspaceConfigV1,
    task_config: LegacyTaskConfigV2,
    projects: Vec<LegacyProjectConfigV2>,
    task_frontmatter: &mut [ImportedTask],
) -> Result<NormalizedConfiguration, ImportArchiveError>;
```

Use the same candidate ordering, canonical icons/colors, meaningful-Type test,
duplicate archived-name suffix, and Workspace default selection as Task 1.
Convert old frontmatter Type labels to option UUID-backed imported custom values
before current validation. Drop project-specific Type defaults/restrictions.

- [ ] **Step 5: Update current export/import SQL and validation**

Remove legacy columns/joins/maps. Export `system_role`, icon, descriptions,
positions, and `default_option_id`. During current-format import, remap default
option IDs after option IDs are allocated and require exactly one active core
State per role.

Ensure imported Type/custom option values remain UUIDs in PostgreSQL and visible
labels in Markdown.

After the last legacy Task Type icon is normalized into a custom option, remove
`TaskTypeIcon` from `domain/mod.rs`; legacy validation uses `SelectOptionIcon`
so current and imported icon keys share one allowlist.

- [ ] **Step 6: Run portability tests and scan production portability code**

Run the Step 2 command again, then:

```bash
rg -n "task_type|TaskType|state_group|TaskStateGroup" \
  apps/server/src/portability
```

Expected: matches exist only in structs/functions whose names begin with
`Legacy` or comments describing legacy format normalization.

- [ ] **Step 7: Commit portable compatibility**

```bash
git add apps/server/src/portability apps/server/tests/workspace_export.rs \
  apps/server/tests/workspace_import.rs
git commit -m "feat(server): migrate portable task configuration"
```

---

### Task 6: Build the shared icon and select-value editor primitives

**Files:**

- Create: `apps/desktop/src/features/settings/propertyIcons.tsx`
- Create: `apps/desktop/src/features/settings/SelectPropertyEditor.tsx`
- Create: `apps/desktop/src/features/settings/SelectValueEditor.tsx`
- Create: `apps/desktop/src/features/settings/SelectValueEditor.test.tsx`
- Modify: `apps/desktop/src/components/ui/IconPicker.tsx`
- Modify: `apps/desktop/src/components/ui/IconPicker.test.tsx`
- Modify: `apps/desktop/src/features/custom-properties/PropertyEditor.tsx`
- Modify: `apps/desktop/src/features/custom-properties/SelectOptionEditor.test.tsx`
- Delete: `apps/desktop/src/features/custom-properties/SelectOptionEditor.tsx`
- Modify: `apps/desktop/src/features/custom-properties/api.ts`
- Modify: `apps/desktop/src/features/workspace/types.ts`
- Modify: `apps/desktop/src/styles/global.css`

**Interfaces:**

- Produces: `propertyIconOptions`, `propertyIcon(key)`, and stable icon keys that
  match `SelectOptionIcon` on the server.
- Produces: controlled `SelectValueDraft` rows with nullable icon, color, name,
  description, archived/locked flags, and optional default selection.
- Produces: `SelectPropertyEditor` scaffold used by custom and system editors.

- [ ] **Step 1: Write failing picker/editor interaction tests**

Test an explicit `No icon` button, search by label/key, group headings, arrow
navigation, Home/End, Enter/Space selection, Escape focus restoration, unknown
key fallback, and `currentColor` inheritance.

Test the shared value editor with:

```ts
const values: SelectValueDraft[] = [
  {
    key: 'todo',
    id: 'todo',
    name: 'Todo',
    icon: 'circle',
    color: '#64748B',
    description: 'Ready to start',
    locked: true,
  },
];
```

Assert locked name/icon/color controls are disabled while description and drag
remain enabled; single-select renders one radio default; multi-select omits it;
new values start with `icon: null`.

- [ ] **Step 2: Run component tests and verify missing APIs fail**

```bash
pnpm --filter @kanleaf/desktop test -- \
  src/components/ui/IconPicker.test.tsx \
  src/features/settings/SelectValueEditor.test.tsx \
  src/features/custom-properties/SelectOptionEditor.test.tsx
```

Expected: FAIL because nullable icons and shared components do not exist.

- [ ] **Step 3: Create the curated icon registry**

Statically import the approved Lucide outline icons and define options grouped
under Status, Work, Communication, People, Objects, Direction, and Symbols. The
registry must include at least the existing Project/Task Type keys plus
`circle`, `loader-circle`, `circle-check`, `circle-dashed`, and `circle-x`.

Expose:

```ts
export const propertyIconOptions: IconPickerOption[];
export function propertyIcon(key: string | null): LucideIcon;
```

Use one harmless fallback glyph for unknown non-null legacy keys and a distinct
empty glyph for null.

- [ ] **Step 4: Extend IconPicker for an explicit null value**

Change its contract to:

```ts
interface IconPickerProps {
  ariaLabel: string;
  dialogLabel: string;
  fallbackIcon: LucideIcon;
  options: IconPickerOption[];
  value: string | null;
  allowNone?: boolean;
  onChange: (value: string | null) => void;
  className?: string;
  disabled?: boolean;
  iconSize?: number;
}
```

Render `No icon` as the first keyboard-reachable choice when `allowNone` is
true. Preserve Base UI Popover focus behavior and the existing grid navigation.

- [ ] **Step 5: Implement shared property and value editors**

`SelectPropertyEditor` renders Name, read-only Type, Property description,
Property values, adjacent error, and footer slot. `SelectValueEditor` owns the
shared header/grid/archive/add/action presentation and delegates controlled
changes upward; it performs no fetch or mutation.

Define:

```ts
export interface SelectValueDraft {
  key: string;
  id?: string;
  name: string;
  icon: string | null;
  color: string;
  description: string;
  archived?: boolean;
  locked?: boolean;
}
```

Use the existing `SettingsSortableProvider`, `SettingsDragHandle`,
`ColorSwatchPicker`, actions menu, and dialogs.

- [ ] **Step 6: Move custom select editing onto the shared primitives**

Update custom DTOs/API requests for icon, description, and
`default_option_id`. Map property options to `SelectValueDraft`; pass
`showDefault={type === 'single_select'}` and no default for multi-select. Keep
the existing create/update form semantics and archived option confirmation.

- [ ] **Step 7: Run focused tests, typecheck, and formatting**

Run Step 2 again, then:

```bash
pnpm typecheck
pnpm format:check
```

Expected: PASS.

- [ ] **Step 8: Commit shared frontend primitives**

```bash
git add apps/desktop/src/components/ui/IconPicker.tsx \
  apps/desktop/src/components/ui/IconPicker.test.tsx \
  apps/desktop/src/features/settings/propertyIcons.tsx \
  apps/desktop/src/features/settings/SelectPropertyEditor.tsx \
  apps/desktop/src/features/settings/SelectValueEditor.tsx \
  apps/desktop/src/features/settings/SelectValueEditor.test.tsx \
  apps/desktop/src/features/custom-properties/PropertyEditor.tsx \
  apps/desktop/src/features/custom-properties/SelectOptionEditor.tsx \
  apps/desktop/src/features/custom-properties/SelectOptionEditor.test.tsx \
  apps/desktop/src/features/custom-properties/api.ts \
  apps/desktop/src/features/workspace/types.ts apps/desktop/src/styles/global.css
git commit -m "feat(desktop): add shared select property editor"
```

---

### Task 7: Rebuild State and Labels Settings with the common editor

**Files:**

- Modify: `apps/desktop/src/features/task-config/StateSettings.tsx`
- Modify: `apps/desktop/src/features/task-config/LabelSettings.tsx`
- Modify: `apps/desktop/src/features/task-config/TaskConfigurationSettings.tsx`
- Modify: `apps/desktop/src/features/task-config/TaskConfigurationSettings.test.tsx`
- Modify: `apps/desktop/src/features/task-config/api.ts`
- Modify: `apps/desktop/src/styles/global.css`

**Interfaces:**

- Consumes: Task 6's `SelectPropertyEditor`, `SelectValueEditor`, icon registry,
  and Task 2's server DTOs/routes.
- Produces: `/settings/workspace/states` and `/labels` using the same visual
  scaffold as custom select properties.

- [ ] **Step 1: Replace page tests with the approved layout contract**

Assert both pages render fields in this accessible order:

```text
Name -> Type -> Property description -> Property values
```

State must show icon/color/name/description/default/actions; Labels must show
icon/color/name/description/actions and no default column. Assert core controls
disable name/icon/color, description is editable, drag is available, custom
State fields are editable, and permission/read-only/error/archived states remain
visible.

- [ ] **Step 2: Run the settings test and verify the old tables fail**

```bash
pnpm --filter @kanleaf/desktop test -- \
  src/features/task-config/TaskConfigurationSettings.test.tsx
```

Expected: FAIL on missing property fields, icons, descriptions, and core locks.

- [ ] **Step 3: Update the feature API adapter**

Remove every Task Type function and `TaskStateGroup` input. Add State/Label
icon/description fields, `reorderTaskLabels`, and:

```ts
export function updateTaskConfiguration(
  context: ApiContext,
  workspaceId: string,
  patch: {
    state_id?: string;
    state_property_description?: string;
    label_property_description?: string;
  },
): Promise<TaskConfiguration>;
```

- [ ] **Step 4: Adapt State Settings**

Map State responses to shared drafts with
`locked: state.system_role !== null`. Use the Default radio to call
`updateTaskConfiguration({ state_id })`. Save property description through the
same configuration endpoint. Keep row-level mutations explicit so one failed
State change cannot partially save unrelated rows. Custom State removal asks
for any other active replacement; core rows have no archive/delete actions.

- [ ] **Step 5: Adapt Labels Settings**

Map Labels to shared drafts, enable drag/reorder, nullable icons, description,
archive/restore/delete, and save the Labels property description. Keep assigned
Task cleanup confirmations and adjacent errors.

- [ ] **Step 6: Finish the shared responsive grid**

In `global.css`, define one semantic grid token set for drag, icon, swatch,
name, description, default, and actions. Apply the same template to header,
display, create, and edit rows. At narrow width, hide the visual header, stack
description beneath name, retain icon/color/default/actions, and preserve
keyboard focus outlines.

- [ ] **Step 7: Run settings tests and accessibility-adjacent component tests**

```bash
pnpm --filter @kanleaf/desktop test -- \
  src/features/task-config/TaskConfigurationSettings.test.tsx \
  src/features/settings/SettingsSortable.test.tsx \
  src/features/settings/SettingsList.test.tsx
pnpm typecheck
pnpm lint
```

Expected: PASS.

- [ ] **Step 8: Commit system property editors**

```bash
git add apps/desktop/src/features/task-config apps/desktop/src/styles/global.css
git commit -m "feat(desktop): unify state and label editors"
```

---

### Task 8: Remove Task Type and State Group from the desktop product

**Files:**

- Delete: `apps/desktop/src/features/task-config/TaskTypeSettings.tsx`
- Delete: `apps/desktop/src/features/task-config/TaskTypeIcon.tsx`
- Delete: `apps/desktop/src/features/task-config/taskTypeIcons.ts`
- Modify: `apps/desktop/src/features/settings/SettingsShell.tsx`
- Modify: `apps/desktop/src/features/settings/SettingsShell.test.tsx`
- Modify: `apps/desktop/src/features/workspace/settingsSections.ts`
- Modify: `apps/desktop/src/features/workspace/types.ts`
- Modify: `apps/desktop/src/features/workspace/WorkspaceShell.tsx`
- Modify: all adjacent Workspace shell/navigation tests containing removed
  fixtures
- Modify: `apps/desktop/src/features/project/ProjectDefaultSettings.tsx`
- Modify: Project tests containing removed defaults/enabled types
- Modify: `apps/desktop/src/features/task/TaskDetailPane.tsx`
- Modify: `apps/desktop/src/features/task/TaskListPane.tsx`
- Modify: `apps/desktop/src/features/task/TaskProperties.tsx`
- Modify: `apps/desktop/src/features/task/taskPropertyModel.ts`
- Modify: adjacent Task detail/list tests
- Modify: `apps/desktop/src/features/view/types.ts`
- Modify: `apps/desktop/src/features/view/grouping.ts`
- Modify: `apps/desktop/src/features/view/TaskViewToolbar.tsx`
- Modify: `apps/desktop/src/features/view/TaskLayouts.tsx`
- Modify: `apps/desktop/src/features/view/ProjectViewsPane.tsx`
- Modify: adjacent View tests
- Modify: `apps/desktop/e2e/core-workflow.spec.ts`

**Interfaces:**

- Produces: frontend `Task`, `Project`, `TaskQuery`, and Settings section types
  matching Tasks 2, 3, and 5.
- Consumes: migrated custom `Type` through the existing custom-property Task
  detail UI, never a special Type control.

- [ ] **Step 1: Update query/grouping tests to version 2**

Remove Type and State Group test fixtures and add assertions that State grouping
orders by active configured State position, includes an archived State only
when a visible Task references it, and `createTaskQuery` emits:

```ts
{
  version: 2,
  filters: {
    states: { values: [], include_none: false },
    priorities: [],
    assignees: { values: [], include_none: false },
    labels: { values: [], include_none: false },
    projects: { values: [], include_none: false },
    cycles: { values: [], include_none: false },
    modules: { values: [], include_none: false },
    start_date: { from: null, to: null, include_none: false },
    due_date: { from: null, to: null, include_none: false },
    estimate: { minimum: null, maximum: null, include_none: false }
  }
}
```

- [ ] **Step 2: Update Task, Project, Settings, and routing tests first**

Remove Type fixtures and expectations. Assert Task detail shows migrated `Type`
through the custom-property control when supplied, Settings navigation is
exactly `States`, `Labels`, `Properties`, old `task-types` URLs normalize to the
default Workspace Settings section, and Project defaults contain only State and
assignee controls.

- [ ] **Step 3: Run the affected frontend tests and verify compile failures**

```bash
pnpm --filter @kanleaf/desktop test -- \
  src/features/settings/SettingsShell.test.tsx \
  src/features/view/grouping.test.ts \
  src/features/view/api.test.ts \
  src/features/task/TaskDetailPane.test.tsx \
  src/features/project/ProjectSettings.test.tsx
```

Expected: FAIL on stale props, union members, and response fields.

- [ ] **Step 4: Remove the navigation, route, and Project contracts**

Delete the `task-types` Workspace Settings section, icon, title resolver, and
component dispatch. Remove Project Type defaults/enabled lists from types,
forms, API payloads, Workspace shell composition, and tests.

- [ ] **Step 5: Remove the special Task Type UI contract**

Delete Task Type fields from `Task`, `TaskPatch`, create/edit controls, pinned
properties, list metadata, command actions, and transition callbacks. A custom
property named `Type` must continue to render through the generic custom
property path with its migrated option icon/color/description metadata.

- [ ] **Step 6: Remove State Group and Type from Views**

Set `TaskQuery.version` to 2; remove filters and enum members; delete State Group
and Task Type menus, grouping branches, display cells, props, and defaults.
Change any default grouping still set to `state_group` to `state`.

- [ ] **Step 7: Update the essential browser workflow**

Replace Task Type Settings coverage with:

```ts
await page.getByRole('button', { name: 'States' }).click();
await expect(page.getByLabel('Property values')).toBeVisible();
await expect(page.getByDisplayValue('Todo')).toBeDisabled();
await page.getByRole('button', { name: 'Labels' }).click();
await expect(page.getByRole('columnheader', { name: 'Default' })).toHaveCount(
  0,
);
```

Create a custom single-select `Type`, set an option default, create a Task, and
assert the Task detail shows the default via the generic property control.

- [ ] **Step 8: Run frontend tests and scan for removed identifiers**

```bash
pnpm test
pnpm typecheck
pnpm lint
rg -n "task_type|TaskType|state_group|TaskStateGroup|Task types" \
  apps/desktop/src apps/desktop/e2e
```

Expected: tests/checks PASS; scan has no production matches and only explicit
legacy-route assertions if retained in tests.

- [ ] **Step 9: Commit the desktop removal**

```bash
git add apps/desktop/src/features/task-config/TaskTypeSettings.tsx \
  apps/desktop/src/features/task-config/TaskTypeIcon.tsx \
  apps/desktop/src/features/task-config/taskTypeIcons.ts \
  apps/desktop/src/features/settings/SettingsShell.tsx \
  apps/desktop/src/features/settings/SettingsShell.test.tsx \
  apps/desktop/src/features/workspace/settingsSections.ts \
  apps/desktop/src/features/workspace/types.ts \
  apps/desktop/src/features/workspace/WorkspaceShell.tsx \
  apps/desktop/src/features/workspace/WorkspaceNavigation.test.tsx \
  apps/desktop/src/features/workspace/WorkspaceRouteScreen.test.tsx \
  apps/desktop/src/features/workspace/WorkspaceShell.routing.test.tsx \
  apps/desktop/src/features/project/ProjectDefaultSettings.tsx \
  apps/desktop/src/features/project/ProjectSettings.test.tsx \
  apps/desktop/src/features/project/ProjectOverview.test.tsx \
  apps/desktop/src/features/project/ProjectPlanningPane.test.tsx \
  apps/desktop/src/features/project/ArchivedProjectsSettings.test.tsx \
  apps/desktop/src/features/task/TaskDetailPane.tsx \
  apps/desktop/src/features/task/TaskDetailPane.test.tsx \
  apps/desktop/src/features/task/TaskListPane.tsx \
  apps/desktop/src/features/task/TaskListPane.test.tsx \
  apps/desktop/src/features/task/TaskProperties.tsx \
  apps/desktop/src/features/task/taskPropertyModel.ts \
  apps/desktop/src/features/view/types.ts \
  apps/desktop/src/features/view/grouping.ts \
  apps/desktop/src/features/view/grouping.test.ts \
  apps/desktop/src/features/view/TaskViewToolbar.tsx \
  apps/desktop/src/features/view/TaskLayouts.tsx \
  apps/desktop/src/features/view/ProjectViewsPane.tsx \
  apps/desktop/src/features/view/ProjectViewsPane.test.tsx \
  apps/desktop/src/features/view/api.test.ts \
  apps/desktop/src/features/command/CommandPalette.test.tsx \
  apps/desktop/src/features/document/DocumentWorkspace.test.tsx \
  apps/desktop/e2e/core-workflow.spec.ts
git commit -m "feat(desktop): remove task type and state groups"
```

---

### Task 9: Update current documentation and run release verification

**Files:**

- Modify: `docs/architecture.md`
- Modify: `docs/webhooks.md`
- Modify only if current operational instructions changed: `README.md`
- Review: every file changed since commit `35586dc`

**Interfaces:**

- Consumes: all prior tasks.
- Produces: current architecture/webhook docs, verified build artifacts, a clean
  focused diff, pushed commits, and observed GitHub Actions conclusions.

- [ ] **Step 1: Update current documentation**

In `architecture.md`, remove TaskType/ProjectTaskType entities, describe
State `system_role`, Label ordering/icons, custom select defaults, and Type
promotion. In `webhooks.md`, document payload version 2 and remove
`task_type_id`; state that stored version-1 deliveries are unchanged.

- [ ] **Step 2: Run formatting and static checks**

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
pnpm format:check
pnpm typecheck
pnpm lint
```

Expected: PASS with fresh output.

- [ ] **Step 3: Run complete unit and PostgreSQL integration suites**

```bash
cargo test --workspace --locked
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test --workspace --all-features --locked
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Run builds and deployment validation**

```bash
pnpm build
pnpm tauri build --no-bundle
docker compose --env-file infra/self-host/.env.example \
  -f infra/self-host/compose.yaml config --quiet
```

Expected: PASS. If Tauri platform packages are unavailable, record the exact
missing package output and complete every other build instead of describing
Tauri as passing.

- [ ] **Step 5: Run browser workflows against disposable databases**

Create/reset only the disposable databases named below, then run:

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_e2e \
  pnpm test:e2e
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_e2e \
  pnpm test:e2e:self-host
```

Expected: PASS, including Settings, custom Type default, Markdown projection,
and imported legacy archive coverage.

- [ ] **Step 6: Capture and inspect the approved UI**

Run the web client and capture State, Labels, custom single-select, and custom
multi-select pages at the supported wide viewport and one narrow viewport.
Compare name/type/description/value alignment, row density, disabled core State
controls, icon color, focus, archived section, and responsive stacking against
the approved direct-form preview.

- [ ] **Step 7: Review status, complete diff, and removed-identifier scan**

```bash
git status --short --branch
git diff 35586dc...HEAD --check
git diff 35586dc...HEAD --stat
rg -n "task_type|TaskType|state_group|TaskStateGroup|Task types" \
  apps/server/src apps/desktop/src docs/architecture.md docs/webhooks.md
```

Expected: no uncommitted unrelated files, no whitespace errors, and no removed
production contract except explicitly named legacy portability compatibility.

- [ ] **Step 8: Commit documentation or final verification fixes**

```bash
git add docs/architecture.md docs/webhooks.md README.md \
  apps/server apps/desktop
git commit -m "docs: update task property architecture"
```

Omit unchanged paths from `git add`; do not create an empty commit.

- [ ] **Step 9: Push and monitor GitHub Actions**

```bash
git push origin dev
gh run list --branch dev --limit 10
```

Open every run for the pushed head SHA with `gh run view <run-id> --log-failed`.
Wait for pending/running jobs, report each conclusion, and fix/retest/repush any
failure caused by this change. Completion requires the local worktree and
`origin/dev` to point at the same reviewed commit.
