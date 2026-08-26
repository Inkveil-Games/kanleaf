# Kanleaf Core implementation plan

Design source: `docs/specs/2026-08-27-kanleaf-core-design.md`

Target branch: `rewrite/react-tauri`

## Delivery rules

Implement Kanleaf Core as vertical capabilities. A capability is not complete
when only its migration or UI exists: its domain validation, persistence,
server-side authorization, HTTP contract, desktop behavior, and focused tests
must work together. Keep the repository runnable after every capability commit.

Before each commit:

1. inspect status and the complete staged diff;
2. run `cargo fmt --all` and the relevant Rust tests;
3. run Prettier, TypeScript, ESLint, and relevant Vitest tests for desktop work;
4. remove stale comments, temporary diagnostics, unused dependencies, and demo
   content;
5. use a focused Conventional Commit message.

Do not create a shared crate, generic repository layer, EAV model, policy DSL,
or UI component package during this plan. Extract a helper only after repeated
behavior makes its responsibility concrete.

## Stage 0: protect the baseline

### Work

- Record the current clean status and commit history.
- Run the existing Rust and desktop verification suites before the first
  migration.
- Start the supported PostgreSQL development container and run the existing
  feature-gated integration tests.
- Confirm the current registration, project/task workflow, and Markdown file
  persistence before changing schema behavior.

### Verification

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
cargo test -p kanleaf-server --features postgres-tests
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

No baseline commit is needed unless verification reveals a real defect.

## Stage 1: account, workspace membership, and invitations

### Database

Add an ordered migration for:

- `users.display_name`, theme, timezone, week-start, and date-format
  preferences with constrained values;
- session metadata needed for listing and revocation without storing a raw
  token;
- workspace role values Owner, Admin, Member, and Guest;
- a partial unique constraint enforcing one Owner per workspace;
- workspace monogram accent;
- workspace invitations with normalized email, role, hashed token, expiry,
  state, inviter, and timestamps.

Backfill display names from the email local part and preserve existing Owner and
Member memberships. The registration transaction and workspace creation use
the new defaults immediately after migration.

### Server

- Add focused account types and handlers in a real `account` feature module.
- Extend `auth` with current-password verification, password change, session
  listing, single-session revocation, and revoke-all-others.
- Introduce explicit workspace permission predicates used by membership and
  settings use cases; do not build a generic RBAC system.
- Extend `workspace` with member listing, role changes, removal, leave,
  ownership transfer, invitation creation/list/renew/revoke/accept/decline, and
  matching-email enforcement.
- Return a raw invitation token only when it is created or renewed. Store only
  its digest.
- Add typed vault trash/restore operations and confirmed workspace deletion.
  Perform membership/password checks before any filesystem operation.
- Ensure member removal clears project memberships and task assignments in one
  database transaction once assignment tables exist; until Stage 4, keep the
  use case shaped so that cleanup can be added without changing the HTTP
  contract.

### Desktop

- Create the dedicated Settings shell and Account/Workspace navigation.
- Add Profile, Preferences, Security, Workspace General, Members and
  Invitations, and Danger Zone screens.
- Add role-aware actions and useful loading, empty, forbidden, and mutation
  error states.
- Add the notification badge placeholder only as structural navigation; do not
  fake notification data before Stage 7.
- Keep `VITE_KANLEAF_SERVER_URL` build-time only.

### Tests

- Domain tests for role transitions, last/fixed Owner rules, normalized email,
  invitation expiry, and matching-email acceptance.
- PostgreSQL tests for one-Owner uniqueness, atomic transfer, membership
  isolation, invitation token hashing, password session revocation, leave-last-
  workspace rejection, and deletion cascades.
- Temporary-directory tests for workspace trash, rollback, and unreachable
  orphan behavior.
- React tests for account updates, current-session protection, invitation
  acceptance, role-aware member actions, and destructive confirmation.

### Suggested commits

```text
feat(account): add profile security and session settings
feat(workspace): add roles invitations and lifecycle settings
feat(desktop): add account and workspace settings surfaces
```

Split only where each commit remains operational and tested.

## Stage 2: workspace task configuration

### Database

Add typed tables for:

- workspace task states and their semantic groups;
- workspace labels;
- workspace task types;
- workspace default Inbox state and task type;
- project-enabled task types where project configuration is already available.

Create one default state per semantic group and a protected `Task` type for
every existing workspace. Add `tasks.state_id` and `tasks.task_type_id`, backfill
Todo/In Progress/Done mappings, make both required, then remove the old fixed
status representation once every query has migrated. Extend priority with
Urgent without losing existing values.

Use composite workspace foreign keys so a task cannot point at configuration
from another workspace.

### Server

- Add a cohesive task-configuration feature module for states, labels, and
  types.
- Implement list, create, update, reorder, archive, and guarded delete behavior.
- Prevent removing protected defaults or configuration still required by active
  tasks without an explicit replacement.
- Update registration and workspace creation to install defaults in the same
  transaction.
- Update task create/list/update serialization to expose state/type objects and
  accept stable IDs.

### Desktop

- Add States, Labels, and Task Types workspace settings.
- Use compact editable rows with inline validation, reorder controls, archive,
  and replacement prompts instead of card grids.
- Replace hard-coded status selectors throughout the task UI.

### Tests

- Default installation and migration mapping.
- Cross-workspace configuration rejection.
- Protected default, replacement, reorder, unique-name, and archive behavior.
- Task create/edit behavior with custom state/type and Urgent priority.
- Settings interaction tests for validation, reorder, and replacement flows.

### Suggested commit

```text
feat(task): add workspace states labels and task types
```

## Stage 3: project membership and settings

### Database

Extend projects with identifier, description, lead, Open/Private visibility,
default assignee/state/type, feature toggles, and deletion metadata. Add project
memberships and enabled task-type relations with composite tenant constraints.
Backfill stable unique identifiers for existing projects and mark them Private.

### Server

- Add project-role and effective-access functions: workspace Owner/Admin are
  implicit Admin; all other access is derived from visibility and explicit
  membership.
- Apply effective access to every existing project and project-task endpoint
  before adding new behavior.
- Implement project member list/add/change/remove, Open-project discovery and
  self-join, settings/defaults/features, archive, and confirmed delete.
- Ensure Workspace Guest cannot become Project Admin and project lead always
  has effective Admin access.
- Reject cross-workspace member, state, type, and assignee IDs at the database
  and use-case boundaries.

### Desktop

- Expand project navigation into Overview, Work Items, and enabled feature
  sections.
- Add Project General, Members, Features, Defaults, and Danger Zone settings.
- Display Open projects a Member may join without exposing Private projects.
- Hide mutation controls for Commenter and Viewer while still handling a server
  forbidden response correctly.

### Tests

- Complete workspace/project effective-role matrix.
- Private project non-disclosure and Open self-join rules.
- Guest-to-Admin rejection, implicit Admin behavior, lead constraints, and
  cross-workspace isolation.
- Feature toggle persistence and role-aware project settings interactions.

### Suggested commit

```text
feat(project): add visibility membership roles and settings
```

## Stage 4: complete task workflow

### Database

Add:

- a workspace task number allocated transactionally for readable references;
- start/due dates, estimate, parent, and stable order fields;
- task assignees and labels;
- project-enabled type validation support;
- task relations with canonical ordering and constrained relation types;
- indexes for My Work, date collections, state/type filters, and title search.

The stable UUID remains file identity. The human reference uses the current
project identifier plus workspace task number, or `#<number>` in Inbox; moving a
task may change its displayed prefix but never its number or file path.

### Server

- Expand task create, list, detail, update, move, archive/delete, reorder, and
  bulk-update use cases.
- Add typed filters needed by Inbox, My Work, and project lists before building
  saved views.
- Implement assignment, label, date, estimate, hierarchy, and relation
  mutations with tenant and project-membership checks.
- Reject hierarchy cycles, cross-workspace relations, duplicate relation edges,
  and invalid project moves. Require an explicit cleanup option when a move
  would invalidate project-only fields.
- Keep handlers transport-focused; multi-table invariants live in task use-case
  functions and SQL transactions.

### Desktop

- Rebuild task rows as dense, keyboard-selectable rows with configurable visible
  metadata.
- Expand the detail pane with direct title editing, compact properties,
  assignees, labels, dates, estimates, parent/subtasks, relations, move, archive,
  and delete.
- Add My Work and multi-select bulk actions.
- Preserve Markdown editor state when metadata mutations invalidate/refetch
  task queries.

### Tests

- Transactional numbering under concurrent creates.
- Inbox/project assignment and type validity.
- Move cleanup/rejection, hierarchy cycles, relation symmetry, tenant
  isolation, bulk-update atomicity, ordering, archive, and deletion.
- React keyboard navigation, long titles, inline edits, bulk actions, and failed
  mutation recovery.

### Suggested commit

```text
feat(task): add assignments scheduling hierarchy and relations
```

## Stage 5: cycles and modules

### Database

Add project cycles, project modules, task-cycle membership, and task-module
membership. Use exclusion or transaction-backed overlap validation for active
cycle date ranges, plus composite tenant/project foreign keys.

### Server

- Implement cycle create/edit/archive/complete, derived status, progress, and
  optional incomplete-task transfer.
- Implement module create/edit/status/archive, leads, dates, membership, and
  progress.
- Enforce project feature toggles and effective roles on every operation.
- Reuse task filter/list primitives instead of duplicating collection queries.

### Desktop

- Add cycle and module navigation, list/detail panes, progress summaries, and
  task assignment controls.
- Use rows and small progress indicators, not analytics cards.
- Show disabled-feature guidance only to Project Admin; other roles simply do
  not see disabled navigation.

### Tests

- Cycle overlap, derived status, one-cycle-per-task, completion transfer, and
  project isolation.
- Module many-to-many membership, lead authorization, progress, archive, and
  feature-toggle enforcement.
- Core React creation/edit/assignment flows.

### Suggested commits

```text
feat(cycle): add project timeboxes and task transfer
feat(module): add project outcome planning
```

## Stage 6: saved views and layouts

### Database and server

- Add personal/shared saved views with owner, scope, name, versioned JSON query,
  layout, and timestamps.
- Define Rust enums/structs for every filter, grouping, sort, display property,
  and layout option. Deserialize and validate before query construction.
- Implement the common task query across Inbox, My Work, workspace, project,
  cycle, and module scopes with parameterized SQL only.
- Add shared-view role policies, ownership rules, and safe migration/version
  rejection.

### Desktop

- Introduce a single query-state model and collection toolbar.
- Build List first and use it as the behavior reference for selection, detail
  opening, filters, grouping, sorting, completed visibility, and display fields.
- Add Board with compact columns and permitted drag updates.
- Add Calendar with account-aware week start and date dragging.
- Add Table with inline editing and bulk selection.
- Add Timeline with date bars, moving/resizing, and dependency lines.
- Add personal/shared save, rename, update, duplicate, and delete flows.

Choose narrowly scoped mature dependencies only after evaluating what existing
React and browser APIs cannot reliably provide. A drag library is justified if
it materially improves keyboard and pointer behavior; a giant UI or scheduling
framework is not.

### Tests

- Typed-query parsing, invalid-version rejection, parameterization, equivalent
  filters across scopes, completed semantics, and saved-view authorization.
- React behavior tests for each layout, including keyboard alternatives to drag
  operations.
- Playwright coverage that saves a filtered view, changes layout, reloads, and
  receives the same task set and configuration.

### Suggested commits

```text
feat(view): add typed task queries and saved views
feat(desktop): add board calendar table and timeline layouts
```

## Stage 7: collaboration and notifications

### Database

Add task comments, comment revisions, structured mentions, task subscriptions,
activity records, notifications, and per-user notification preferences. Use
tombstone fields rather than deleting comment thread structure. Add indexes for
task activity, unread notifications, and invitation notifications.

### Server

- Implement comment create/reply/edit/delete and revision retrieval.
- Parse mention IDs from an explicit structured request and verify each target
  can access the task; never infer authorization from display text.
- Record immutable activity for supported task changes and coarsely deduplicate
  repeated document-update events.
- Maintain automatic subscriptions for creator, assignee, mention target, and
  commenter, plus explicit watch/unwatch.
- Create notifications transactionally, skip the actor, apply preferences, and
  expose list/read/mark-all endpoints.

### Desktop

- Add Details and Activity tabs to task detail.
- Render a chronological merged feed with compact activity rows and Markdown
  comments.
- Add one-level reply, edit history, tombstone, mention autocomplete, and
  watch/unwatch behavior.
- Add Notifications navigation, unread badge, filters, mark read/all read, and
  focus refresh with restrained polling.
- Add Account notification preferences.

### Tests

- Comment authorship/moderation, reply depth, revisions, tombstones, and Markdown
  XSS safety.
- Mention visibility, subscription lifecycle, actor suppression, preference
  application, unread isolation, and transaction rollback.
- React and Playwright coverage for comment, mention, notification, read state,
  and cross-workspace non-disclosure.

### Suggested commit

```text
feat(collaboration): add comments activity and notifications
```

## Stage 8: documents and conflict-aware vault access

### Database and vault

- Add document metadata with workspace/project scope, parent, position, and
  archive timestamp.
- Generalize `vault` around typed Task and Page document identities while
  preserving the existing Task path exactly.
- Add content revision hashing using the server's existing SHA-256 dependency.
- Require base revision on writes and return a stable conflict error when the
  current file differs.
- Add typed page creation, atomic write, move metadata, archive/delete, and
  workspace deletion trash tests. Never accept a path segment from HTTP input.

### Server

- Implement document tree/list/detail/create/update/move/reorder/archive/delete.
- Validate parent scope and cycles in the application transaction.
- Extend task-document endpoints to the same revision contract without
  rewriting current Markdown.
- Emit coarse document-update activity after successful authorized saves.

### Desktop

- Add workspace Documents and project Pages navigation.
- Build a compact document tree with create, rename, reorder, nesting, project
  move, archive, and keyboard navigation.
- Reuse one Markdown document component for Task and Page bodies.
- Add conflict UI that keeps local content and offers Reload remote and Copy
  local; do not silently choose a winner.

### Tests

- Parent cycles, subtree moves, project scope, role access, tenant isolation,
  stable file identity, faithful UTF-8 content, atomic saves, external edits,
  stale revisions, and temp-directory cleanup.
- React tests for tree operations, autosave state, explicit save, conflict
  recovery, and metadata refetch without editor data loss.

### Suggested commit

```text
feat(document): add workspace pages and conflict-aware vault saves
```

## Stage 9: Markdown Live Preview

### Editor extension

- Add the CodeMirror state field and syntax-tree traversal needed to identify
  active logical Markdown blocks.
- Implement syntax hiding and rendered marks incrementally for headings,
  emphasis, strong text, links, lists, task lists, blockquotes, inline code,
  fenced code, horizontal rules, and tables.
- Use block replacement widgets only for inactive multiline constructs whose
  vertical structure requires a directly supplied decoration set.
- Mark rendered atomic ranges so cursor movement and deletion cannot enter
  hidden syntax unexpectedly.
- Reveal the complete block on selection, click, keyboard entry, composition,
  or multi-range selection.
- Share safe rendering semantics with `MarkdownPreview`; raw HTML remains
  disabled.

### Desktop behavior

- Make Live Preview default and retain Source, Reading, and Split modes.
- Preserve undo/redo, selection, IME composition, copy/paste, search, line
  wrapping, scroll position, Ctrl/Cmd+S, and autosave.
- Store the preferred editor mode locally per device without coupling it to the
  document source.
- Provide restrained toolbar and status text; do not imitate Obsidian branding
  or chrome.

### Tests and visual review

- Unit-test active block calculation and decoration ranges against representative
  GFM fixtures.
- Test source fidelity after editing each supported construct, including nested
  lists, tables, fenced code, Unicode, and trailing whitespace.
- Test clicking rendered content, keyboard block changes, undo/redo, IME-safe
  updates where the browser test environment permits, and XSS payloads.
- Visually inspect long documents, rapid cursor movement, narrow panes, both
  themes, and Source/Live/Reading/Split transitions.

### Suggested commit

```text
feat(markdown): add source-faithful Live Preview editing
```

## Stage 10: desktop shell, command surfaces, and visual refinement

### Work

- Consolidate the approved navigation → collection → detail information
  architecture across every feature.
- Add resizable panes, device-local widths, sidebar collapse, narrow-window
  detail navigation, and the verified Tauri minimum size.
- Add command palette and global title search for tasks, projects, documents,
  commands, and navigation targets.
- Finish shortcuts, focus restoration, accessible menus/dialogs, role-aware
  contextual actions, skeleton rows, and empty/error states.
- Audit design tokens and remove duplicated colors, spacing, radii, and control
  dimensions.
- Check long names, high task counts, nested documents, dense boards/tables,
  reduced widths, light/dark/system themes, hover/focus/selection, and forbidden
  mutations.

### Tests

- React interaction tests for command execution, keyboard navigation, focus
  restoration, pane persistence, and responsive mode changes.
- Playwright workflows for the complete Core journey and workspace/project
  isolation.
- Browser screenshots or manual captures at representative dimensions for
  deliberate visual comparison during review; do not commit transient output.

### Suggested commit

```text
feat(ui): unify the Kanleaf Core workspace experience
```

## Stage 11: CI, self-hosting, documentation, and final audit

### Work

- Extend CI PostgreSQL coverage for every new integration-test module.
- Keep self-hosting at one Kanleaf service plus PostgreSQL; no queue, proxy, or
  new runtime service is introduced.
- Verify all new schema migrates on an existing database and on a fresh one.
- Update `docs/architecture.md`, `docs/development.md`, README, API examples,
  environment examples, AGENTS guidance only where responsibilities changed,
  and self-host instructions.
- Run the repository-wide search for TODO, FIXME, placeholder, lorem, template,
  localhost hard-coding, filesystem paths, debug output, unused imports and
  dependencies, stale comments, and server request-path unwrap/expect calls.
- Inspect the complete tree, migration order, Git history, ignored files, and
  working tree.
- Build and run the server, browser client, and Tauri client; visually review
  representative workflows and window sizes.

### Final verification

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
cargo test -p kanleaf-server --features postgres-tests
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Also build the supported self-host image, start it with PostgreSQL and a mounted
temporary data directory, exercise registration plus a Markdown save, restart
the stack, and confirm both structured data and vault files persist.

### Suggested commits

```text
test(e2e): cover the Kanleaf Core workflow
ci: verify Kanleaf Core quality gates
docs: document Kanleaf Core development and self-hosting
```

## Completion gate

Do not call Kanleaf Core complete while any planned capability is represented
only by navigation, placeholder data, an unconnected migration, or untested
authorization. Completion requires the approved design behavior, passing full
verification, a visually reviewed UI, concise current documentation,
professional local commit history, and a clean working tree.
