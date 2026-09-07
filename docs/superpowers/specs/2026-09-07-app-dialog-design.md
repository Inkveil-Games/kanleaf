# Kanleaf AppDialog design

## Goal

Replace fragmented confirmation UI in the desktop app with one public
`AppDialog` component. The component owns modal accessibility, shared visual
structure, confirmation input behavior, and action state; features continue to
own business copy, domain data, and mutations.

This migration covers confirmation and acknowledgement flows. Large workflow
modals such as routed Settings, Command Palette, Workspace creation/import,
Project creation, account authentication, and property editing remain separate
because their navigation, staging, or full-form layouts are not confirmation
interactions. They may adopt the shared shell in a later, independently scoped
refactor.

## Primitive and structure

`apps/desktop/src/components/ui/AppDialog/` will export one public component:

```text
AppDialog.tsx
AppDialog.css
AppDialog.test.tsx
index.ts
```

`AppDialog` will use the installed Base UI 1.7 primitives:

- `AlertDialog` for `alert`, `confirm`, and `typed-confirm`, where the user must
  acknowledge or decide before continuing.
- `Dialog` for `custom`, where a feature needs the same modal shell for composed
  content or a form.

Base UI owns the portal, modal isolation, focus trap, focus restoration,
Escape/outside interaction plumbing, and accessible dialog semantics. Kanleaf
owns the token-based styling and action policy.

## Public API

The props will be a discriminated union with these independent concepts:

```ts
type AppDialogType = 'alert' | 'confirm' | 'typed-confirm' | 'custom';

type AppDialogVariant =
  | 'default'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger';
```

All types share controlled `open`/`onOpenChange`, `title`, optional
`description`, `icon`, `children`, `variant`, and compact `size` (`sm`, `md`, or
`lg`). Type-specific props prevent `confirmationText` on anything except
`typed-confirm` and prevent confirm-only labels on `alert`.

Confirmation types support:

- `confirmLabel`, `cancelLabel`, `confirmDisabled`, and `onConfirm`;
- `loading` for mutations managed by a feature or a child form;
- `error` for feature-controlled validation/mutation errors;
- `formId` when the footer action must submit a child `<form>` using the native
  HTML `form` attribute.

`onConfirm` and `formId` are mutually exclusive. Without `formId`, `AppDialog`
awaits `onConfirm`, prevents duplicate submission, closes only after successful
resolution, and keeps the dialog open with an announced error when the promise
rejects. With `formId`, the child form owns submission and passes `loading` and
`error` back to the dialog; this avoids nested forms and preserves browser
validation and Enter submission.

`typed-confirm` additionally requires `confirmationText` and supports a custom
label, placeholder, and case-sensitivity flag. Its input is internal state,
resets whenever the dialog closes, and gates the confirm button.

`alert` renders one Close action. `custom` renders the standard header/body and
only renders footer actions when action props are supplied. No public
`ConfirmDialog`, `AlertDialog`, `DeleteDialog`, or domain-specific dialog type
will be introduced.

## Interaction and accessibility

- Cancel is the initial focus for ordinary destructive confirmation; the typed
  input is initial focus for `typed-confirm`; Close is initial focus for an
  alert.
- Cancel, Escape, backdrop interaction, and the optional close control request
  `onOpenChange(false)` while idle.
- All close requests are ignored while loading so an in-flight destructive
  action cannot be accidentally abandoned or submitted twice.
- The title and optional description use the Base UI association primitives.
- Async failures remain visible inside the dialog with `role="alert"` and are
  cleared before the next attempt or when the dialog resets.
- The footer confirm button is a danger button only for `variant="danger"`;
  other variants use the existing primary action language.

## Visual system

`AppDialog.css` will define the single confirmation overlay, viewport, surface,
header, body, typed-confirm field, error, and footer system. It will reuse the
existing surface, border, shadow, radius, spacing, focus, button, input, and
danger tokens. Only missing semantic info/success/warning colors will be added
to `tokens.css`, with light and dark values.

The default size is compact. `md` supports confirmations containing an input or
select, and `lg` is reserved for real composed content. The surface remains
dense, flat, and restrained rather than card-like or decorative.

## Migration

All production `window.confirm` and `window.prompt` confirmation flows will
move to controlled `AppDialog` instances, including:

- Workspace member removal and ownership transfer;
- leaving and permanently deleting a Workspace;
- Saved View deletion;
- Project member removal, archive, and permanent deletion;
- Cycle and Module archive;
- Host restricted-access policy confirmation;
- Task archive, permanent delete, and Project-move cleanup;
- comment deletion;
- select-option and custom-property deletion;
- Task configuration deletion;
- Library note subtree archive.

Existing typed-confirm surfaces for archived Project deletion will also use the
shared component. Host Workspace deletion keeps its required two-stage flow:
one consequence confirmation followed by typed identifier plus password. The
feature coordinates those two stages while both surfaces are `AppDialog`.

The obsolete `ConfigurationDeleteDialog.tsx` and
`HostWorkspaceDeleteDialog.tsx` files will be removed. Inline confirmation CSS,
host-delete dialog shell CSS, and other confirmation-only rules will be removed
after call-site migration. Feature-specific content styling may remain only for
content placed inside `AppDialog`, not for overlay, surface, header, or footer.

## Tests and verification

Shared component tests will cover alert, confirm, typed-confirm reset and case
sensitivity, custom children, native form submission, async loading, duplicate
submission prevention, rejected promises, accessible roles/names, Escape, and
focus restoration at the level supported by jsdom/Base UI.

Affected feature tests and Playwright assertions will use visible dialog
interactions instead of browser-dialog spies. Verification will include:

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The final audit will search `apps/desktop/src` for `window.confirm`,
`window.prompt`, removed component names, native confirmation shells, and stale
CSS/imports. Essential core and self-host Playwright flows will run when their
database/browser prerequisites are available.
