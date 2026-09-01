# Account Onboarding and Workspace Lifecycle Design

## Summary

Kanleaf will stop creating a Personal Workspace during account registration.
New accounts instead enter a durable, routed **Set up Kanleaf** flow for account
details, first Workspace creation or invitation acceptance, and optional member
invitations.

Workspaces gain a globally unique public `identifier` used in browser URLs. The
existing UUID remains the internal identity used by authorization, API paths,
query keys, PostgreSQL relationships, portability operations, and vault
directories. Canonical Workspace URLs change from `/w/<uuid>/...` to
`/<identifier>/...`, with membership-aware redirects for old URLs.

The Host Console gains an intentionally narrow destructive capability: the
deployment Host may permanently delete a Workspace after a two-stage warning,
typing the Workspace identifier, and re-entering the Host password. Host status
still grants no ability to open or read Workspace content.

## Goals

- Register an account and session without creating Workspace data.
- Resume account setup at the correct step after refresh, sign-in, account
  switching, or another client opening the same account.
- Collect a required display name and optional synchronized preferences before
  the first Workspace decision.
- Let a user create a first Workspace or accept an existing invitation without
  entering the normal Workspace shell first.
- Require a name and globally unique, user-editable Workspace identifier at
  creation time; Workspace names may repeat.
- Lead every interactive Workspace creation into an optional invitation step.
- Use short, human-readable Workspace URLs while retaining UUIDs at security and
  persistence boundaries.
- Preserve old `/w/<uuid>/...` bookmarks when the authenticated account still
  belongs to that Workspace.
- Let only the configured Host permanently delete another user's Workspace,
  including its PostgreSQL records and managed Markdown vault.
- Preserve Kanleaf's restrained, keyboard-accessible desktop visual language.

## Non-goals

- Email verification, password recovery, social login, or organization domains.
- Public Workspace discovery or joining without an invitation.
- Replacing Workspace UUIDs in API paths, foreign keys, query keys, exports, or
  vault paths.
- Mutable Workspace identifiers after creation. Identifier rename and redirect
  history require a separate design.
- Giving the Host Workspace membership, impersonation, content browsing, Task
  access, Library access, or arbitrary filesystem access.
- Bulk Host deletion or user deletion.
- Changing Project identifiers.
- Adding a routing, form, state-machine, slug, or dialog dependency.

## Considered approaches

### Selected: explicit setup state plus a separate public identifier

PostgreSQL stores a small setup state on each user and a separate unique
identifier on each Workspace. The UI resolves a route identifier through the
authenticated Workspace list, then continues using the Workspace UUID
internally.

This preserves existing authorization and vault boundaries, survives refreshes,
and distinguishes a genuinely new account from an established account that
later has no Workspace.

### Rejected: infer onboarding from `active_workspace_id` or membership count

An established account can lose, leave, or have its final Workspace deleted.
Inference would incorrectly replay profile setup, cannot resume the intermediate
invite step, and behaves inconsistently across clients.

### Rejected: replace Workspace UUIDs with identifiers everywhere

That would spread a mutable human-facing concept through foreign keys, every API
handler, authorization checks, cache keys, import/export remapping, recovery,
and vault paths. It provides no product benefit beyond the browser URL and
creates a much larger migration and security surface.

## Persistent model

One ordered migration adds `users.setup_stage` with these values:

- `account`: collect the required display name and optional preferences;
- `workspace`: create a first Workspace or accept an invitation;
- `invite`: a first Workspace was created and member invitation is optional;
- `complete`: normal application behavior.

Existing users are backfilled to `complete`. The column default for new users
is `account`. Registration returns `active_workspace_id: null` and
`setup_stage: "account"`.

The same migration adds a lifetime identifier registry and
`workspaces.identifier`:

- stored in canonical lowercase ASCII;
- 2–48 characters;
- starts and ends with a letter or number;
- contains only letters, numbers, and single hyphen-separated runs;
- globally unique and never reused after a Workspace is deleted;
- excludes reserved top-level names `api`, `assets`, `host`, `setup`, and `w`.

`workspace_identifier_registry` owns the identifier independently of the live
Workspace row. An active entry points at one Workspace UUID; deletion retires
the entry instead of freeing the name. This prevents a durable URL, browser
history entry, or notification for a deleted Workspace from later resolving to
an unrelated Workspace that reused the same identifier.

Existing Workspaces receive a deterministic readable base plus the full
dashless Workspace UUID suffix. The readable base is truncated so the complete
identifier remains within 48 characters. This guarantees collision-free
backfill without assuming old names are unique or ASCII. The UUID remains
`workspaces.id`. Names remain non-unique.

`WorkspaceResponse`, Host Workspace metadata, and the frontend `Workspace` type
add `identifier`. `UserResponse` adds `setup_stage`.

Workspace identifiers are immutable after creation in this capability.
Workspace General Settings displays the identifier read-only so users can copy
and distinguish it, but the update endpoint does not accept it.

Every Workspace creation path, including archive import and backward-compatible
non-UI callers, allocates through the registry in the same database transaction
as the Workspace. Import never adopts an identifier from an archive. An omitted
identifier receives a deterministic server candidate derived from the new UUID;
interactive clients always submit the reviewed identifier. A retired identifier
returns the same conflict as an active one and is not disclosed as historical.

## Registration and setup transitions

Registration remains atomic for the user, password hash, session, and instance
access policy check. It no longer allocates a Workspace UUID, task vocabulary,
membership, vault, projection job, or active Workspace.

The account setup endpoint accepts:

- required `display_name`;
- optional `theme`, `timezone`, `week_start`, and `date_format`.

It validates through the same domain and preference rules used by Account
Settings, updates the supplied values atomically, and advances `account` to
`workspace`. A retry is idempotent and never moves a later stage backward.
Choosing **Use default preferences** sends only the display name and keeps the
server defaults. Choosing **Continue** sends the displayed preference values.

Creating a Workspace while the actor is in `workspace` advances them to
`invite` in the same transaction that installs default task configuration,
creates Owner membership, and sets the active Workspace. Creation while the
actor is already `complete` leaves setup state unchanged.

Accepting an invitation while in `workspace` or `invite` sets that Workspace as
active and completes setup in the same transaction as membership acceptance.
Normal invitation acceptance for an established account also makes the joined
Workspace active, so token acceptance has one deterministic destination.

Completing or skipping the invite step advances `invite` to `complete` only
when the user still has a Workspace membership. The configured Host may finish
from the `workspace` step without membership and continue directly to the Host
Console; Host administration does not require a personal Workspace.

If a first Workspace disappears during the invite step, the setup screen offers
Create/Join again. Creating another Workspace retains/returns to `invite`, and
accepting an invitation completes setup. No client-only state is needed for
recovery.

## Routed setup experience

The canonical setup routes are:

| URL                | Stage       | Surface                              |
| ------------------ | ----------- | ------------------------------------ |
| `/setup/account`   | `account`   | Display name and preferences         |
| `/setup/workspace` | `workspace` | Create or join the first Workspace   |
| `/setup/invite`    | `invite`    | Invite members or skip for now       |

The authenticated route boundary compares the current server-owned stage with
the requested setup URL and replaces mismatches with the canonical route. A
completed account cannot reopen setup by typing its URL. Back cannot return to
a completed setup step.

The UI calls the setup endpoint, Workspace/invitation endpoints, then refreshes
the canonical session query. The refreshed `setup_stage` drives the next route;
components do not maintain a second durable wizard state.

### Set up your account

Display name is required and has no Skip. Theme, timezone, week start, and date
format use the existing synchronized preference choices. The screen provides:

- **Continue** to save the shown preferences;
- **Use default preferences** to save only the required display name.

Both actions advance to Workspace setup. Validation remains associated with the
relevant field and preserves the draft after failure.

### Choose your first Workspace

A restrained mode switch selects **Create a Workspace** or **Join a
Workspace**.

Create contains Workspace name and Workspace ID. The identifier follows the
normalized name until the user edits it directly. Manual editing stops automatic
replacement; **Reset from name** restores it. A quiet URL preview shows the
result, such as `/kanleaf-core/my-work`.

Client suggestion normalization uses Unicode decomposition, removes combining
marks, maps Vietnamese `đ`/`Đ` to `d`, lowercases, replaces punctuation and
space runs with hyphens, collapses/trims hyphens, and limits to 48 characters.
The server does not trust that suggestion and validates the final identifier.
A global uniqueness conflict stays inline beside Workspace ID without clearing
either field.

Join reuses pending exact-email invitations and invitation-token acceptance.
It supports loading, empty, error, retry, accept, decline, and token failure
states without requiring a Workspace-scoped Settings route.

There is no Skip for a normal account because the product has no usable tenant
scope. Sign out remains available. A Host additionally sees **Continue to Host
Console**, which completes setup without creating a Workspace.

### Invite your team

After first Workspace creation, the screen shows its name and identifier plus a
compact email/role invitation composer. Issued tokens remain visible once, using
the existing copy pattern. Sending zero invitations is valid.

- **Finish setup** completes onboarding after one or more invite attempts.
- **Skip for now** completes it immediately.

Both use replacement navigation into the new Workspace's My Work route so Back
does not reopen setup.

## Workspace creation outside initial setup

The Workspace switcher replaces its inline name-only composer with a focused
native dialog:

1. required name and identifier;
2. optional member invitation.

The existing document-save coordinator and latest-intent-wins Workspace queue
remain authoritative. The Workspace is created only after pending Markdown is
flushed. After creation the dialog stays on the invitation step; **Done** or
**Skip invitations** navigates to the new Workspace. Cancel is available only
before creation, because the invitation step does not imply rollback.

The zero-Workspace recovery surface for an established account reuses the same
Create/Join controls. It does not repeat profile setup.

Invitation composition is shared between setup, Workspace creation, and
Workspace Invitation Settings only at the actual repeated form/issued-token
boundary. Invitation history stays in Settings. No generic wizard framework is
introduced.

## Password fields

Registration adds a required **Confirm password** field. The browser blocks the
request and associates an inline error when the values differ; confirmation is
never sent to the server.

All sign-in and registration password fields gain an icon-only Eye/EyeOff
control with a dynamic accessible name, `aria-pressed`, and `type="button"`.
Each field controls its own visibility without changing its value or
autocomplete purpose. A small shared PasswordField primitive is justified by
authentication and Host deletion reauthentication; it does not own form state.

## Public Workspace route contract

Canonical routes replace the `/w/:workspaceId` prefix with one top-level public
identifier:

```text
/:workspaceIdentifier/my-work
/:workspaceIdentifier/inbox
/:workspaceIdentifier/tasks
/:workspaceIdentifier/views/:viewId
/:workspaceIdentifier/library/:documentId?
/:workspaceIdentifier/projects/:projectId/...
/:workspaceIdentifier/settings/...
```

Static `/host` and `/setup` routes rank ahead of the Workspace family, and the
database rejects their reserved identifiers.

The route screen loads the authenticated Workspace list before mounting a
scoped surface, resolves `workspaceIdentifier` to the Workspace UUID, and then
constructs the existing typed internal `WorkspaceLocation`. Every API request,
access check, cache key, active Workspace update, notification target,
portability operation, and vault lookup continues using UUID.

URL serialization receives the matching public identifier from the Workspace
list. It never falls back to exposing the UUID in a canonical URL. Unknown or
unauthorized identifiers resolve through the existing non-disclosing root
fallback only after the list query settles.

Legacy `/w/:workspaceUuid/*` routes remain temporary compatibility redirects.
They resolve only through the current account's Workspace list and replace the
URL with the matching identifier while preserving the remaining path, query,
and hash. Missing or unauthorized UUIDs replace to `/`.

Workspace switchers show the identifier as subdued metadata where duplicate
names would otherwise be ambiguous.

## Host Workspace deletion

`GET /api/host/workspaces` continues exposing only:

- Workspace UUID, name, identifier, and creation time;
- Owner UUID, display name, and email.

It still exposes no membership list, Task/Project/Library metadata, paths,
counts, or content.

`DELETE /api/host/workspaces/:workspaceUuid` requires a Host-authenticated
session plus JSON containing the exact Workspace identifier and current Host
password. The handler rechecks Host identity, loads only confirmation metadata
and the Host password hash, validates both confirmations, then calls the same
permanent Workspace deletion use case as Owner deletion. A non-Host receives
`403`; a mismatched identifier or password receives `422` without changing
database or vault state.

The Host Console table adds a narrow Actions column. Delete opens a native
dialog with two explicit stages:

1. identify Workspace and Owner and explain that structured records, members,
   Tasks, Projects, Library notes, and Markdown will be removed;
2. require the exact public identifier and Host password before enabling
   **Permanently delete Workspace**.

Step two supports Back and Cancel. Busy state prevents Escape, outside-click,
or duplicate submission. Failure keeps the dialog open, clears the password,
and preserves the identifier draft. Success invalidates only Host Workspace
metadata and announces removal.

## Database and vault deletion boundary

Permanent Owner and Host deletion share one implementation after their distinct
authorization and confirmation checks.

The use case:

1. starts a transaction and locks the Workspace row;
2. records a durable deletion manifest containing only typed Workspace and
   export-artifact identifiers;
3. renames the typed Workspace UUID directory into internal Workspace trash;
4. retires the public Workspace identifier;
5. updates affected users' active Workspace to another membership or `NULL`;
6. deletes the Workspace row, relying on reviewed `ON DELETE CASCADE`
   constraints for all Workspace-owned structured records;
7. commits PostgreSQL;
8. purges the renamed directory and any export artifacts owned by the deleted
   Workspace, then removes the deletion manifest.

If a database operation fails, the vault is restored before returning. Internal
Workspace trash lives beneath the persisted vault mount so the rename stays on
one filesystem in the supported Compose topology. Trash names contain only
validated UUIDs.

The manifest and Workspace trash live beneath the persisted vault mount. Export
artifacts may live elsewhere under the configured data directory, but their
typed staging UUIDs remain in the manifest after database cascades remove the
operation rows. Import staging is removed at activation and does not carry a
Workspace foreign key; startup import recovery remains its owner.

Startup reconciles interrupted Workspace deletions before serving requests:

- if PostgreSQL still contains the Workspace, restore a missing live directory
  and remove the uncommitted manifest without touching export artifacts;
- if PostgreSQL no longer contains it, purge the trash directory and listed
  export artifacts, then remove the committed manifest.

This covers a process crash between rename, commit, and purge. It does not make
PostgreSQL and the filesystem atomic, but it gives both returned-error
compensation and restart recovery. Other previously documented Compose topology
gaps remain outside this feature.

## Accessibility and visual direction

Set up Kanleaf extends the existing warm split onboarding surface. A narrow
left rail contains Wordmark and a semantic ordered progress spine; the right
side contains one focused form up to approximately 620px. This is a sequence,
so numbered progress has real meaning. At narrow widths the rail becomes a
compact horizontal header and forms remain one column.

The visual signature is the quiet vertical progress spine, not decorative
cards, gradients, or oversized marketing copy. Existing typography, colors,
spacing, inputs, Select, buttons, issued-token, error, and danger tokens remain
the source of truth.

- One `h1` and `aria-current="step"` identify each setup screen.
- Labels, descriptions, validation messages, and `aria-invalid` stay linked.
- Icon-only password and delete controls have specific accessible names.
- Dialog focus moves to the new stage and restores to the trigger on close.
- Cancel is the safe initial action for destructive confirmation.
- Loading, empty, error, retry, busy, duplicate, and success states retain
  stable layout and visible focus.
- Light, dark, system, 960×640, wide, and existing narrow Host/Workspace states
  remain supported; reduced motion is respected.

## Testing

### Backend

- Registration creates only user/session rows and returns setup stage `account`.
- Existing migration rows become `complete`; new rows default to `account`.
- Account setup validates, updates atomically, supports default preference skip,
  and never regresses a later stage.
- Workspace identifiers validate reserved/invalid forms, are globally unique,
  and cannot be reused after retirement while names may duplicate.
- Workspace creation updates active Workspace and the correct setup transition.
- Invitation acceptance completes first-Workspace setup and activates the
  joined Workspace.
- Normal users cannot finish setup without membership; Host can.
- Host deletion rejects unauthenticated, non-Host, wrong identifier, and wrong
  password requests.
- Successful Host deletion removes Workspace-owned rows and all Task/Library
  Markdown while leaving unrelated Workspaces intact.
- Workspace deletion manifests compensate database failure and startup recovery
  restores or purges vault trash and derived export artifacts for each crash
  state.

### Frontend

- Registration confirmation mismatch never sends a request.
- Every password visibility control has correct type, name, pressed state, and
  preserves its value.
- Server setup stage owns direct links, refresh, account switching, and
  completion redirects.
- Account setup handles required display name, preference save/default skip,
  validation, and theme update.
- Workspace ID normalization follows name until manual edit, can reset, rejects
  reserved/invalid values, and preserves a server conflict draft.
- Create/Join handles invitation loading/error/empty/accept/token states.
- First and later Workspace creation both show invitation step and retain the
  save/transition guarantees.
- Route builders emit public identifiers; route resolution never sends a slug
  to a UUID API; old routes preserve suffix/query/hash.
- Host delete dialog covers warning, Back, Cancel, exact identifier, password,
  busy, error, and success.

### Browser and deployment

- Core E2E covers register with password confirmation, account setup, first
  Workspace identifier, invite skip, canonical URL, refresh, and account
  switching.
- Self-host E2E covers direct public-identifier routes, legacy redirect, Host
  authorization, and Host deletion of another user's populated Workspace.
- Container verification exercises Workspace trash rename on the actual mount
  topology rather than relying only on a Compose parse.

## Documentation impact

Current README and architecture documentation must stop claiming registration
creates Personal Workspace state, describe setup stages and public identifiers,
and record the narrow Host deletion authority. The project-local frontend,
backend, and product UI skills must remove the stale “read-only Host Workspace
list” invariant while retaining the no-content-access boundary. Historical
dated specs remain unchanged and are superseded by this design where they
conflict.

## Definition of done

- All nine requested behaviors are implemented through server-authoritative,
  tested boundaries.
- No Personal Workspace is created by registration.
- Setup resumes correctly and optional stages have deliberate Skip behavior.
- Workspace names may repeat and identifiers cannot collide or be reused.
- Canonical browser URLs expose the identifier, not the Workspace UUID; old
  links redirect safely.
- Host deletion requires two UI stages, typed identifier, password, server Host
  authorization, full relational deletion, vault trash-first cleanup, and
  restart recovery.
- Relevant frontend, backend, E2E, Tauri, and container checks have fresh
  passing evidence, the rendered UI is inspected, documentation is current,
  and the final diff contains no unrelated changes.
