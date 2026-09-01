---
name: kanleaf-product-ui
description: Design, review, or reshape Kanleaf product UI while preserving its established visual system, information density, pane hierarchy, routed Settings patterns, interaction states, responsiveness, keyboard access, and CSS tokens. Use for substantial visual/layout work or UI critique in apps/desktop; do not use for behavior-only fixes, server work, or generic marketing design.
---

# Kanleaf product UI

Use this skill when a task adds a visible product surface or materially changes
layout, hierarchy, styling, navigation, forms, menus, dialogs, empty states, or
responsive behavior. Read root `AGENTS.md`, inspect the surrounding screen at
all relevant sizes and themes, then reuse the current product language.

Do not use it for:

- behavior-only routing, query, or API changes with no visual decision;
- server/backend work;
- a marketing site, illustration, logo, or generic design-system tutorial;
- copying Plane, Linear, Notion, or another product verbatim.

When event handling, routing, queries, or component state also change, pair this
skill with the Kanleaf frontend engineering workflow. For review-only requests,
inspect and report evidence without editing. This file remains complete for its
own visual, interaction, accessibility, testing, and verification responsibilities.

## Product character

Kanleaf is a calm desktop workbench for structured Tasks and durable Markdown,
not an analytics dashboard. Its visual character is:

- restrained warm surfaces and a muted green accent;
- dense but readable rows, lists, trees, and metadata;
- shallow elevation, subtle borders, and compact controls;
- stable navigation/collection/detail panes;
- clear selection, focus, hover, pending, error, and destructive states;
- typography and spacing that support long working sessions rather than
  promotional presentation.

Avoid card grids, oversized hero headings, decorative gradients, gratuitous
glass effects, excessive pills, floating islands, modal-first detail, empty
dashboard statistics, and generic “AI SaaS” chrome.

## Existing sources

- `apps/desktop/src/styles/tokens.css`: light/dark color tokens, spacing,
  radii, control height, typography sizes, focus, syntax colors, and popover
  shadow.
- `apps/desktop/src/styles/global.css`: established layouts, component states,
  responsive rules, and product density.
- `apps/desktop/src/components/ui`: shared controls such as `ContextMenu`,
  `Select`, and `Wordmark`.
- `apps/desktop/src/features/settings`: routed overlay shell, navigation, form
  articles, and action feedback.
- `apps/desktop/src/features/host`: full-page Host Console variant of the
  Settings language.
- `apps/desktop/src/features/workspace`: top bar, navigation, pane layout,
  resize behavior, and responsive drawer.
- `apps/desktop/src/features/task`, `view`, `document`, and `markdown`:
  row density, collection/detail hierarchy, trees, editor, and state patterns.
- Adjacent `*.test.tsx` and `apps/desktop/e2e`: accessible names, keyboard
  contracts, and essential flows that the visual change must preserve.

Use Lucide through the existing dependency for interface icons. Do not introduce
another icon family or draw text-like symbols when an established icon exists.

## Design workflow

1. Inspect the real parent layout, nearby components, tokens, all states, and
   narrow-window behavior. Do not design a component in isolation.
2. Name the primary user task and information hierarchy. Decide what is always
   visible, selectable, secondary, destructive, or disclosed on demand.
3. Choose the established surface pattern: pane, row/list/tree, popover/context
   menu, routed Settings overlay, full-page Settings surface, or true modal
   operation.
4. Reuse or extend a primitive only when at least two real callers share the
   same semantics. Otherwise keep styling with the owning feature.
5. Implement all interaction states and keyboard/focus behavior, not only the
   ideal static frame.
6. Test at the desktop minimum, a wide window, and the existing narrow layout;
   inspect light and dark themes.
7. Review the rendered result for hierarchy, density, alignment, clipping,
   contrast, and consistency before declaring completion.

## Layout and hierarchy

- Preserve the desktop-first three-pane model where the feature belongs:
  navigation, compact collection, and adjacent detail. Task detail stays a pane.
- Workspace switching uses the compact control above navigation; global search
  and notifications live in `WorkspaceTopBar`; account switching remains in the
  navigation footer. Host Console keeps account switching in its Settings rail
  footer. Do not recreate these controls inside each feature.
- Keep collection rows scannable: one clear primary label, subdued metadata,
  aligned affordances, and a strong but quiet selected state.
- Library hierarchy is a tree, not cards. Indentation, disclosure, rename, drag
  or move affordances, and keyboard selection must remain legible together.
- Account, Workspace, and Project Settings are routed overlays with their own
  section navigation and validated return location. Host Console is a full-page
  Settings surface at `/host` and `/host/access`.
- Use dialogs for bounded operations that require immediate completion or
  cancellation, such as import/confirmation. Do not move ordinary browsing or
  detail editing into dialogs.
- Maintain useful information density. Add whitespace to clarify groups, not to
  make a sparse showcase.
- At narrow Workspace widths, respect the established drawer/scrim and focused-
  detail behavior. Host has a separate narrow pattern: its Settings rail becomes
  top navigation, access controls stack, and account popover direction changes.
  Do not merely shrink either desktop layout until text becomes unusable.

## Host Console invariants

- Host identity is deployment-scoped, not Workspace membership. The Workspace
  list is read-only and may show only Workspace name and Owner metadata; do not
  add Task/Library drilldown, Workspace management, or creation actions.
- The configured Host email is always allowed and cannot be removed. Other
  allowlist entries may be prepared and edited while access remains Open.
- Enabling or saving Restricted access may revoke active sessions immediately.
  Keep the explicit consequence copy and confirmation before applying it.
- Preserve semantic table behavior for Workspace metadata: caption, scoped
  headers, `aria-busy`, and assistive-technology-safe loading rows.
- Host routes and section selection remain durable at `/host` and `/host/access`;
  the account control remains usable in both wide and narrow Host layouts.

## Tokens, type, and spacing

- Use variables from `tokens.css`; do not hardcode parallel light/dark colors
  in a feature. If a genuinely reusable semantic color is missing, add one token
  with both explicit and system dark behavior.
- Keep the existing Inter/system sans stack, size scale, compact controls, small
  radii, and subtle shadow language. Match the owning primitive's established
  height rather than treating one control-height token as universal.
- Use `--color-canvas`, `--color-surface`, and muted surfaces to establish
  depth before adding shadow. Borders and spacing usually carry hierarchy.
- Use the accent for selection, focus, and primary action—not every label.
  Reserve danger tokens for destructive state and confirmation.
- Align repeated controls and metadata to a consistent grid. Avoid arbitrary
  pixel values when an existing space, radius, or control token expresses the
  intent.
- Preserve CodeMirror and Markdown syntax tokens. Raw HTML stays disabled in
  rendered Markdown.

## Interaction states

Cover each applicable state for the surface:

- default, hover, active/selected, focus-visible, disabled, and busy;
- loading with stable layout where possible;
- empty state that explains the collection and offers a next action only when
  the actor has a real authorized action;
- recoverable error with clear retry;
- save state: idle, saving, saved, conflict/error when applicable;
- destructive action separated from routine actions, with explicit consequence
  and confirmation;
- permission-limited state that does not tease controls the actor cannot use.

Do not clear a selected route on loading or transient failure. Do not expose
cached scoped content while its initial authorization is pending. After access
has been confirmed, background refresh should not erase form or editor state.

Menus and popovers close predictably on selection, Escape, outside interaction,
and route changes. Avoid nested click targets with conflicting semantics.
Dialogs trap/restore focus through the established browser behavior and expose a
specific accessible label.

## Accessibility and keyboard operation

- Start with semantic HTML. Buttons perform actions and links navigate by
  default. Preserve the current routed Settings contract, whose `SettingsLink`
  buttons delegate navigation to their route-owning parent, unless a deliberate
  tested migration changes that primitive.
- Preserve visible `:focus-visible` treatment. Never remove an outline without
  a stronger tokenized replacement.
- Make icon-only controls understandable with `aria-label`; keep decorative
  icons hidden from assistive technology.
- Match established row/tree/menu keyboard behavior and test it. Do not make
  pointer drag the only way to reorder or move.
- Keep status feedback announced appropriately without repeatedly stealing
  focus. Associate validation errors with the relevant field or form.
- Check text, muted metadata, selected state, danger state, and focus contrast in
  both themes.
- Respect zoom, long names/emails, reduced space, and content wrapping. Avoid
  fixed heights that clip translated or user-authored text.
- Respect `prefers-reduced-motion`; do not make transition or infinite loading
  animation necessary to understand state.

## Tests and visual verification

Add Testing Library coverage for semantic behavior, accessible names, keyboard
interaction, state transitions, and permission variants. Prefer user-observable
assertions over class-name snapshots.

Run focused and full frontend checks:

```bash
pnpm --filter @kanleaf/desktop exec vitest run \
  src/features/host/HostConsole.test.tsx
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Replace the example test with the nearest changed UI test.

Use Playwright for an essential routed or server-backed workflow, not for every
CSS adjustment. Use the normal suite for core product flows and add self-host
for Host Console, Restricted access, same-origin, SPA routing, or Host-responsive
changes:

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_e2e \
  pnpm test:e2e
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_e2e \
  pnpm test:e2e:self-host
```

Create the example `kanleaf_e2e` database as disposable state. For substantial
visual changes, inspect the rendered screen rather than relying only on tests:

- light, dark, and system theme where relevant;
- minimum 960×640 desktop window and a wide window;
- the existing narrow responsive state;
- keyboard-only navigation and visible focus;
- loading, empty, long-content, error, disabled, and destructive states.

## Common failures

- A new surface becomes a collection of cards despite being a working list.
- A detail view moves into a modal and loses side-by-side context.
- Hardcoded colors look acceptable in light mode but fail dark mode.
- A new select/menu bypasses shared behavior and breaks keyboard access.
- Hover is polished while focus, loading, error, or disabled state is absent.
- A Settings tab is component state instead of a durable route.
- Background refetch unmounts a form and destroys save feedback.
- An empty state dominates the screen or offers an action the role cannot use.
- Mobile-style collapsing damages the desktop minimum or narrow drawer pattern.
- Styling is extracted into an abstraction before a second real use exists.

## Definition of done

The surface has a clear working hierarchy, uses established tokens/primitives,
fits Kanleaf's restrained pane/list language, covers all meaningful interaction
and permission states, works by keyboard, remains legible in both themes and
relevant window sizes, has behavior tests, passes applicable frontend checks,
and has been inspected as rendered.
