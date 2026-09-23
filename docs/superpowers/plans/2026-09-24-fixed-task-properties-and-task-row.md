# Fixed Task Properties and Task Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace configurable Task-property icons and custom States with fixed State/Priority vocabularies, consolidate Workspace Task Settings, and ship the approved one-line Task row and value icons.

**Architecture:** PostgreSQL migration `0028` normalizes existing State and Priority data before dropping property-icon columns and strengthening constraints. Rust exposes the fixed contracts and keeps legacy archive/Markdown input compatible; React consumes fixed semantic roles through focused SVG presentation components, while Settings and Task surfaces reuse existing routed and accessible primitives.

**Tech Stack:** PostgreSQL 17 migrations, Rust 2024/Axum/SQLx, React 19/TypeScript, Base UI, CSS tokens, Vitest/Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-24-fixed-task-properties-and-task-row-design.md`

## Global Constraints

- Every Workspace has exactly five active States in this order: Backlog, Todo, In Progress, Done, Cancelled.
- State definitions are fixed; Project default-State selection remains supported.
- Priority values are `none`, `low`, `medium`, `high`, and `critical`; new output never emits `urgent`.
- Old archives and Markdown containing property icons, custom States, or `urgent` remain importable and normalize to the fixed model.
- Remove icons only from State, Label, and custom select options; Project icon selection remains unchanged.
- The Workspace Settings rail says `Task Settings` and exposes only Properties in that group.
- The approved List row is 50px high with a 30px State icon, 15px title, borderless right-aligned Priority badge, no Task number, and one-line truncation.
- State icons use app-theme light/dark colors; Priority SVGs render directly so opacity and Critical's white exclamation mark survive.
- Reuse existing API, Settings, Select, sorting, routing, projection, and error boundaries; add no dependencies.
- Preserve keyboard operation, visible focus, ARIA names, authorization, revision-aware Markdown projection, and unrelated user changes.

## Review Focus

- A Task on an arbitrary or archived custom State must end on Backlog after migration, while an invalid Workspace/Project default must end on Todo; Task 1 pins both branches.
- A current-format archive with custom States and icon fields must import into exactly five States without dangling Task, Project, view-filter, or default references; Task 4 pins the mapping.
- Explicit app Dark theme must use dark State colors even when the operating system is Light, while Critical must retain a visible white exclamation mark; Tasks 6 and 9 inspect both conditions.
- Long Task titles and optional metadata must not overlap the fixed right-hand Priority badge at 960px or narrow widths; Tasks 7 and 9 exercise truncation and geometry.
- Legacy `/states` and `/labels` Settings URLs must replace to `/properties` without breaking Back/Forward or a valid return location; Task 5 tests route parsing and browser history.

---

### Task 1: Normalize the database schema and existing data

**Files:**
- Create: `apps/server/migrations/0028_fixed_task_properties.sql`
- Modify: `apps/server/tests/postgres_schema.rs`

**Interfaces:**
- Consumes: schema through migration 27, `task_projection_jobs`, saved-view query version 2, Workspace/Project/Task State foreign keys.
- Produces: five required `task_states.system_role` values, `tasks.priority = 'critical'`, no property-icon columns, remapped references, and queued Task/config projections.

- [ ] **Step 1: Write the failing migration regression**

Add `fixed_task_properties_migration_normalizes_states_priority_and_icons` under `#[sqlx::test(migrations = false)]`. Run migrations through version 27 with `Migrator`, then insert one Workspace containing canonical Todo/In Progress/Done rows, two case-insensitive Backlog candidates, one Cancelled row, one arbitrary active State, and one archived State. Insert Tasks on the custom/archived/canonical rows, set Workspace and Project defaults to custom rows, add a saved view with those State IDs and `urgent`, and insert Label/custom-option icons.

Assert these literal outcomes after running `run_database_migrations(&pool)`:

```rust
assert_eq!(
    sqlx::query_as::<_, (String, String, i32)>(
        "SELECT system_role, name, position FROM task_states WHERE workspace_id = $1 ORDER BY position"
    )
    .bind(workspace_id)
    .fetch_all(&pool)
    .await
    .unwrap(),
    vec![
        ("backlog".into(), "Backlog".into(), 0),
        ("todo".into(), "Todo".into(), 1),
        ("in_progress".into(), "In Progress".into(), 2),
        ("done".into(), "Done".into(), 3),
        ("cancelled".into(), "Cancelled".into(), 4),
    ],
);
assert_eq!(custom_task_state, backlog_id);
assert_eq!(archived_task_state, backlog_id);
assert_eq!(workspace_default, todo_id);
assert_eq!(project_default, todo_id);
assert_eq!(urgent_task_priority, "critical");
assert_eq!(queued_task_projection_count, task_count);
assert_eq!(property_icon_column_count, 0_i64);
```

Also assert that saved-view State IDs contain only canonical IDs, the priority filter contains `critical` and not `urgent`, the canonical descriptions/colors match the spec, and inserts using `urgent`, a sixth State role, or mutable canonical fields fail their database constraints.

- [ ] **Step 2: Run the regression and verify RED**

Run:

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test postgres_schema fixed_task_properties_migration_normalizes_states_priority_and_icons
```

Expected: FAIL because migration 28 and the five-State/critical constraints do not exist.

- [ ] **Step 3: Add migration 0028**

Implement the migration in this order so foreign keys remain valid:

1. Drop `task_states_system_fields_valid`, `task_states_system_role_valid`, and `tasks_priority` temporarily.
2. Build temporary tables `fixed_state_ids(workspace_id, role, state_id)` and `state_id_map(workspace_id, source_id, task_target_id, default_target_id)`.
3. Reuse existing system-role rows for Todo/In Progress/Done; choose the first active case-insensitive name match for Backlog/Cancelled; generate missing IDs.
4. Populate `state_id_map` so canonical-name/role rows map to their canonical ID, every other Task assignment maps to Backlog, and every other default maps to Todo.
5. Update `tasks.state_id`, `workspaces.default_inbox_state_id`, and `projects.default_state_id`; rebuild saved-view State arrays through `state_id_map` with first-occurrence ordering.
6. Delete noncanonical rows, insert missing rows, and update the five retained rows to the exact name, light color, description, position, active status, and role from the spec.
7. Update `tasks.priority = 'critical' WHERE priority = 'urgent'`; rewrite version-2 saved-view priority arrays from `urgent` to `critical` with duplicates removed.
8. Insert every Task into `task_projection_jobs` using its current `metadata_version`, and ensure every Workspace has a pending `workspace_config_projection_jobs` row.
9. Drop `task_states.icon`, `task_labels.icon`, and `custom_property_options.icon` plus their icon constraints.
10. Make `task_states.system_role` non-null and add constraints for the five roles, exact role/name/color/description/position tuples, active status, and `tasks.priority IN ('none','low','medium','high','critical')`.

Use `ON CONFLICT` updates matching the existing projection-job migrations; never write Markdown from SQL.

- [ ] **Step 4: Run migration tests and verify GREEN**

Run the focused command from Step 2, then:

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test postgres_schema
```

Expected: PASS.

- [ ] **Step 5: Commit the migration slice**

```bash
git add apps/server/migrations/0028_fixed_task_properties.sql apps/server/tests/postgres_schema.rs
git commit -m "feat(server): fix state and priority vocabularies"
```

### Task 2: Enforce fixed States and icon-free property APIs

**Files:**
- Modify: `apps/server/src/domain/mod.rs`
- Modify: `apps/server/src/task_config/mod.rs`
- Modify: `apps/server/src/task_config/state.rs`
- Modify: `apps/server/src/task_config/label.rs`
- Modify: `apps/server/src/custom_property/definition.rs`
- Modify: `apps/server/src/task.rs`
- Modify: `apps/server/src/task/model.rs`
- Modify: `apps/server/src/task/query_engine.rs`
- Modify: `apps/server/tests/task_configuration.rs`
- Modify: `apps/server/tests/custom_properties.rs`
- Modify: `apps/server/tests/workspaces.rs`

**Interfaces:**
- Consumes: Task 1's five-role schema and removed icon columns.
- Produces: `SystemStateRole::{Backlog, Todo, InProgress, Done, Cancelled}`, fixed Workspace initialization, read-only State HTTP surface, and icon-free Label/custom-option JSON.

- [ ] **Step 1: Replace mutable-State tests with fixed-contract tests**

In `task_configuration.rs`, replace tests that create/update/reorder/delete States with a test asserting a new Workspace returns exactly:

```rust
let observed = config["states"]
    .as_array()
    .unwrap()
    .iter()
    .map(|state| {
        (
            state["system_role"].as_str().unwrap(),
            state["name"].as_str().unwrap(),
            state["color"].as_str().unwrap(),
        )
    })
    .collect::<Vec<_>>();
assert_eq!(observed, vec![
    ("backlog", "Backlog", "#727480"),
    ("todo", "Todo", "#7A4DD1"),
    ("in_progress", "In Progress", "#296DD6"),
    ("done", "Done", "#2F945C"),
    ("cancelled", "Cancelled", "#D63D3C"),
]);
assert!(config["states"].as_array().unwrap().iter().all(|state| state.get("icon").is_none()));
```

Issue POST `/states`, PUT `/states/reorder`, PATCH `/states/{id}`, and DELETE `/states/{id}` requests and assert `StatusCode::NOT_FOUND`. Keep member-read and remaining Label authorization assertions.

In Label and custom-property tests, create values without `icon`, assert responses omit the key, and assert name/color/description/order/default behavior still works.

- [ ] **Step 2: Run the focused API tests and verify RED**

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test task_configuration
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test custom_properties
```

Expected: FAIL on three States, live mutation routes, and serialized icon fields.

- [ ] **Step 3: Implement the fixed server contract**

Expand `SystemStateRole` and its stable string mapping:

```rust
pub enum SystemStateRole {
    Backlog,
    Todo,
    InProgress,
    Done,
    Cancelled,
}

pub const fn as_str(self) -> &'static str {
    match self {
        Self::Backlog => "backlog",
        Self::Todo => "todo",
        Self::InProgress => "in_progress",
        Self::Done => "done",
        Self::Cancelled => "cancelled",
    }
}
```

Change `NewWorkspaceTaskConfiguration` to own five UUIDs, return the Todo UUID from `default_state_id()`, and insert the exact five definitions from the spec. Remove icon members from `TaskStateResponse`, `TaskLabelResponse`, Task response State models, Label request/update structs, custom-option request/update/response structs, and their SQL selections/binds. Remove `states.icon AS state_icon` from Task list/detail/query-engine selections and delete the corresponding row/model field.

Keep `task_config/state.rs` only for the authorized ordered list query and remove every State mutation route from `routes()`. Delete `SelectOptionIcon` after the property callers are removed; keep Project icon validation untouched.

- [ ] **Step 4: Run the API tests and server unit tests**

Run the two Step 2 commands plus:

```bash
cargo test -p kanleaf-server --locked domain::tests
cargo fmt --all --check
```

Expected: PASS.

- [ ] **Step 5: Commit the fixed API slice**

```bash
git add apps/server/src/domain/mod.rs apps/server/src/task_config apps/server/src/custom_property/definition.rs apps/server/src/task.rs apps/server/src/task/model.rs apps/server/src/task/query_engine.rs apps/server/tests/task_configuration.rs apps/server/tests/custom_properties.rs apps/server/tests/workspaces.rs
git commit -m "feat(server): expose fixed task states"
```

### Task 3: Rename urgent to critical across runtime behavior

**Files:**
- Modify: `apps/server/src/domain/mod.rs`
- Modify: `apps/server/src/task.rs`
- Modify: `apps/server/src/task/query_engine.rs`
- Modify: `apps/server/src/portability/sync.rs`
- Modify: `apps/server/src/portability/import.rs`
- Modify: `apps/server/src/portability/import_archive.rs`
- Modify: `apps/server/src/domain/events.rs`
- Modify: `apps/server/tests/tasks.rs`
- Modify: `apps/server/tests/task_workflow.rs`
- Modify: `apps/server/tests/saved_views.rs`
- Modify: `apps/server/tests/vault_sync.rs`
- Modify: `apps/server/tests/webhook_contract.rs`

**Interfaces:**
- Consumes: Task 1's `critical` database value.
- Produces: `TaskPriority::Critical`, canonical `critical` API/event/frontmatter output, and `urgent` as an input-only compatibility alias in import/sync paths.

- [ ] **Step 1: Add failing domain and integration assertions**

Add a domain test proving the canonical enum contract:

```rust
let priority: TaskPriority = serde_json::from_str("\"critical\"").unwrap();
assert_eq!(priority, TaskPriority::Critical);
assert_eq!(priority.as_str(), "critical");
assert_eq!(serde_json::to_string(&priority).unwrap(), "\"critical\"");
assert!(serde_json::from_str::<TaskPriority>("\"urgent\"").is_err());
```

Update Task API, saved-view, and webhook fixtures to send/expect `critical`. Add a Vault Sync test whose Markdown contains `Priority: Urgent`, then assert the database stores `critical` and the next projection writes `Priority: Critical`.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cargo test -p kanleaf-server --locked domain::tests::task_priority
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked --test vault_sync urgent
```

Expected: FAIL because the runtime enum and parsers still use Urgent.

- [ ] **Step 3: Implement canonical critical behavior**

Rename the enum variant to `Critical`, update every exhaustive match and fixture, and change direct string arrays/filters from `urgent` to `critical`. Keep legacy aliases only at archive/import and Vault Sync boundaries:

```rust
match normalized.as_str() {
    "none" => Ok(TaskPriority::None),
    "low" => Ok(TaskPriority::Low),
    "medium" => Ok(TaskPriority::Medium),
    "high" => Ok(TaskPriority::High),
    "critical" | "urgent" => Ok(TaskPriority::Critical),
    _ => Err("Priority must be No priority, Low, Medium, High, or Critical".to_owned()),
}
```

Ensure `TaskPortableProperties` title-cases `critical` to `Critical`, and no response/event/export path emits `urgent`.

- [ ] **Step 4: Run affected backend tests**

```bash
cargo test -p kanleaf-server --locked
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test tasks --test saved_views --test vault_sync --test webhook_contract
```

Expected: PASS.

- [ ] **Step 5: Commit the priority contract**

```bash
git add apps/server/src/domain/mod.rs apps/server/src/task.rs apps/server/src/task/query_engine.rs apps/server/src/portability/sync.rs apps/server/src/portability/import.rs apps/server/src/portability/import_archive.rs apps/server/src/domain/events.rs apps/server/tests/tasks.rs apps/server/tests/task_workflow.rs apps/server/tests/saved_views.rs apps/server/tests/vault_sync.rs apps/server/tests/webhook_contract.rs
git commit -m "feat(server): rename urgent priority to critical"
```

### Task 4: Preserve portability while importing into the fixed model

**Files:**
- Modify: `apps/server/src/portability/config.rs`
- Modify: `apps/server/src/portability/import_archive.rs`
- Modify: `apps/server/src/portability/import.rs`
- Modify: `apps/server/tests/workspace_export.rs`
- Modify: `apps/server/tests/workspace_import.rs`
- Modify: `apps/server/tests/workspace_config.rs`

**Interfaces:**
- Consumes: Tasks 2–3 fixed State/Priority contracts.
- Produces: icon-free new exports, compatibility sinks for legacy icon fields, and separate imported assignment/default State maps.

- [ ] **Step 1: Add failing export/import tests**

Extend export coverage to assert serialized State, Label, and custom-option objects have no `icon` key and contain five fixed States. Build a current-format archive fixture with:

- old Todo/In Progress/Done roles and icon keys;
- a named Backlog row;
- an arbitrary `Review` State used by one Task, one Project default, the Workspace default, and a saved-view filter;
- a Label and custom option carrying icon keys;
- `Priority: Urgent` in Task Markdown.

After import, assert the destination has exactly five States, the Task and saved view map Review to Backlog, both defaults map Review to Todo, icons are absent from re-export, and the Task priority is `critical`.

- [ ] **Step 2: Run portability tests and verify RED**

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test workspace_export --test workspace_import --test workspace_config
```

Expected: FAIL because exports query removed columns and import still recreates source States one-for-one.

- [ ] **Step 3: Add explicit legacy icon sinks**

For `TaskStateConfig`, `TaskLabelConfig`, and `CustomPropertyOptionConfig`, replace the persisted `icon` field with an input-only field:

```rust
#[serde(default, rename = "icon", skip_serializing)]
#[sqlx(skip)]
pub legacy_icon: Option<String>,
```

Remove icon columns from export queries and import inserts. Remove icon validation while retaining `deny_unknown_fields` for every other unexpected key.

- [ ] **Step 4: Map source States to five destination IDs**

Add an import-only mapping value with exact responsibilities:

```rust
struct FixedStateIds {
    backlog: Uuid,
    todo: Uuid,
    in_progress: Uuid,
    done: Uuid,
    cancelled: Uuid,
}

struct IdMaps {
    states: HashMap<Uuid, Uuid>,
    default_states: HashMap<Uuid, Uuid>,
    fixed_states: FixedStateIds,
    labels: HashMap<Uuid, Uuid>,
    properties: HashMap<Uuid, Uuid>,
    property_options: HashMap<Uuid, Uuid>,
    projects: HashMap<Uuid, Uuid>,
    cycles: HashMap<Uuid, Uuid>,
    modules: HashMap<Uuid, Uuid>,
    tasks: HashMap<Uuid, Uuid>,
    documents: HashMap<Uuid, Uuid>,
}
```

Remove `#[derive(Default)]` from `IdMaps` and add an `IdMaps::new(fixed_states)` constructor that initializes every map with `HashMap::new()`. Generate the five fresh destination IDs before constructing the maps. Map source role/name matches to the corresponding ID in both maps; map every other source ID to Backlog in `states` and Todo in `default_states`. Insert the exact five definitions once instead of iterating source States. Use `default_states` in Workspace/Project inserts and `states` for Tasks and saved-view filters. Keep legacy V1/V2 normalization feeding the same mapping rather than creating another import path.

- [ ] **Step 5: Run portability tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 6: Commit portability compatibility**

```bash
git add apps/server/src/portability apps/server/tests/workspace_export.rs apps/server/tests/workspace_import.rs apps/server/tests/workspace_config.rs
git commit -m "feat(server): normalize imported task properties"
```

### Task 5: Consolidate Workspace Task Settings and remove property icons

**Files:**
- Modify: `apps/desktop/src/features/workspace/types.ts`
- Modify: `apps/desktop/src/features/workspace/settingsSections.ts`
- Modify: `apps/desktop/src/features/workspace/workspaceRouteAdapter.ts`
- Modify: `apps/desktop/src/features/settings/SettingsShell.tsx`
- Modify: `apps/desktop/src/features/workspace/WorkspaceSettings.tsx`
- Modify: `apps/desktop/src/features/custom-properties/PropertiesSettings.tsx`
- Modify: `apps/desktop/src/features/custom-properties/PropertyEditor.tsx`
- Modify: `apps/desktop/src/features/custom-properties/api.ts`
- Modify: `apps/desktop/src/features/task-config/LabelSettings.tsx`
- Modify: `apps/desktop/src/features/task-config/api.ts`
- Delete: `apps/desktop/src/features/task-config/StateSettings.tsx`
- Delete: `apps/desktop/src/features/task-config/TaskConfigurationSettings.tsx`
- Delete: `apps/desktop/src/features/settings/propertyIcons.tsx`
- Modify: `apps/desktop/src/features/settings/SelectValueEditor.tsx`
- Modify: `apps/desktop/src/features/settings/SelectValueEditor.test.tsx`
- Modify: `apps/desktop/src/features/custom-properties/SelectOptionEditor.test.tsx`
- Delete: `apps/desktop/src/features/task-config/TaskConfigurationSettings.test.tsx`
- Create: `apps/desktop/src/features/task-config/LabelSettings.test.tsx`
- Modify: `apps/desktop/src/features/settings/SettingsShell.test.tsx`
- Modify: `apps/desktop/src/features/workspace/WorkspaceSettings.test.tsx`
- Modify: `apps/desktop/src/app/routing/routePaths.test.ts`
- Modify: `apps/desktop/src/features/workspace/workspaceLocation.test.ts`
- Modify: `apps/desktop/src/features/workspace/WorkspaceShell.routing.test.tsx`
- Modify: `apps/desktop/src/styles/global.css`

**Interfaces:**
- Consumes: icon-free server DTOs, five non-null State roles, legacy raw route section strings.
- Produces: `TaskPriority` with `critical`, icon-free drafts/payloads, one Properties Settings surface with embedded Labels, and legacy section canonicalization.

- [ ] **Step 1: Write failing Settings and value-editor tests**

Assert the Settings navigation group is named `Task Settings` and its buttons equal `['Properties']`. Route tests must expect `states` and `labels` to be invalid typed sections, while `workspaceLocationFromRoute` normalizes either raw route to `properties` and `workspaceLocationPath` returns `/w/<id>/settings/workspace/properties`.

Update the Properties integration test to await Label name/description/value controls on the Properties overview, edit a Label through the shared popover, and verify the Label API call. Assert no button name matches `/icon/i`, no `Icon` column exists, and adding/saving an option does not submit the outer Property form prematurely.

- [ ] **Step 2: Run focused frontend tests and verify RED**

```bash
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/settings/SettingsShell.test.tsx \
  src/features/workspace/WorkspaceSettings.test.tsx \
  src/features/settings/SelectValueEditor.test.tsx \
  src/features/custom-properties/SelectOptionEditor.test.tsx \
  src/app/routing/routePaths.test.ts \
  src/features/workspace/workspaceLocation.test.ts
```

Expected: FAIL on old navigation, icon UI/types, separate Label route, and route validation.

- [ ] **Step 3: Remove icon data and property icon UI**

Remove `icon` from `TaskState`, `TaskLabel`, `CustomPropertyOption`, `SelectValueDraft`, task-config requests, and custom-property option requests. Delete `propertyIcons.tsx` and every property `IconPicker` caller while retaining the shared `IconPicker` and Project picker.

The final value grid is:

```text
drag | color | name | description | default? | edit
```

Retain the approved popover as a non-form container with button-driven save so it cannot bubble a submit to `PropertyEditorForm`. Keep Color, Name, Description, Set as default, destructive actions, Cancel, and Save/Add.

- [ ] **Step 4: Merge Labels into Properties and canonicalize routes**

Make `LabelSettings` a content section owned by `PropertiesSettings` instead of a nested `SettingsArticle`. Query `getTaskConfiguration` alongside custom properties, render Labels before the custom-property tabs, and invalidate `['task-configuration', workspace.id]` plus Task queries after Label saves.

Change:

```ts
export const workspaceSettingsSections = [
  'general',
  'members',
  'properties',
  'projects',
  'storage',
  'danger',
] as const;
```

In `workspaceLocationFromRoute`, normalize `states`, `labels`, and the existing `invitations` alias before returning the location:

```ts
const normalizedSection =
  section === 'states' || section === 'labels'
    ? 'properties'
    : section === 'invitations'
      ? 'members'
      : section;
```

Pass `onConfigurationUpdated` into `PropertiesSettings`; remove State/Label branches and files.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command plus:

```bash
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/task-config/LabelSettings.test.tsx
pnpm typecheck
```

Expected: PASS. The retained Label behavior now lives in `LabelSettings.test.tsx`; no test or source file keeps the deleted `TaskConfigurationSettings` name.

- [ ] **Step 6: Commit Settings consolidation**

```bash
git add apps/desktop/src/features/settings apps/desktop/src/features/task-config apps/desktop/src/features/custom-properties apps/desktop/src/features/workspace apps/desktop/src/app/routing apps/desktop/src/styles/global.css
git commit -m "feat(desktop): consolidate task property settings"
```

### Task 6: Install fixed SVG assets and value-icon primitives

**Files:**
- Create: `apps/desktop/src/assets/task-properties/state-backlog.svg`
- Create: `apps/desktop/src/assets/task-properties/state-todo.svg`
- Create: `apps/desktop/src/assets/task-properties/state-in-progress.svg`
- Create: `apps/desktop/src/assets/task-properties/state-done.svg`
- Create: `apps/desktop/src/assets/task-properties/state-cancelled.svg`
- Create: `apps/desktop/src/assets/task-properties/priority-none.svg`
- Create: `apps/desktop/src/assets/task-properties/priority-low.svg`
- Create: `apps/desktop/src/assets/task-properties/priority-medium.svg`
- Create: `apps/desktop/src/assets/task-properties/priority-high.svg`
- Create: `apps/desktop/src/assets/task-properties/priority-critical.svg`
- Create: `apps/desktop/src/features/task/TaskValueIcon.tsx`
- Create: `apps/desktop/src/features/task/TaskValueIcon.test.tsx`
- Modify: `apps/desktop/src/components/ui/Select.tsx`
- Modify: `apps/desktop/src/components/ui/Select.test.tsx`
- Modify: `apps/desktop/src/styles/global.css`

**Interfaces:**
- Consumes: `TaskState['system_role']` and `TaskPriority` from Task 5.
- Produces: `StateIcon({ role, size, className })`, `PriorityIcon({ priority, size, className })`, `PriorityBadge({ priority })`, and `SelectOption.icon?: ReactNode`.

- [ ] **Step 1: Write failing icon and Select tests**

Render every role/priority and assert stable accessible-hidden test hooks and exact semantic classes. Open a Select whose options carry icons and assert the trigger contains the selected icon, every option contains its own decorative icon, and option accessible names remain plain labels.

```tsx
render(
  <Select
    ariaLabel="Priority"
    value="critical"
    startIcon={<PriorityIcon priority="critical" />}
    options={TASK_PRIORITY_OPTIONS.map((option) => ({
      ...option,
      icon: <PriorityIcon priority={option.value} />,
    }))}
    onValueChange={vi.fn()}
  />,
);
expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveTextContent('Critical');
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/task/TaskValueIcon.test.tsx \
  src/components/ui/Select.test.tsx
```

Expected: FAIL because the components and option-icon interface do not exist.

- [ ] **Step 3: Move and finalize the supplied assets**

Use `apply_patch` moves so `uploads/` is never staged. Preserve supplied Todo/In Progress and Priority SVG geometry. Use the approved Backlog circle:

```svg
<circle cx="12" cy="12" r="8" pathLength="70" stroke="#000" stroke-width="2.4"
  stroke-linecap="round" stroke-dasharray="5 5" stroke-dashoffset="2.5"
  transform="rotate(-90 12 12)"/>
```

Use solid Done/Cancelled circles with SVG masks that cut transparent check/X paths. Do not mask Priority at render time; its white Critical exclamation and bar opacity must remain intact.

- [ ] **Step 4: Implement focused icon components and Select option icons**

Map semantic values to imported asset URLs in `TaskValueIcon.tsx`. State renders a span with CSS mask plus role class; Priority renders an `<img alt="" aria-hidden="true">`; PriorityBadge renders icon plus `priorityLabel(priority)`.

Extend `SelectOption` with `icon?: ReactNode` and render it before `SelectOption.ItemText`:

```tsx
{option.icon ? (
  <span className="select-option-icon" aria-hidden="true">
    {option.icon}
  </span>
) : null}
```

Use theme selectors/tokens for State light/dark colors and explicit 15px badge icons. Do not introduce a registry that accepts arbitrary icon names.

- [ ] **Step 5: Run focused tests and visual asset checks**

Run the Step 2 tests and `pnpm typecheck`. Open a light and dark component view and verify State theme colors plus Critical's white `!`.

- [ ] **Step 6: Commit the icon foundation**

```bash
git add apps/desktop/src/assets/task-properties apps/desktop/src/features/task/TaskValueIcon.tsx apps/desktop/src/features/task/TaskValueIcon.test.tsx apps/desktop/src/components/ui/Select.tsx apps/desktop/src/components/ui/Select.test.tsx apps/desktop/src/styles/global.css
git commit -m "feat(desktop): add fixed task value icons"
```

### Task 7: Implement the approved one-line Task row

**Files:**
- Modify: `apps/desktop/src/features/task/TaskListPane.tsx`
- Modify: `apps/desktop/src/features/task/TaskListPane.test.tsx`
- Modify: `apps/desktop/src/styles/global.css`
- Modify: `apps/desktop/e2e/core-workflow.spec.ts`

**Interfaces:**
- Consumes: `StateIcon` and `PriorityBadge` from Task 6.
- Produces: the approved 50px List row with fixed State/Priority presentation.

- [ ] **Step 1: Write failing row behavior and geometry tests**

Update the List test to assert each row shows its 15px title, the fixed State component, a visible Priority label including `No priority`, and no Task reference text. Keep the existing State-cycle click assertion and confirm its accessible name still announces the next State.

In the E2E workflow, select List layout and evaluate one real row:

```ts
const row = page.getByRole('option', { name: /Complete the v0\.1 workflow/ });
await expect(row).toHaveCSS('min-height', '50px');
await expect(row.locator('.task-row-title')).toHaveCSS('font-size', '15px');
await expect(row.locator('.task-state-icon')).toHaveCSS('width', '30px');
await expect(row.locator('.task-state-icon')).toHaveCSS('height', '30px');
await expect(row.locator('.task-row-reference')).toHaveCount(0);
await expect(row.getByText('No priority')).toBeVisible();
```

- [ ] **Step 2: Run focused unit test and verify RED**

```bash
pnpm --filter @kanleaf/desktop exec vitest run src/features/task/TaskListPane.test.tsx
```

Expected: FAIL on reference visibility, missing badge/icon, and old priority copy.

- [ ] **Step 3: Replace row markup and CSS**

Use the grid:

```css
.task-row {
  min-height: 50px;
  grid-template-columns: 26px 36px minmax(0, 1fr) auto;
}
.task-row-title {
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-state-icon {
  width: 30px;
  height: 30px;
}
```

Replace the generated CSS status circle with `StateIcon`. Remove the reference and second-line metadata wrapper; place permitted optional metadata in a single clipped inline region with the title, and place `PriorityBadge` in the final grid column. Always show the Priority badge in List layout, including No priority. Keep Table field visibility behavior unchanged.

- [ ] **Step 4: Run unit test and targeted E2E**

```bash
pnpm --filter @kanleaf/desktop exec vitest run src/features/task/TaskListPane.test.tsx
docker exec kanleaf-postgres-dev dropdb --if-exists -U kanleaf kanleaf_task_row_e2e
docker exec kanleaf-postgres-dev createdb -U kanleaf kanleaf_task_row_e2e
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_task_row_e2e \
  pnpm --filter @kanleaf/desktop exec playwright test e2e/core-workflow.spec.ts \
  --grep "manages structured work and durable Markdown across reloads"
docker exec kanleaf-postgres-dev dropdb -U kanleaf kanleaf_task_row_e2e
```

Expected: PASS.

- [ ] **Step 5: Commit the Task row**

```bash
git add apps/desktop/src/features/task/TaskListPane.tsx apps/desktop/src/features/task/TaskListPane.test.tsx apps/desktop/src/styles/global.css apps/desktop/e2e/core-workflow.spec.ts
git commit -m "feat(desktop): redesign task list rows"
```

### Task 8: Add value icons to Task editing and remaining value surfaces

**Files:**
- Modify: `apps/desktop/src/features/task/TaskPinnedProperties.tsx`
- Modify: `apps/desktop/src/features/task/TaskDetailPane.test.tsx`
- Modify: `apps/desktop/src/features/task/taskPropertyModel.ts`
- Modify: `apps/desktop/src/features/view/TaskLayouts.tsx`
- Modify: `apps/desktop/src/features/view/grouping.ts`
- Modify: `apps/desktop/src/features/view/grouping.test.ts`
- Modify: `apps/desktop/src/features/view/TaskViewToolbar.tsx`
- Modify: `apps/desktop/src/features/workspace/types.ts`
- Modify: `apps/desktop/src/styles/global.css`

**Interfaces:**
- Consumes: Task 6 icon primitives and Select option-icon support.
- Produces: State/Priority icons in Task Detail triggers/options, fixed `critical` frontend vocabulary, and consistent existing table/bulk/group surfaces.

- [ ] **Step 1: Write failing Task Detail and grouping tests**

In `TaskDetailPane.test.tsx`, assert the State and Priority combobox triggers contain the current fixed icons, open each combobox, and assert all five options expose the correct label without changing accessible names. Select Done and Critical, then assert mutation patches remain exactly:

```ts
expect(patch).toHaveBeenNthCalledWith(1, { state_id: doneState.id });
expect(patch).toHaveBeenNthCalledWith(2, { priority: 'critical' });
```

Update grouping literals to `['none','low','medium','high','critical']` and labels to `No priority`, `Low`, `Medium`, `High`, `Critical`.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/task/TaskDetailPane.test.tsx \
  src/features/view/grouping.test.ts
```

Expected: FAIL on `urgent`, missing trigger icons, and missing option icons.

- [ ] **Step 3: Wire fixed value presentation**

Change the TypeScript union and option list:

```ts
export type TaskPriority = 'none' | 'low' | 'medium' | 'high' | 'critical';

export const TASK_PRIORITY_OPTIONS = [
  { value: 'none', label: 'No priority' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
] as const;
```

Pass `startIcon={<StateIcon role={task.state.system_role} />}` and option icons into the State Select; do the same with `PriorityIcon`. Render the same icon/text pairing for read-only Task Detail. Update bulk controls, editable Table cells, grouping labels, filters, and toolbar options where these values already appear; do not change their layout beyond accommodating the fixed icon.

- [ ] **Step 4: Run affected frontend tests**

```bash
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/task/TaskDetailPane.test.tsx \
  src/features/task/TaskListPane.test.tsx \
  src/features/view/grouping.test.ts \
  src/features/view/api.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit editing/value surfaces**

```bash
git add apps/desktop/src/features/task apps/desktop/src/features/view apps/desktop/src/features/workspace/types.ts apps/desktop/src/styles/global.css
git commit -m "feat(desktop): show fixed task value icons"
```

### Task 9: Complete integration, migration verification, and release checks

**Files:**
- Modify: `apps/desktop/e2e/core-workflow.spec.ts`
- Delete: `.codex-task-item-demo.html`
- Delete: `.codex-task-item-assets/`
- Move/remove from working tree: `uploads/` after all ten approved assets exist under `apps/desktop/src/assets/task-properties/`

**Interfaces:**
- Consumes: Tasks 1–8.
- Produces: one reviewed branch, no demo/upload artifacts, full local verification, pushed `dev`, and terminal GitHub Actions results.

- [ ] **Step 1: Finish the real browser workflow**

Update the core E2E path to use Properties for Labels, assert old States/Labels URLs replace to Properties, create a custom select option through the popover without an icon, create a Task with Critical priority, and verify Task Detail/List icons plus the 50/30/15 geometry from Task 7.

- [ ] **Step 2: Run focused browser tests against a disposable database**

Create a fresh exact database name, run the target workflow, then drop only that database:

```bash
docker exec kanleaf-postgres-dev createdb -U kanleaf kanleaf_fixed_properties_e2e
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_fixed_properties_e2e \
  pnpm --filter @kanleaf/desktop exec playwright test e2e/core-workflow.spec.ts \
  --grep "manages structured work and durable Markdown across reloads"
docker exec kanleaf-postgres-dev dropdb -U kanleaf kanleaf_fixed_properties_e2e
```

Expected: PASS.

- [ ] **Step 3: Remove temporary design artifacts and inspect assets**

Use `apply_patch` to delete `.codex-task-item-demo.html` and `.codex-task-item-assets/`. Confirm `git status --short` contains no `uploads/` entry and all ten production SVGs are tracked. Do not stage the original `uploads/` directory.

- [ ] **Step 4: Run the complete frontend quality group**

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm tauri build --no-bundle
```

Expected: every command exits 0. Record any existing non-failing bundle-size warning separately.

- [ ] **Step 5: Run the complete backend and migration quality group**

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --locked
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test --workspace --all-features --locked
docker compose --env-file infra/self-host/.env.example \
  -f infra/self-host/compose.yaml config --quiet
```

Expected: every command exits 0, including the raw migration-from-27 regression.

- [ ] **Step 6: Run full browser suites**

Recreate the exact disposable `kanleaf_e2e` and `kanleaf_e2e_self_host` databases, then run:

```bash
docker exec kanleaf-postgres-dev dropdb --if-exists -U kanleaf kanleaf_e2e
docker exec kanleaf-postgres-dev dropdb --if-exists -U kanleaf kanleaf_e2e_self_host
docker exec kanleaf-postgres-dev createdb -U kanleaf kanleaf_e2e
docker exec kanleaf-postgres-dev createdb -U kanleaf kanleaf_e2e_self_host
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_e2e pnpm test:e2e
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_e2e_self_host pnpm test:e2e:self-host
```

Expected: both suites PASS.

- [ ] **Step 7: Inspect final diff and commit integration**

```bash
git status --short --branch
git diff --check
git diff --stat origin/dev...HEAD
git diff origin/dev...HEAD -- apps/server/migrations apps/server/src apps/desktop/src apps/desktop/e2e
git add apps/server apps/desktop
git commit -m "test: cover fixed task property workflows"
```

Confirm no `.codex-task-*`, `uploads/`, secrets, generated databases, screenshots, build output, or unrelated user files are staged.

- [ ] **Step 8: Push and follow GitHub Actions to terminal results**

```bash
git push origin dev
gh run list --branch dev --commit "$(git rev-parse HEAD)" --limit 10
gh run watch <quality-run-id> --exit-status
gh run watch <container-image-run-id> --exit-status
```

Expected: Quality backend/frontend/e2e and Container image jobs all reach a successful terminal state. If a job fails, inspect it with `gh run view <run-id> --log-failed`, fix through a new test-first commit, push again, and watch the replacement runs.
