# Kanleaf Workspace navigation rail design

## Goal

Collapsing Workspace navigation must reduce it to a useful icon rail rather
than remove it. The expanded desktop hierarchy remains intact, while desktop
collapsed and narrow layouts retain direct access to primary destinations,
Saved Views, Projects, the active Project, Workspace switching, and account
actions.

This change is limited to the desktop application's Workspace navigation and
its responsive presentation. React Router remains the location source of
truth, existing navigation callbacks remain the transition boundary, and no
new data or routing state is introduced.

## Current problem

`useWorkspacePaneLayout` currently derives one `navigationVisible` boolean from
both the persisted desktop collapse preference and the transient narrow drawer
state. `WorkspaceShell` then applies `navigation-hidden`, whose CSS removes
`.navigation-pane` entirely. The remaining 44px column therefore contains only
the reopen control and is not a navigation surface.

The model conflates three different presentations:

- an expanded desktop pane;
- a collapsed icon rail;
- a narrow overlay drawer.

The existing 44px rail width, persisted expanded width, navigation callbacks,
Project feature flags, account popover, Workspace popover, and Base UI popup
primitives already provide the pieces needed for the corrected behavior.

## Navigation state contract

The layout hook will expose an explicit presentation mode:

```ts
type NavigationMode = 'expanded' | 'rail' | 'drawer';
```

It is derived as follows:

```text
wide + desktop preference expanded   -> expanded
wide + desktop preference collapsed  -> rail
narrow + drawer closed               -> rail
narrow + drawer open                 -> drawer
```

`navigationCollapsed` remains the only persisted navigation-mode preference.
The narrow drawer state remains transient and resets when the responsive
breakpoint changes. Returning to a wide viewport restores the persisted desktop
preference rather than deriving it from the drawer.

The persisted `navigationWidth` continues to represent only the expanded pane.
The rail uses the semantic `--navigation-rail-width` variable and never writes
its 44px width into preferences. The navigation resize handle renders only in
wide expanded mode.

## Navigation component structure

`WorkspaceNavigation` remains the owning navigation component and receives a
presentation variant. It shares the same route-derived active inputs and the
same callbacks in expanded and rail modes. Small internal action components
share button semantics, icon sizing, active state, and accessible naming so
the rail does not become a second navigation model.

Expanded mode preserves the current hierarchy:

- Inbox, My Work, All tasks, and Workspace Library;
- individual Workspace Saved Views;
- the full Project list;
- the active Project's enabled nested destinations and Project Saved Views;
- the existing full account switcher footer.

Rail mode contains no visible text labels. It exposes:

- an explicit expand/drawer action;
- Inbox, My Work, All tasks, and Workspace Library;
- one Saved Views flyout trigger;
- one Projects chooser trigger;
- an additional active Project trigger when a Project scope is active;
- the existing account switcher with an avatar-only trigger.

Every icon action retains a visible focus state, `aria-label`, minimum 44px
touch target, tooltip on hover/focus, and `aria-current="page"` where the
trigger represents the current route. Route-derived `surface`, `collection`,
`activeProjectId`, and `activeViewId` remain the only active-state inputs.

## Rail flyouts

Rail flyouts use the installed Base UI menu behavior through the shared
`DropdownMenu` primitive. The primitive will gain only the capabilities needed
by this design: right-side placement, controlled open state, trigger tooltip,
and current-item semantics. Base UI continues to own collision handling,
outside dismissal, roving focus, typeahead, Escape, and trigger focus
restoration.

The Saved Views trigger opens a named list of Workspace Saved Views. Its rail
trigger is active only when the routed view belongs to that Workspace-level
list. Selecting a view invokes the existing `onOpenSavedView` callback and
closes the menu.

The Projects trigger opens the existing accessible Project list. Selecting a
Project invokes the current overview callback. The menu includes New Project
only when the current Workspace role already permits Project creation; it does
not broaden the existing permission policy.

When a Project scope is active, a separate trigger uses that Project's
`ProjectIconGlyph` and name. Its flyout contains Overview and, for an actor with
effective Project access, Work items plus enabled Cycles, Modules, Library, and
Views destinations. Enabled Project Saved Views remain available beneath Views
to preserve the expanded hierarchy's reachability. The current nested route is
highlighted in the flyout.

Flyout state is local presentation state. Navigation actions close it, and a
route identity change closes any flyout left open by Back or Forward
navigation.

## Workspace and account controls

Expanded desktop and drawer presentations retain the current Workspace control:
Workspace identity and switcher, divider, and collapse/close action.

In rail mode the Workspace control shows the current Workspace mark as the
compact trigger for the existing Workspace popover. It does not duplicate the
switching, settings, invitation, import, or creation logic. The separate rail
expand action is placed at the start of the navigation rail so two actions are
not crowded into one 44px control.

`AccountSwitcher` keeps one menu implementation. Rail mode changes only its
trigger to the active account avatar and a right-side popup; expanded and
drawer modes retain display name, email, and chevron. All existing account
actions and errors remain available.

## Narrow drawer

Narrow mode renders the icon rail while the drawer is closed. Opening the
drawer mounts a controlled Base UI Dialog above the rail and Workspace content.
The dialog contains the full Workspace control, expanded navigation hierarchy,
and expanded account control.

The modal dialog deliberately covers the rail. Its modal isolation makes the
underlying rail and content inert, so only one navigation tree is interactive
or present in the tab order. The drawer includes a real close button for touch
screen reader escape. Base UI handles focus entry, focus restoration, Escape,
and outside dismissal. Its backdrop acts as the scrim over the remaining
Workspace content.

All navigation callbacks used inside the drawer request the existing route
transition and close the drawer. Route-derived effects also close it for Back,
Forward, and other authoritative location changes. When the dialog's exit
transition completes, the still-mounted rail is revealed with active state
derived from the new route.

## Motion and layout

The rail width is `44px`, matching the existing semantic CSS variable and
topbar row height.

Desktop expand/collapse is one discrete React state change followed by a CSS
transition of the shell's navigation column over approximately 180ms. Rail and
expanded content do not run a JavaScript tween, read layout per frame, or write
preferences during animation.

The narrow drawer uses a transform transition so it appears to slide from
behind the rail and covers it as it opens. Base UI's starting and ending style
states keep the drawer mounted for both entrance and exit transitions. The
scrim fades over the same restrained interval. Text is rendered at the full
drawer width and is not compressed during the transform.

`prefers-reduced-motion: reduce` removes navigation column, drawer, scrim,
tooltip, and flyout motion without changing state or accessibility. No
animation is used as the only indication of active or open state.

## Data and continuity invariants

Opening or closing navigation, opening a local flyout, or crossing the narrow
breakpoint does not change route locators, query keys, selected Task/Page IDs,
or any identity key below `WorkspaceShell`. These interactions therefore do
not remount Task detail, Markdown/CodeMirror, Document detail, Task activity,
or property editors.

The navigation components issue no remote queries merely to present rail or
drawer variants. Existing TanStack Query ownership and Workspace/Project access
gates remain unchanged. Project and Saved View data supplied by the authorized
Workspace shell are reused; no eager detail fetching is added.

## Testing

Focused Vitest and Testing Library coverage will prove:

- the expanded, desktop rail, narrow rail, and narrow drawer mode matrix;
- transient drawer state resets while the persisted desktop collapse
  preference and expanded width survive breakpoint changes;
- rail top-level actions and active semantics;
- Saved Views, Projects, and active Project flyout navigation;
- Project feature and permission filtering;
- accessible names, keyboard menu behavior, Escape, and focus restoration;
- compact Workspace and Account triggers retain their existing popover actions;
- navigation animation uses observable mode/classes without per-frame state or
  preference writes.

An essential Playwright workflow will collapse and expand desktop navigation,
exercise rail and Project flyouts, verify width restoration, enter narrow mode,
open and dismiss the overlay drawer, navigate from it, return to desktop, and
check for horizontal overflow. It will retain an open unsaved editor/activity
draft and count Workspace requests so navigation presentation changes cannot
silently introduce data reloads.

Verification follows the repository's current frontend commands:

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm tauri build --no-bundle
```

The relevant Playwright suite will run with its documented disposable database
setup. No backend, database, public route, or dependency change is part of this
design.
