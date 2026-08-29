# Switch Account Design

## Summary

Kanleaf will retain multiple authenticated accounts for the configured server
and let the user switch identity without signing out first. Account switching
must preserve unsaved Markdown, reset account-scoped client data, and make the
active identity explicit. This is a desktop-client feature; the existing
server session API remains unchanged.

## Goals

- Retain several server sessions without retaining passwords.
- Switch accounts from the account row at the bottom of the sidebar.
- Add an account in a dialog without disrupting the active workspace.
- Revoke one or all retained sessions explicitly.
- Prevent cross-account query-cache reuse.
- Save pending Markdown before leaving the active account.
- Preserve browser rendering and Playwright coverage.

## Non-goals

- Storing passwords or other reusable credentials.
- Synchronizing retained accounts between devices.
- Configuring or switching Kanleaf servers in the UI.
- OS keychain integration in v0.1.
- Backend-linked identities, SSO, or device-session brokers.
- Background validation of every retained session.

## Chosen approach

Use a versioned client-side session registry scoped by normalized server URL.
The registry extends the current local-storage session behavior without adding
a native-only dependency or backend identity model. Its storage interface will
keep token persistence behind one module so a future OS-keychain adapter can
replace it without changing account UI or transition logic.

Alternatives considered:

- A Tauri keychain integration protects tokens better at rest, but adds
  platform-specific behavior and a second browser implementation before the
  product needs it.
- A backend account-switch broker creates linked-identity and device-management
  security requirements that do not belong in Kanleaf Core.

## Stored session model

`kanleaf.account-sessions.v1` contains one versioned document. Sessions are
grouped by normalized server URL so a build pointed at another server cannot
reuse the wrong bearer token.

Each server entry stores:

- the active user ID, or `null` when the user must choose an identity;
- one account entry per user ID;
- email and display name for local presentation;
- the raw bearer token required by the HTTP API;
- the server-reported expiry timestamp;
- a last-used timestamp for stable ordering.

Passwords are never stored. Stored profile fields are display hints, not an
authorization source. `/api/session` validates a token and supplies current
user metadata before Kanleaf activates it.

The legacy `kanleaf.session-token` value remains readable during migration. On
the first successful `/api/session` response, Kanleaf creates the corresponding
registry entry and removes the legacy key. Malformed registry data is ignored
and removed rather than partially trusted.

Adding the same user again replaces that user's retained session. The client
attempts to revoke the previous token before discarding it; failure does not
block use of the new session because the old token will still expire according
to server policy.

## Application ownership and boundaries

The following focused modules own the feature:

```text
features/auth/
├── accountSessionStore.ts
├── useAccountSessions.ts
├── AccountChooser.tsx
├── AddAccountDialog.tsx
└── AuthForm.tsx

features/account/
└── AccountSwitcher.tsx

features/markdown/
└── DocumentSaveCoordinator.tsx
```

- `accountSessionStore.ts` owns serialization, validation, legacy migration,
  server scoping, and pure registry updates.
- `useAccountSessions.ts` owns the active identity and add, validate, switch,
  and sign-out operations.
- `AuthForm.tsx` contains the existing sign-in/register form behavior used by
  both the full authentication screen and add-account dialog.
- `AccountChooser.tsx` handles the no-active-identity state without selecting a
  different user implicitly.
- `AccountSwitcher.tsx` renders the sidebar popover and delegates identity
  operations to callbacks.
- `DocumentSaveCoordinator.tsx` lets a mounted Markdown editor register a save
  barrier that account transitions can await.
- `App.tsx` remains the identity boundary. It clears account-scoped query data
  before committing a different active token.

The server needs no new endpoint, schema, or migration. Login, registration,
session validation, logout, and session expiry retain their current meaning.

## Identity transition flow

Switching follows one ordered transition:

```text
Select retained account
→ lock account controls
→ flush mounted Markdown documents
→ validate target with /api/session
→ clear the previous identity's TanStack Query cache
→ persist the new active user and last-used time
→ mount WorkspaceShell with the new token and user
```

Only a successful transition changes `last_used_at`. WorkspaceShell remounts
at the identity boundary so local task, project, dialog, and selection state
cannot carry into another account.

The application validates only the active session during startup. Other
sessions are validated when selected. If the active token is unauthorized or
expired, Kanleaf removes that entry and shows the account chooser instead of
silently acting as another retained user. Network failures do not remove a
session because they do not prove invalidity.

Signing out the active account uses the same Markdown barrier, calls the
existing logout endpoint, removes only that local entry, clears account-scoped
queries, and shows the chooser when other entries remain. Signing out all
accounts saves the current document once, attempts all logout requests, then
clears the server's registry even if the server is offline.

## Markdown transition barrier

The loaded Markdown editor registers an async flush operation while mounted.
The coordinator supports more than one registration but does not introduce
collaboration or background document management. A flush saves the latest
source with the editor's current revision and waits for the existing save chain
to settle.

If a save fails or detects a revision conflict, the coordinator rejects the
identity transition. The active editor stays mounted and exposes actions to:

- retry the save;
- copy the local Markdown source;
- discard local content by reloading the server version.

The newly authenticated account is still retained if adding it succeeded but
the transition was blocked. The current account remains active until the user
resolves the document and selects the new account again.

## Account switcher UX

The account row at the bottom of the expanded sidebar becomes the trigger for
an upward-opening popover. The separate three-dot account menu is removed. The
trigger shows the current avatar monogram, display name, email, and chevron.

The popover is approximately 286 pixels wide to match the workspace switcher
and contains:

1. the active account summary;
2. retained account rows with monogram, display name, email, and an active
   checkmark;
3. `Add another account`;
4. `Account settings`;
5. `Sign out this account`;
6. `Sign out all accounts` when at least two accounts are retained.

Selecting another row shows `Saving and switching…` and disables repeated
identity actions until the transition finishes. Long names and emails truncate
visually while preserving their full accessible name or title.

`Add another account` opens a modal dialog over the current workspace. It uses
the same sign-in/new-account modes and validation as the full authentication
screen. Closing the dialog leaves the current session untouched.

When no identity is active but retained accounts remain, a compact chooser
shows the Kanleaf wordmark, available accounts, and `Use another account`.
Choosing an invalid retained session removes it and reports `Session expired`.
When no accounts remain, Kanleaf renders the existing full authentication
screen.

Popover and dialog interactions support Escape, keyboard navigation, visible
focus, outside-click dismissal where safe, and focus restoration. The collapsed
sidebar keeps only the navigation reopen control; users reopen the sidebar to
reach account switching.

## Error handling

- A Markdown error or conflict blocks transition and keeps the current editor.
- A target `401 Unauthorized` removes only the selected target session.
- A network error retains both sessions and offers retry.
- A failed logout request never prevents local sign-out.
- Corrupt local registry data falls back to legacy-token migration or normal
  authentication.
- Storage write failures keep the in-memory session usable for the current run
  and surface that account retention is unavailable.
- Account actions remain disabled for the duration of one transition so two
  token changes cannot race.

## Security considerations

Bearer tokens remain sensitive. The registry does not log them, expose them in
UI, include them in error messages, or send them anywhere except the configured
Kanleaf server. Tokens cannot be replaced by hashes on the client because the
raw value is required for bearer authentication. Markdown preview continues to
disable raw HTML, reducing the most direct stored-content XSS path.

Every server request still authorizes the selected token independently. Client
metadata, active IDs, and cache state do not grant access. Clearing the query
cache at the identity boundary prevents data fetched for one user from briefly
appearing under another user on a shared workspace.

## Testing

Unit and component coverage will include:

- registry serialization, malformed data, server isolation, legacy migration,
  duplicate-user replacement, and ordering;
- adding, validating, switching, expiring, signing out one account, and signing
  out all accounts;
- query-cache clearing only at a committed identity change;
- successful Markdown flush and blocked transitions for save error/conflict;
- sign-in/register form reuse;
- account popover keyboard, outside-click, focus, long-content, loading, and
  error behavior;
- chooser behavior without implicit identity fallback.

Playwright will cover two accounts with distinct Personal workspaces, adding
and switching accounts, saving Markdown before a switch, reloading with the
retained registry, switching back, and confirming that account-specific data
does not cross the identity boundary.

Existing TypeScript, ESLint, Prettier, Vitest, production build, and core E2E
checks remain required before the capability commit.
