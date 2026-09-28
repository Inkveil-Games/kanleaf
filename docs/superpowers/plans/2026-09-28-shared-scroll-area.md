# Shared Scroll Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Kanleaf-owned scrolling surface one restrained, auto-hiding scrollbar treatment without changing its semantics, layout, or native scrolling behavior.

**Architecture:** Add a thin wrapper around the installed Base UI Scroll Area for application-owned panes and lists. Preserve feature roles and handlers on the wrapper's viewport, and use one tokenized native-scrollbar fallback for embedded or popup scroll containers that cannot safely gain a wrapper.

**Tech Stack:** React 19, strict TypeScript, Base UI Scroll Area, CSS design tokens, Vitest/Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-shared-scroll-area-design.md`

## Global Constraints

- Add no dependency; use `@base-ui/react/scroll-area` already in the lockfile.
- Show scrollbar chrome while its 10 px interaction strip is hovered, or during focus-within, scrolling, and dragging; Base UI's active-scroll state clears after 500 ms and CSS fades opacity over 160 ms.
- Use a 10 px interaction strip and approximately 5 px visible pill thumb; keep track and corner transparent.
- Remove the opacity transition under `prefers-reduced-motion`.
- Do not alter wheel, trackpad, touch, keyboard, momentum, selection, routing, virtualization, or editor behavior.
- Render an axis only when requested and let Base UI omit it when that axis has no overflow.
- Migrate application-owned toolbar and navigation overflow; preserve only
  platform-native touch overlay scrollbars and embedded/editor contracts.
- Keep semantic roles, accessible names, keyboard handlers, and scroll refs on the viewport rather than the decorative root.
- Preserve the existing uncommitted Task column-header work and commit it separately before staging ScrollArea implementation files.

## Review Focus

- A region with no overflow must not display or reserve scrollbar chrome; pin this in Task 1 component tests and Task 6 browser inspection.
- A focused child must reveal the scrollbar without requiring hover; pin this in Task 1 CSS-state assertions and Task 6 keyboard inspection.
- Horizontal-only content must not gain a vertical scrollbar or lose its full content width; pin this in Task 1 orientation tests and Task 2 Task layout tests.
- Nested editor/preview and popup scrolling must keep one wheel owner and unchanged focus behavior; pin this in Tasks 3 and 5 feature tests.
- Sticky Task/group and table headers must retain their offsets while scrolling; pin this in Task 2 tests and Task 6 Playwright/visual inspection.

---

### Task 0: Isolate the Approved Task Column Header Change

**Files:**

- Modify: `apps/desktop/src/features/task/TaskListPane.tsx`
- Modify: `apps/desktop/src/features/task/TaskListPane.test.tsx`
- Modify: `apps/desktop/src/features/task/TaskValueIcon.tsx`
- Modify: `apps/desktop/src/styles/global.css`

**Interfaces:**

- Consumes: the already-rendered and user-approved Task list column header.
- Produces: a clean baseline commit before ScrollArea-specific edits begin.

- [ ] **Step 1: Review the existing dirty diff and verify it contains only the approved Task header, `Priority: …` accessible labels, and related CSS**

Run: `git diff -- apps/desktop/src/features/task/TaskListPane.tsx apps/desktop/src/features/task/TaskListPane.test.tsx apps/desktop/src/features/task/TaskValueIcon.tsx apps/desktop/src/styles/global.css`

Expected: no ScrollArea implementation and no unrelated changes.

- [ ] **Step 2: Run the focused Task list test**

Run: `pnpm --filter @kanleaf/desktop exec vitest run src/features/task/TaskListPane.test.tsx`

Expected: 38 tests pass.

- [ ] **Step 3: Commit the approved Task header separately**

```bash
git add apps/desktop/src/features/task/TaskListPane.tsx \
  apps/desktop/src/features/task/TaskListPane.test.tsx \
  apps/desktop/src/features/task/TaskValueIcon.tsx \
  apps/desktop/src/styles/global.css
git commit -m "feat(task): label list metadata columns"
```

### Task 1: Shared ScrollArea Primitive

**Files:**

- Create: `apps/desktop/src/components/ui/ScrollArea/ScrollArea.tsx`
- Create: `apps/desktop/src/components/ui/ScrollArea/ScrollArea.css`
- Create: `apps/desktop/src/components/ui/ScrollArea/ScrollArea.test.tsx`
- Create: `apps/desktop/src/components/ui/ScrollArea/index.ts`
- Modify: `apps/desktop/src/styles/tokens.css`

**Interfaces:**

- Consumes: `ScrollArea` compound parts from `@base-ui/react/scroll-area` and existing color/focus tokens.
- Produces: `ScrollArea`, `ScrollAreaOrientation = 'vertical' | 'horizontal' | 'both'`, and `ScrollAreaProps` with `orientation`, root `className`, `viewportProps`, children, and a forwarded `HTMLDivElement` viewport ref.

```ts
export type ScrollAreaOrientation = 'vertical' | 'horizontal' | 'both';

export interface ScrollAreaProps {
  children: React.ReactNode;
  className?: string;
  orientation?: ScrollAreaOrientation;
  viewportProps?: BaseScrollArea.Viewport.Props;
}

export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  /* ... */
);
```

- [ ] **Step 1: Write failing component tests**

Add tests named:

- `forwards viewport semantics, handlers, classes, children, and refs`;
- `composes only the requested scrollbar axes`;
- `keeps no-overflow scrollbar parts unmounted through Base UI defaults`.

The first test renders a viewport with `role="listbox"`, `aria-label="Tasks"`, a keyboard handler, a feature class, and a ref; it asserts all belong to the viewport and not the root. The orientation test exercises `vertical`, `horizontal`, and `both` and asserts exact orientation parts using a focused Base UI part mock because JSDOM has no layout metrics.

- [ ] **Step 2: Run the test and verify the new module is missing**

Run: `pnpm --filter @kanleaf/desktop exec vitest run src/components/ui/ScrollArea/ScrollArea.test.tsx`

Expected: FAIL because `./ScrollArea` does not exist.

- [ ] **Step 3: Implement the minimal shared primitive and exports**

Implement `React.forwardRef<HTMLDivElement, ScrollAreaProps>` so the forwarded ref targets `ScrollArea.Viewport`. Compose `Root > Viewport > Content`, requested `Scrollbar > Thumb` parts, and `Corner` only for `both`. Keep Base UI's default `keepMounted={false}`.

- [ ] **Step 4: Add the shared visual and fallback tokens**

Define semantic thumb colors in both explicit theme blocks in `tokens.css`. In `ScrollArea.css`, make the root positioned/min-size-safe, hide the native viewport scrollbar, overlay 10 px bars, inset a 5 px pill thumb, and reveal bars under `data-hovering`, `data-scrolling`, focus-within, or pointer dragging. Add the 160 ms fade and reduced-motion override.

- [ ] **Step 5: Run component tests, typecheck, lint, and format check**

Run:

```bash
pnpm --filter @kanleaf/desktop exec vitest run src/components/ui/ScrollArea/ScrollArea.test.tsx
pnpm typecheck
pnpm --filter @kanleaf/desktop exec eslint src/components/ui/ScrollArea --max-warnings 0
pnpm --filter @kanleaf/desktop exec prettier --check src/components/ui/ScrollArea src/styles/tokens.css
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the primitive**

```bash
git add apps/desktop/src/components/ui/ScrollArea apps/desktop/src/styles/tokens.css
git commit -m "feat(ui): add shared scroll area"
```

### Task 2: Workspace and Task Surfaces

**Files:**

- Modify: `apps/desktop/src/features/workspace/WorkspaceNavigation.tsx`
- Modify: `apps/desktop/src/features/workspace/WorkspaceNavigation.test.tsx`
- Modify: `apps/desktop/src/features/task/TaskListPane.tsx`
- Modify: `apps/desktop/src/features/task/TaskListPane.test.tsx`
- Modify: `apps/desktop/src/features/task/TaskDetailPane.tsx`
- Modify: `apps/desktop/src/features/task/TaskDetailPane.test.tsx`
- Modify: `apps/desktop/src/features/view/TaskLayouts.tsx`
- Modify: `apps/desktop/src/styles/global.css`

**Interfaces:**

- Consumes: `ScrollArea` and forwarded viewport ref from Task 1.
- Produces: shared vertical/both-axis scroll roots for navigation, Task list/detail, board, calendar, table, and timeline while retaining all feature classes on viewports.

- [ ] **Step 1: Add failing semantic regression tests**

Extend existing tests to assert:

- the Task viewport remains `role="listbox"`, retains its accessible name and arrow-key navigation, and contains the column header before grouped options;
- the navigation scroll viewport retains its navigation label/content and current keyboard focus targets;
- Task Detail remains addressable by its existing region/inspector semantics;
- horizontal Task layouts retain their existing tables/boards and do not gain duplicate scroll containers.

- [ ] **Step 2: Run the three focused test files and verify the new root/viewport expectations fail**

Run:

```bash
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/task/TaskListPane.test.tsx \
  src/features/task/TaskDetailPane.test.tsx \
  src/features/workspace/WorkspaceNavigation.test.tsx
```

Expected: FAIL on missing shared scroll root/viewport structure while existing semantics still pass.

- [ ] **Step 3: Migrate Workspace navigation and Task surfaces**

Wrap each application-owned scroll container once, move the old feature class and overflow semantics to `viewportProps`, choose `vertical` for navigation/detail and `both` for Task list/table/calendar/timeline. Remove only the superseded `overflow` and native `scrollbar-width` declarations; preserve size, padding, sticky offsets, and backgrounds.

- [ ] **Step 4: Run focused tests and inspect sticky offsets**

Run the command from Step 2.

Expected: all focused tests pass; `.task-list-column-header` remains `top: 0` and grouped headers remain `top: 30px` in the diff.

- [ ] **Step 5: Commit Workspace and Task adoption**

```bash
git add apps/desktop/src/features/workspace/WorkspaceNavigation.tsx \
  apps/desktop/src/features/workspace/WorkspaceNavigation.test.tsx \
  apps/desktop/src/features/task apps/desktop/src/features/view/TaskLayouts.tsx \
  apps/desktop/src/styles/global.css
git commit -m "feat(task): use shared scroll areas"
```

### Task 3: Library, Markdown, and Project Planning Surfaces

**Files:**

- Modify: `apps/desktop/src/features/document/DocumentTree.tsx`
- Modify: `apps/desktop/src/features/document/DocumentTreeDnd.test.tsx`
- Modify: `apps/desktop/src/features/markdown/MarkdownDocument.tsx`
- Modify: `apps/desktop/src/features/markdown/MarkdownPreview.tsx`
- Modify: `apps/desktop/src/features/markdown/MarkdownPreview.test.tsx`
- Modify: `apps/desktop/src/features/project/ProjectPlanningPane.tsx`
- Modify: `apps/desktop/src/features/project/ProjectPlanningPane.test.tsx`
- Modify: `apps/desktop/src/features/project/ProjectOverview.tsx`
- Modify: `apps/desktop/src/features/project/ProjectOverview.test.tsx`
- Modify: `apps/desktop/src/styles/global.css`

**Interfaces:**

- Consumes: `ScrollArea` for owned tree, preview, planning, and overview panes; consumes the native fallback class from Task 1 for CodeMirror and rendered Markdown overflow.
- Produces: one scroll owner per Library/Markdown/Planning pane with unchanged editor and tree semantics.

- [ ] **Step 1: Add failing regression tests for tree, preview, and planning semantics**

Assert that Document tree roles and selection remain on the viewport content, Markdown preview retains raw-HTML-disabled rendering and scrollable tables/code blocks, and Project Planning retains selection/keyboard behavior after a shared root is introduced.

- [ ] **Step 2: Run focused tests and verify structural expectations fail**

Run:

```bash
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/document/DocumentTreeDnd.test.tsx \
  src/features/markdown/MarkdownPreview.test.tsx \
  src/features/project/ProjectPlanningPane.test.tsx \
  src/features/project/ProjectOverview.test.tsx
```

Expected: FAIL only on the new shared-scroll structure/fallback class expectations.

- [ ] **Step 3: Migrate owned panes and apply native fallback to embedded scroll owners**

Use shared viewports for Document tree/body, Markdown preview, planning list/detail, and Project overview. Do not wrap CodeMirror's internal scroller or individual Markdown `pre`/table nodes; give those the shared native fallback styling and remove duplicated `scrollbar-width` declarations.

- [ ] **Step 4: Run focused tests and commit**

Run the command from Step 2; expect all tests to pass.

```bash
git add apps/desktop/src/features/document apps/desktop/src/features/markdown \
  apps/desktop/src/features/project apps/desktop/src/styles/global.css
git commit -m "feat(document): unify scroll areas"
```

### Task 4: Settings, Host, and Developer Shells

**Files:**

- Modify: `apps/desktop/src/features/settings/SettingsShell.tsx`
- Modify: `apps/desktop/src/features/settings/SettingsShell.test.tsx`
- Modify: `apps/desktop/src/features/host/HostConsole.tsx`
- Modify: `apps/desktop/src/features/host/HostWorkspaces.tsx`
- Modify: `apps/desktop/src/features/host/HostConsole.test.tsx`
- Modify: `apps/desktop/src/features/developer/DeveloperShell.tsx`
- Modify: `apps/desktop/src/features/developer/DeveloperNavigation.tsx`
- Modify: `apps/desktop/src/features/developer/DeveloperRoutes.test.tsx`
- Modify: `apps/desktop/src/features/developer/webhooks/webhooks.css`
- Modify: `apps/desktop/src/features/developer/webhooks/WebhookPages.test.tsx`
- Modify: `apps/desktop/src/styles/global.css`

**Interfaces:**

- Consumes: `ScrollArea` for routed shell navigation/content and the shared native fallback for narrow table/code overflow.
- Produces: consistent scrollbars without changing durable routes, account controls, Host permissions, or responsive rail-to-top-navigation behavior.

- [ ] **Step 1: Add failing routed-shell regression tests**

Assert that Settings and Host navigation/content retain their existing landmarks, current section, and narrow-layout order inside shared viewports. Assert Developer navigation keeps its route-owned selection and webhook code blocks carry the fallback class.

- [ ] **Step 2: Run focused routed-shell tests and verify the shared viewport expectations fail**

Run:

```bash
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/settings/SettingsShell.test.tsx \
  src/features/host/HostConsole.test.tsx \
  src/features/developer/DeveloperRoutes.test.tsx \
  src/features/developer/webhooks/WebhookPages.test.tsx
```

Expected: FAIL only on the new shared-scroll expectations.

- [ ] **Step 3: Migrate shell scroll owners without moving route or account boundaries**

Use vertical shared viewports for navigation/content columns. Keep horizontal responsive Settings lists, Host Workspace tables, and webhook code blocks on the shared native fallback. Preserve every current region/heading/table semantic and narrow media rule.

- [ ] **Step 4: Run focused tests and commit**

Run the command from Step 2; expect all tests to pass.

```bash
git add apps/desktop/src/features/settings apps/desktop/src/features/host \
  apps/desktop/src/features/developer apps/desktop/src/styles/global.css
git commit -m "feat(settings): unify shell scroll areas"
```

### Task 5: Compact Menus, Popovers, Dialogs, and Native Fallback Audit

**Files:**

- Modify: `apps/desktop/src/components/ui/Select.tsx`
- Modify: `apps/desktop/src/components/ui/Select.test.tsx`
- Modify: `apps/desktop/src/components/ui/IconPicker.tsx`
- Modify: `apps/desktop/src/components/ui/IconPicker.test.tsx`
- Modify: `apps/desktop/src/components/ui/DropdownMenu.tsx`
- Modify: `apps/desktop/src/components/ui/Popover.tsx`
- Modify: `apps/desktop/src/components/ui/AppDialog/AppDialog.tsx`
- Modify: `apps/desktop/src/components/ui/AppDialog/AppDialog.css`
- Modify: `apps/desktop/src/features/account/AccountSwitcher.tsx`
- Modify: `apps/desktop/src/features/account/AccountSwitcher.test.tsx`
- Modify: `apps/desktop/src/features/collaboration/Notifications.tsx`
- Modify: `apps/desktop/src/features/collaboration/Notifications.test.tsx`
- Modify: `apps/desktop/src/features/command/CommandPalette.tsx`
- Modify: `apps/desktop/src/features/command/CommandPalette.test.tsx`
- Modify: `apps/desktop/src/features/workspace/WorkspaceControl.tsx`
- Modify: `apps/desktop/src/features/workspace/WorkspaceControl.test.tsx`
- Create: `apps/desktop/src/lib/nativeScrollbarReveal.ts`
- Create: `apps/desktop/src/lib/nativeScrollbarReveal.test.ts`
- Modify: `apps/desktop/src/main.tsx`
- Modify: `apps/desktop/src/styles/global.css`

**Interfaces:**

- Consumes: shared native fallback class/tokens and `ScrollArea` only where a wrapper does not alter popup positioning or focus ownership.
- Produces: the common visual treatment for remaining app-owned overflow with unchanged Base UI Select/Menu/Popover/Dialog dismissal and focus behavior, plus delegated strip-hover and active-scroll state for native fallback owners.

- [ ] **Step 1: Add failing popup interaction tests**

In existing component tests, assert the scrollable popup/list/body gets the common fallback or shared viewport while selection, Escape, outside pointer dismissal, focus restoration, and AppDialog labeling remain unchanged.

- [ ] **Step 2: Run focused popup tests and verify the common-scroll assertion fails**

Run:

```bash
pnpm --filter @kanleaf/desktop exec vitest run \
  src/components/ui/Select.test.tsx \
  src/components/ui/IconPicker.test.tsx \
  src/components/ui/DropdownMenu.test.tsx \
  src/components/ui/Popover.test.tsx \
  src/components/ui/AppDialog/AppDialog.test.tsx \
  src/features/account/AccountSwitcher.test.tsx \
  src/features/collaboration/Notifications.test.tsx \
  src/features/command/CommandPalette.test.tsx \
  src/features/workspace/WorkspaceControl.test.tsx
```

Expected: FAIL only on missing common-scroll styling/structure.

- [ ] **Step 3: Apply the common treatment and audit remaining overflow declarations**

Prefer the native fallback class for positioned popups and dialog bodies when an extra wrapper would affect Base UI anchors, collision measurement, or focus trapping. Use `ScrollArea` where the existing scroll container can become its viewport directly, including compact rails, setup/recovery surfaces, and the horizontal Task toolbar. Run `rg -n "overflow(-[xy])?: auto|scrollbar-width" apps/desktop/src` and classify every remaining match as shared primitive, shared fallback, platform/editor-owned exception, or non-scroll layout rule.

- [ ] **Step 4: Run focused tests and commit**

Run the command from Step 2; expect all tests to pass.

```bash
git add apps/desktop/src/components/ui apps/desktop/src/features/account \
  apps/desktop/src/features/collaboration apps/desktop/src/features/command \
  apps/desktop/src/features/workspace/WorkspaceControl.tsx \
  apps/desktop/src/styles/global.css
git commit -m "feat(ui): unify compact scroll surfaces"
```

### Task 6: Full Verification and Hosted Visual Review

**Files:**

- Modify if required by discovered regression: nearest owning component/test only.

**Interfaces:**

- Consumes: all prior tasks.
- Produces: verified shared scrolling behavior and a live preview at `http://127.0.0.1:1420/`.

- [ ] **Step 1: Run the complete frontend verification group**

Run:

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all commands exit 0; no failed test files.

- [ ] **Step 2: Run the essential browser workflow**

Run:

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_e2e \
  pnpm test:e2e
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_e2e \
  pnpm test:e2e:self-host
```

Expected: both Playwright suites pass, including Task navigation and routed Settings/Host surfaces.

- [ ] **Step 3: Host and inspect the real application**

Start `cargo run --locked -p kanleaf-server` and `pnpm dev`. Inspect at wide and 960×640 viewport sizes in light and dark themes. Verify idle, hover, focus, scrolling, dragging, no-overflow, vertical, horizontal, sticky header, popup, CodeMirror, and Markdown overflow states with no content shift.

- [ ] **Step 4: Review final diff and overflow audit**

Run:

```bash
git diff --check
git status --short
rg -n "overflow(-[xy])?: auto|scrollbar-width" apps/desktop/src
```

Expected: every remaining match is the shared primitive, a documented shared fallback, or a platform/editor-owned exception; no temporary screenshots, databases, or preview data are tracked.

- [ ] **Step 5: Commit any verification-only fixes separately**

Use the narrowest Conventional Commit message matching the fix; do not amend earlier reviewed commits or mix generated preview data.
