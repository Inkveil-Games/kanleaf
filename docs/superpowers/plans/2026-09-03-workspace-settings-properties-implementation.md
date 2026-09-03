# Workspace Settings and Custom Properties Implementation Plan

Design source:
`docs/superpowers/specs/2026-09-03-workspace-settings-properties-design.md`

## Delivery rules

Implement the capability in dependency order and keep every production change
inside a red-green-refactor cycle. Before each test, name the real regression it
would catch; run it against the current code and confirm the expected failure.
Use existing Base UI, TanStack Query, Lucide, Settings, authorization, SQLx,
projection, and portability patterns. Add only the current dnd-kit React/helper
packages and Rust `url` crate because the approved behavior needs accessible
sortable lists and strict URL parsing.

Do not introduce a generic CRUD renderer, form library, schema validator,
repository interface, Markdown engine, toast system, or a second primitive/icon
library. Do not add custom-property filters, columns, bulk editing, formulas,
relations, rollups, date-time, or numeric formatting.

## 1. Normalize the Settings page/list foundation

Files:

- update `apps/desktop/src/features/settings/SettingsArticle.tsx`;
- add focused shared list/action/archive components beside it;
- update `apps/desktop/src/styles/global.css` and tokens only where a reusable
  semantic token is missing;
- add focused Settings component tests.

RED behaviors:

- page headers keep one eyebrow/title/description/divider structure with an
  optional primary action;
- a Settings list exposes semantic header, rows, empty, busy, and archived
  content without knowing domain fields;
- header/create/edit/data rows receive one feature grid class/variable;
- overflow actions expose accessible labels, disabled items, separators, and
  destructive actions through the existing Base UI Menu;
- archived list Restore actions remain keyboard reachable;
- existing Settings shell navigation tests remain green.

Implementation constraints:

- evolve `SettingsArticle`; do not add another page shell;
- keep domain mutation callbacks out of the shared list;
- remove page width differences at the common owner rather than offsetting
  individual pages;
- avoid snapshots of private class structure; test roles, names, and behavior.

Focused checks:

```bash
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/settings
pnpm typecheck
pnpm lint
```

Commit: `refactor(settings): unify structured settings primitives`

## 2. Add the shared color, icon, and sorting controls

Files:

- add `ColorSwatchPicker` and its centralized palette under the shared UI or
  Settings boundary selected by existing ownership conventions;
- refactor the Project Lucide registry/resolver into a reusable curated icon
  registry while keeping Project-specific allowed icons explicit;
- add shared `IconPicker` and migrate
  `features/project/create/ProjectIconPicker.tsx`;
- add shared sortable list/drag handle components;
- update the desktop manifest and pnpm lockfile for current `@dnd-kit/react` and
  `@dnd-kit/helpers`;
- add focused control and migrated Project tests.

RED behaviors:

- color popover opens, chooses palette/custom normalized hex, works by keyboard,
  closes on Escape, restores focus, and respects disabled state;
- icon popover searches/selects, supports grid keyboard use, closes correctly,
  and renders an unknown key through the fallback;
- Project creation still stores and renders its selected stable key;
- sortable list reorders by pointer and keyboard, cancels on Escape, excludes
  interactive child controls as drag activators, announces movement, and rolls
  local order back when persistence fails.

Implementation constraints:

- use Base UI for popover/menu focus and dismissal;
- use Lucide only;
- one color format: uppercase `#RRGGBB`;
- use the current non-legacy dnd-kit React API documented by the maintainer;
- no new dependency for search or color parsing.

Focused checks:

```bash
pnpm --filter @kanleaf/desktop exec vitest run \
  src/components/ui \
  src/features/settings \
  src/features/project/create
pnpm format:check
pnpm typecheck
pnpm lint
```

The shared-control work may be committed with step 1 if splitting would leave
temporary duplicate picker or sortable infrastructure.

## 3. Migrate States, Labels, and Task types

Files:

- refactor `apps/desktop/src/features/task-config/StateSettings.tsx`;
- refactor `LabelSettings.tsx` and `TaskTypeSettings.tsx`;
- update `TaskConfigurationSettings.tsx`, feature API/types, and tests only as
  required for visible default/protection metadata;
- remove superseded task-configuration CSS and duplicated delete popovers;
- update Rust task-configuration responses/tests only if the UI needs missing
  usage/default metadata.

RED behaviors:

- each page uses the same page header/list/action/archive vocabulary;
- each page's header/create/edit/data rows share one grid definition;
- display rows are text/swatch/icon/badge rows until Edit is selected;
- State create derives a group color only until the user explicitly chooses a
  color; existing colors never change implicitly;
- State edit/reorder/default/archive/replacement/delete behavior is preserved;
- Label create/edit/color/archive/restore/delete behavior is preserved;
- Task type create/edit uses the visual icon picker, renders legacy unknown keys
  safely, and preserves protected/default/reorder/archive/delete rules;
- pending/error states cannot submit duplicates and remain attached to the
  initiating row/dialog;
- permission-limited users see values without admin mutation affordances.

Implementation constraints:

- no Label position column or reorder endpoint;
- no raw Task type icon key input;
- no native color input as the primary control;
- keep server behavior authoritative and do not weaken existing constraints.

Focused checks:

```bash
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/task-config/TaskConfigurationSettings.test.tsx
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test task_configuration
pnpm typecheck
pnpm lint
```

Commit: `feat(settings): improve task configuration editors`

## 4. Add the custom-property schema, domain values, and definition API

Files:

- add ordered migration
  `apps/server/migrations/0021_workspace_custom_properties.sql`;
- add focused domain values under `apps/server/src/domain` only when independent
  validation is reused;
- add `apps/server/src/custom_property.rs` plus cohesive child modules only if
  the feature file becomes difficult to navigate;
- register authenticated routes in the existing server composition;
- add `apps/server/tests/custom_properties.rs`;
- add the direct `url` crate dependency and update `Cargo.lock` when URL value
  validation begins, not for definition-only code.

RED behaviors:

- all seven stable property type strings validate and unknown types fail;
- definitions create/list/edit/reorder/archive/restore within one Workspace;
- type cannot change after creation;
- names remain case-insensitively unique across active and archived definitions;
- names cannot collide case-insensitively with fixed Kanleaf frontmatter keys or
  unowned top-level keys discovered in Task Markdown;
- permanent deletion releases a definition name for immediate reuse;
- only Owner/Admin mutates definitions; members can read definitions needed for
  authorized Task UI; Guests receive only data allowed by existing Workspace
  access rules;
- select definitions create their initial options transactionally;
- non-select properties reject options;
- option create/edit/reorder/archive/restore validates property and tenant;
- option names remain case-insensitively unique across active/archived options;
- cross-Workspace definition/option access is non-disclosing;
- configuration is an object and unsupported keys are rejected rather than
  silently stored;
- migration constraints, composite keys, indexes, and cascades are verified.

Implementation constraints:

- use the Workspace-row lock for order and lifecycle races;
- SQL remains in the owning feature;
- store select options as normalized rows;
- do not implement task values in this step before definition behavior is green.

Focused checks:

```bash
cargo test -p kanleaf-server --locked custom_property
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test custom_properties definitions
cargo fmt --all --check
```

Commit: `feat(properties): add workspace property definitions`

## 5. Add typed Task property values and deletion lifecycle

Files:

- extend the custom-property feature with Task-value use cases;
- extend `apps/server/src/task/model.rs` hydration and Task response;
- register targeted value routes beside current Task routes;
- extend activity/projection enqueue behavior through existing helpers;
- extend Task projection jobs with durable, unioned old-property-key cleanup;
- add value/lifecycle cases to `apps/server/tests/custom_properties.rs` and
  adjacent Task authorization tests.

RED behaviors:

- text, decimal/integer number, date, single select, multi select, checkbox, and
  HTTP/HTTPS URL values set and clear correctly;
- invalid JSON shape, malformed date/URL, empty/duplicate multi selection,
  foreign option, option from another property, archived new selection, and
  oversized values are rejected;
- Inbox and Project Task authorization matches existing Task updates;
- Task response hydrates compact ordered `{ property_id, value }` records;
- archiving preserves values while blocking new assignment;
- permanent property deletion requires exact-name confirmation, clears every
  value in the transaction, releases the name, and enqueues old-key cleanup for
  every affected Task;
- a newly created value using the same name survives an older pending cleanup
  because projection removes queued keys before rendering current canonical
  values;
- permanent option deletion clears single-select values and removes only that
  UUID from multi-select values;
- concurrent reorder/archive/value/delete operations cannot leave invalid
  references;
- Task and Workspace deletion clean values through verified FKs.

Implementation constraints:

- authorize Task location before definition lookup/disclosure;
- deserialize and validate `serde_json::Value` into one typed enum at the use-case
  boundary;
- keep explicit false checkbox values;
- use `url::Url` and allow only HTTP/HTTPS;
- keep pending cleanup names durable until successful projection and treat them
  as owned stale keys during collision discovery;
- no filter/query integration.

Focused checks:

```bash
cargo test -p kanleaf-server --locked custom_property
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test custom_properties values
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test tasks authorization
```

Keep this in the definition commit only if schema and definition/value use cases
cannot be reviewed independently; otherwise commit as part of the Markdown
vertical slice below.

## 6. Project values to Obsidian and extend Vault Sync/portability

Files:

- extend `apps/server/src/task/frontmatter.rs`, `TaskVaultRow`, hydration queries,
  and projection tests;
- extend `apps/server/src/portability/sync.rs` and Vault Sync tests;
- add an expiring, revision-checked undefined-property discovery/define operation
  using the existing `workspace_operations` pattern;
- version and extend `portability/config.rs`, archive validation, export, import,
  ID maps, and round-trip tests;
- add property/option config projection triggers in migration 0021.

RED behaviors:

- each value renders under the definition's direct top-level display name,
  never a nested map or prefixed raw-JSON field;
- Obsidian-compatible scalar/list types round-trip without changing body,
  newline style, or unrelated YAML;
- dynamic names/values are safely quoted;
- fixed system keys and active/archived definition names remain reserved;
- unowned top-level keys are preserved, grouped as Undefined by name/count, and
  block normal create/rename rather than being overwritten;
- Define rechecks Task metadata and file revisions, manually converts every raw
  value, and adopts all values atomically or none;
- Text adoption stringifies scalar/list/mapping values; other types validate
  strictly, and select types require manually configured options covering the
  raw names;
- no type inference or automatic option creation occurs;
- definition/option rename and deletion reproject all affected Tasks;
- Vault Sync previews valid changes and applies them through the same typed Task
  value use case;
- missing defined keys clear values; invalid type/options remain non-applicable
  issues; unknown names remain raw Undefined fields; clearing an archived value
  is allowed;
- task-config format carries definitions/options and remaps UUIDs;
- old archives without properties still validate/import;
- new archives round-trip definitions, options, values, archive state, and
  Markdown projection;
- projection failure leaves PostgreSQL canonical state and retry health visible.

Implementation constraints:

- never serialize the JSONB storage representation directly into Markdown;
- only fixed keys, defined names, and projection-job cleanup keys are owned;
- remove queued old keys before writing current values so name reuse is safe;
- insert/remap definitions and options before importing Tasks;
- do not duplicate Task values into task-config JSON.

Focused checks:

```bash
cargo test -p kanleaf-server --locked task::frontmatter
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test custom_properties markdown
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test vault_sync custom_property
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test workspace_export property
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test workspace_import property
```

Commit: `feat(properties): add task values and markdown sync`

## 7. Add the Properties Settings route and editors

Files:

- add typed route metadata in
  `apps/desktop/src/features/workspace/settingsSections.ts` and adjacent routing
  tests;
- add `apps/desktop/src/features/custom-properties/api.ts`, types, query/mutation
  hooks or owning screen as appropriate to current feature patterns;
- add the Properties list, create/edit dialog, delete confirmations, and shared
  `SelectOptionEditor`;
- add Defined/Undefined views and the discovery-backed Define dialog;
- wire the route through `WorkspaceSettings.tsx` and `WorkspaceShell.tsx` without
  introducing a second source of section state;
- add the Owner/Admin-only plus action beside the Task properties sidebar
  heading;
- add focused feature tests and CSS using the shared Settings primitives.

RED behaviors:

- `/settings/workspace/properties` survives refresh/Back/Forward and is selected
  in the Task properties sidebar group;
- `?define=<property-name>` opens the matching Define dialog on refresh and
  closing it removes only the query parameter;
- loading/error/retry/empty/permission states use common Settings treatment;
- New property dialog exposes only fields relevant to the selected type;
- entering an Undefined name redirects the user into Define instead of creating
  a duplicate; Define requires explicit type and explicit select options;
- all seven property types create successfully and duplicate/invalid input stays
  visible with the server message;
- single/multi types share the same option editor, color picker, reorder, and
  action behavior;
- display/edit/archive/restore/reorder follow shared row rules;
- property/option deletion shows impact then exact-name confirmation and cannot
  submit twice;
- active rows, archived rows, long content, and narrow layouts remain usable.

Focused checks:

```bash
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/workspace/WorkspaceSettings.test.tsx \
  src/features/custom-properties
pnpm format:check
pnpm typecheck
pnpm lint
```

Commit: `feat(properties): add workspace properties settings`

## 8. Add custom values to Task detail

Files:

- extend Workspace/custom-property API types and TanStack Query ownership;
- add the authorized Task-scoped undefined-frontmatter read endpoint and query;
- update `features/task/taskPropertyModel.ts`, `TaskProperties.tsx`, and focused
  controls without merging system and custom domain types prematurely;
- update `TaskDetailPane` composition and tests;
- invalidate/update query data through existing Task mutations.

RED behaviors:

- definitions load only after fresh Workspace access;
- Add property separates system and custom fields and follows property order;
- Task detail renders and saves every supported control through the targeted
  value endpoint;
- single select stores exactly one option UUID and multi select stores multiple
  stable option UUIDs;
- archived definitions/options preserve existing display, cannot be newly
  selected, and can be cleared;
- unowned Markdown keys render read-only as raw stringified values with an
  `Undefined` badge and never enter the value API implicitly;
- Owner/Admin `Define property` flushes pending Markdown through
  `DocumentSaveCoordinator`, then uses the typed Settings route/query;
- one pending property does not disable unrelated fields;
- failed save preserves/reverts the visible server value and reports the
  structured error;
- account/Workspace transition cannot render stale definitions or values.

Focused checks:

```bash
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/task/TaskDetailPane.test.tsx \
  src/features/task/TaskProperties.test.tsx \
  src/features/custom-properties
pnpm typecheck
pnpm lint
```

Commit: `feat(ui): add custom properties to task detail`

## 9. Visual, accessibility, integration, and guidance review

Files:

- add one essential Playwright workflow to the existing appropriate suite;
- update `docs/architecture.md`, root `AGENTS.md`, and the project-local
  frontend/backend/product-UI skills only with the durable conventions approved
  in the design;
- remove stale CSS/components after all consumers are migrated.

Verification matrix:

- compare States, Labels, Task types, and Properties at the same wide,
  960×640, and narrow viewport;
- inspect light and dark themes;
- inspect empty, one-row, many-row, archived, long-name, long-description,
  loading, saving, error, disabled, and destructive states;
- complete a keyboard-only pass for sidebar, create/edit, picker, menu, dialog,
  reorder, and Task values;
- capture screenshots and inspect title/content/divider coordinates and shared
  control consistency;
- search the final tree for duplicated color/picker/action/sort CSS, native
  primary color inputs, raw icon-key fields, magic margins, hard-coded surface
  colors, unused components, dead CSS, console logging, and new TODOs.

Run fresh complete checks from the repository root:

```bash
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
```

Create disposable PostgreSQL databases for SQLx and Playwright; never use
deployment data. Review `git status`, every commit diff, and the final cumulative
diff before completion. Report any environment limitation with its exact
command/output.

Final testing/documentation commits remain focused, for example:

- `test(properties): cover custom property workflows`
- `docs(architecture): record custom property boundaries`

Do not force-push. Do not mix unrelated files. The final worktree must be clean.
