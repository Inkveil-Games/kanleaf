# Shared Scroll Area Design

**Date:** 2026-09-28

## Intent

Kanleaf will use one restrained scrollbar treatment across its application-owned
scroll regions. Scrollbars remain discoverable at their interaction strip and on keyboard focus, are
visible while content is moving, and fade away when the region becomes idle.
The change must preserve the desktop pane hierarchy, dense layouts, sticky
headers, keyboard operation, and platform scrolling behavior.

## Goals

- Provide one reusable `ScrollArea` primitive in `components/ui` using the
  already-installed Base UI Scroll Area.
- Give vertical and horizontal scrolling the same visual language in light and
  dark themes.
- Show a scrollbar while its 10 px interaction strip is hovered, while its area is focused, actively scrolled, or
  dragged; otherwise hide it without reserving visible gutter space.
- Adopt the primitive across Kanleaf-owned panes, lists, menus, tables, boards,
  dialogs, Settings surfaces, and Developer surfaces.
- Give embedded scrolling surfaces that cannot safely be wrapped, such as
  CodeMirror and Markdown content overflow, the same tokenized native-scrollbar
  appearance.

## Non-goals

- Do not add another scrolling dependency or implement custom wheel, touch, or
  momentum physics.
- Do not add arrow buttons, permanently visible tracks, scroll shadows, or
  decorative gradients.
- Do not change pane sizing, virtualization, routing, selection, grouping, or
  editor behavior.
- Do not force a scrollbar where content does not overflow.
- Do not replace browser page scrolling outside the authenticated application
  shell or alter operating-system accessibility settings.

## Shared primitive

`apps/desktop/src/components/ui/ScrollArea` will compose Base UI's `Root`,
`Viewport`, vertical and horizontal `Scrollbar`, `Thumb`, and `Corner` parts.
The primitive owns only scrolling presentation and passes semantic attributes,
event handlers, class names, and a forwarded viewport ref to the real scroll
container.

The public API remains small:

- children;
- a root class name;
- viewport props for the owning feature's role, label, keyboard handlers, and
  feature class;
- orientation: vertical, horizontal, or both, defaulting to both.

The component renders the scrollbar parts requested by its orientation. Base UI
self-omits each part unless the corresponding axis overflows. Features continue
to own their semantic roles. For example, the Task list viewport remains the
`listbox`; the shared root is not assigned Task semantics.

No generic scroll state or React context is added outside Base UI. Existing
feature refs that address a scroll container move to the viewport ref rather
than the decorative root.

## Visibility and visual treatment

Base UI provides `data-hovering`, `data-scrolling`, overflow, and orientation
states. The scrollbar is transparent by default and becomes visible when any
of these conditions hold:

- the pointer is over the scrollbar interaction strip;
- the viewport or a descendant has keyboard focus;
- Base UI reports active scrolling;
- the thumb is being dragged.

Base UI clears active scrolling after 500 ms. A 160 ms opacity transition
provides the idle fade. Under `prefers-reduced-motion`, the transition is removed
while the same visible/hidden states remain.

The scrollbar is an overlay inside a relatively positioned root, so appearing
does not shift content or change column alignment. Its interaction strip is
10 px wide while the visible thumb is about 5 px, inset within that strip. The
track and corner remain transparent. The pill-shaped thumb uses muted text and
border tokens mixed with transparency; hover and dragging increase contrast
without using the primary accent. Theme tokens, rather than hard-coded
light/dark colors, determine the result.

## Adoption boundaries

Application-owned scroll containers will migrate to the shared primitive in
coherent feature groups:

1. Workspace navigation, Task list/layouts/detail, Library tree/editor/preview,
   Project planning, Settings, Host Console, and Developer Console.
2. Popovers, command results, notifications, account/workspace menus, property
   catalogs, and dialogs where their primitive structure permits a viewport
   wrapper without changing focus management or popup positioning.
3. Horizontal table, board, calendar, timeline, and responsive Settings
   overflow.
4. Compact navigation rails, setup/recovery surfaces, and the horizontal Task
   toolbar.

Some scroll containers are owned internally by CodeMirror, native form
controls, or rendered Markdown elements. Wrapping those nodes would change DOM
or editor contracts, so they retain native overflow and receive a shared CSS
fallback based on the same size, color, hover, focus, and reduced-motion tokens.
A delegated interaction controller marks only the native scrollbar strip and
active scrolling state; hovering the content itself does not reveal the thumb.
Touch platforms continue using their platform overlay scrollbar.

Previously hidden application-owned toolbar and navigation overflow migrates to
the shared primitive as well. The thumb remains out of the way while idle and
appears only from its interaction strip, focus, or active scrolling.

## Layout compatibility

The shared root and viewport must preserve `min-width: 0`, `min-height: 0`, and
`height: 100%` where the owning grid or flex layout requires them. Feature CSS
continues to own padding, background, and dimensions.

Sticky elements remain inside the viewport. In particular, the Task column
header stays at `top: 0` and grouped State headers stay immediately below it.
Table headers, planning headers, and navigation footers must retain their
current sticky or fixed relationships.

Nested scroll areas keep a single wheel owner at each pointer position while
allowing a gesture on an axis the inner viewport cannot consume to chain to its
parent. No wrapper should be added around content that already delegates
scrolling to a child unless the old parent overflow is removed in the same
change.

## Accessibility and interaction

- Wheel, trackpad, touch, keyboard scrolling, and thumb dragging are provided by
  the browser and Base UI.
- Focus visibility is not replaced by scrollbar visibility. Existing
  `:focus-visible` outlines remain authoritative.
- Hover is not required: focus and active scrolling also reveal the thumb.
- Scrollbars meet usable pointer width through their transparent interaction
  strip while keeping the visual thumb compact.
- Semantic roles, accessible names, `tabIndex`, and keyboard handlers remain on
  the viewport supplied by the feature.
- Reduced-motion users receive immediate visibility changes.

## Testing and verification

Component tests will cover:

- vertical, horizontal, and both-orientation composition;
- forwarding viewport roles, accessible names, handlers, classes, and refs;
- scrollbar state hooks/classes needed for hover, focus, scrolling, and
  reduced-motion styling;
- omission of an axis when the requested orientation excludes it.

Feature tests will verify that Task listbox navigation, sticky headers, pane
scroll refs, popup keyboard interaction, dialogs, and editor behavior retain
their current contracts after migration. Tests should assert semantics and
interaction rather than CSS implementation details.

Visual verification will cover light and dark themes at wide and 960×640
desktop sizes, including vertical panes, horizontal tables, nested popovers,
Task sticky headers, Markdown preview, and CodeMirror. The reviewer should
confirm no content shift when a thumb appears and that idle, hover, focus,
scrolling, and dragging states remain legible.

Before completion, run the full frontend format, typecheck, lint, test, and
build commands plus the applicable Playwright workflow. Review the final diff
for missed application-owned `overflow: auto` declarations and document any
intentional native or hidden-scrollbar exceptions.
