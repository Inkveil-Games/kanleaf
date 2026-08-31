# Host Console and Restricted Access Design

## Summary

Kanleaf will add an instance-level **Host Console** at `/host`. It is separate
from Workspace administration and is available only to the authenticated
account whose normalized email matches `KANLEAF_HOST_EMAIL`.

The first release has two surfaces:

- a read-only list of every Workspace and its Owner;
- an instance access policy that switches between Open and Restricted access
  and stores the exact email addresses permitted to register, sign in, and
  keep active sessions.

The Host account is always permitted so the Host cannot remove their own
access. No Host capability grants Workspace membership or access to Tasks,
Library documents, Markdown vaults, or filesystem paths.

## Goals

- Give one deployment-configured Host a clear instance administration surface.
- Show the Host every current Workspace with its Owner name and email.
- Let the Host enable or disable exact-email access restrictions without
  editing deployment files or restarting Kanleaf.
- Enforce Restricted access consistently for registration, login, and existing
  sessions.
- Reuse the existing Settings layout, controls, API boundary, auth extractor,
  email value type, and PostgreSQL transaction patterns.
- Preserve existing deployments by defaulting to Open access and treating an
  unset Host email as a disabled Host Console.

## Non-goals

- Managing, opening, deleting, or impersonating a Workspace from Host Console.
- Granting the Host implicit Workspace or Project membership.
- Multiple instance administrators, delegated Host roles, or Host transfer UI.
- Domain allowlists, wildcard matching, invitation-based bypasses, or SMTP.
- Email ownership verification, password reset, two-factor authentication, or
  a first-run setup wizard.
- Metrics, usage charts, audit logs, user management, or a card-based dashboard.
- Replacing the existing bearer-token authentication model or adding a routing
  dependency to the desktop client.

## Terminology and navigation

- Product name: **Host Console**.
- Browser route: `/host`.
- API prefix: `/api/host`.
- Policy label: **Restricted access**.
- Policy states: **Open** and **Restricted**.

Host Console is an instance surface, so its entry belongs in the account menu,
not Workspace navigation. The entry is rendered only when the current session
reports `is_host: true`. Direct navigation remains protected independently of
whether the entry is visible.

## Host identity and configuration

`KANLEAF_HOST_EMAIL` is the only deployment-configured Host identity. The
server parses it with the existing `NormalizedEmail` rules:

- unset or blank: Kanleaf starts normally, reports `is_host: false` for every
  account, and rejects Host API requests;
- valid non-empty email: its normalized value is held in application state;
- invalid non-empty email: startup fails with a configuration error.

The variable is optional for backward-compatible rollout. Both environment
examples document it, and self-host Compose explicitly passes it into the
Kanleaf container:

```dotenv
KANLEAF_HOST_EMAIL=
```

The configured email is not a secret, but the API does not return it. Session
and auth responses expose only the derived boolean `is_host`. Every Host API
handler repeats authorization on the server by comparing the authenticated
user's database email with the normalized configured Host email.

Changing `KANLEAF_HOST_EMAIL` transfers Host Console access after the Kanleaf
container restarts. It does not create an account, modify Workspace membership,
or grant the former Host continued instance access.

## Persistence

An additive migration `0017_instance_access.sql` adds instance-scoped state to
PostgreSQL. It does not enter Workspace portable configuration or export data.

### `instance_settings`

```text
id                 SMALLINT PRIMARY KEY, fixed to 1
restricted_access  BOOLEAN NOT NULL DEFAULT FALSE
updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
```

The migration inserts the singleton row with Open access. A check constraint
keeps `id = 1`.

### `instance_allowed_emails`

```text
email       TEXT PRIMARY KEY
created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
```

The email constraint matches `users.email`: lowercased, trimmed, and between 3
and 320 characters. Emails are not foreign keys to users because the Host must
be able to approve an address before that account exists.

Allowlist rows remain stored while access is Open. This lets the Host prepare a
list before enabling restriction and disable/re-enable the policy without
re-entering addresses.

## Authorization boundary

A small `HostUser` extractor wraps `AuthenticatedUser` and requires the current
user's normalized database email to match the configured Host email. It is the
required extractor for every `/api/host/*` handler.

The response rules are:

- missing, malformed, expired, revoked, or policy-invalid bearer token: `401`;
- valid authenticated non-Host account: `403`;
- Host account: continue to the handler.

Host queries may cross Workspace metadata boundaries only where explicitly
defined by this feature. They never reuse or weaken `/api/workspaces`, which
continues to list only Workspaces visible through membership.

## Access policy semantics

### Open access

Registration, login, and session authentication retain their current behavior.
Stored allowlist entries have no effect.

### Restricted access

An account is eligible when either:

- its normalized email is in `instance_allowed_emails`; or
- its normalized email matches `KANLEAF_HOST_EMAIL`.

The Host exemption prevents self-lockout and permits Host registration during
bootstrap. Workspace invitations do not bypass the instance policy; an invitee
must also be allowed by the Host.

Registration checks eligibility before inserting a user, Personal Workspace,
membership, or session. A rejected registration returns:

```json
{
  "error": {
    "code": "access_restricted",
    "message": "Access to this Kanleaf host is restricted. Contact the host administrator."
  }
}
```

with HTTP `403` and no partial records.

Login retains the current missing-user and password timing protections. It
verifies credentials before applying the access policy. Invalid credentials
still return the existing generic `401`; correct credentials for a disallowed
email return `403 access_restricted`.

Every authenticated request also checks the current policy. After a policy
change commits, a disallowed existing token receives `401`, causing the client
to discard the session and return to authentication. Requests already in
flight when the policy commits may finish, but no later request may pass.

## Transaction and concurrency rules

Registration and login read and lock the singleton settings row inside the same
transaction that would create their user or session. Host policy updates take
the corresponding exclusive lock. This serializes a policy change against new
accounts and sessions.

`PUT /api/host/access` performs one atomic transaction:

1. lock the singleton settings row;
2. update `restricted_access`;
3. replace the allowlist with normalized, deduplicated input;
4. when Restricted, delete sessions belonging to disallowed users except the
   configured Host;
5. commit and return the canonical policy.

All email values are validated before writes begin. One invalid email rejects
the whole request with `422 validation_error`. No partial allowlist or session
revocation is committed.

The authenticated-user lookup also applies the current policy, covering stale
tokens, an environment Host change, and defensive enforcement if cleanup was
interrupted.

## API

### `GET /api/host/workspaces`

Returns every Workspace ordered by creation time and ID:

```json
[
  {
    "id": "workspace-uuid",
    "name": "Personal",
    "created_at": "2026-09-01T00:00:00Z",
    "owner": {
      "id": "user-uuid",
      "display_name": "Quang",
      "email": "quang@example.com"
    }
  }
]
```

The query joins `workspaces` to the single `workspace_memberships.role =
'owner'` row and then to `users`. It returns no membership list, task counts,
vault information, session data, password hashes, or filesystem paths.

### `GET /api/host/access`

Returns the canonical policy:

```json
{
  "restricted": false,
  "allowed_emails": ["member@example.com"]
}
```

Emails are sorted for stable rendering.

### `PUT /api/host/access`

Accepts a complete replacement:

```json
{
  "restricted": true,
  "allowed_emails": ["member@example.com", "owner@example.com"]
}
```

The server trims, normalizes, validates, and deduplicates every address. A full
replacement keeps the API and UI smaller than per-address mutation endpoints;
there is only one Host writer in this release.

## Client routing and session shape

`User` gains an `is_host` boolean in registration, login, and session
responses. It is recalculated from server configuration rather than persisted
on the user row.

The application adds a small pathname/History API boundary in `App.tsx`:

- `/host` renders Host Console after normal health and session restoration;
- `/` and existing paths render the Workspace shell;
- History navigation updates the active surface without a new router package;
- the server's existing SPA fallback supports direct browser loads of `/host`.

The static `/host` HTML remains public because bearer authentication happens
after the client loads. It contains no Host data. An unauthenticated visitor
sees the normal sign-in flow, a non-Host account sees `Host access required`,
and all data requests remain protected by Host API authorization.

The account menu displays a `Host Console` item only for `is_host: true`. The
Host Console provides `Back to Workspace`. Switching to a retained non-Host
account while on `/host` renders the denied state rather than stale Host data.

## Host Console interface

Host Console is a full-page Settings surface, not a modal. It reuses the
existing `SettingsFrame`, `SettingsArticle`, `SettingsLink`, form action,
loading/error, account-menu, and API request patterns. Private Settings frame
primitives may be exported for reuse rather than duplicated.

The 205-pixel navigation rail contains:

- **Workspaces**
- **Access**

It uses existing canvas/surface colors, typography, separators, control sizes,
focus styles, and dark-theme tokens. It adds no dashboard cards, large metrics,
special administrator palette, or new UI dependency.

### Workspaces

The content is a semantic, compact table with `Workspace` and `Owner` columns.
Owner cells show both display name and email. Rows have subtle separators and
no navigation or action menu. Loading uses row-shaped placeholders; empty and
error states follow existing Settings patterns and provide one retry action.

### Access policy

The section contains:

- a native checkbox row labeled `Restricted access`;
- visible `Open` or `Restricted` status text, not color alone;
- explanatory copy that restriction applies to registration, login, and active
  sessions;
- an `Approved emails` textarea with one exact email per line;
- a note that the Host account is always permitted;
- an explicit `Save access policy` action and accessible success/error status.

There is no autosave. Saving a Restricted policy requires confirmation that
accounts outside the submitted list will be signed out immediately. A failed
save preserves the draft so the Host can correct it.

## Error handling

- Host APIs return the existing structured JSON envelope.
- Access denial uses the dedicated `access_restricted` code only for public
  registration/login policy failures.
- Invalid Host policy input returns `422` without partial writes.
- Revoked or policy-invalid sessions return `401` so existing account-session
  handling removes the local token.
- Internal database errors return the generic `500` response and are logged
  without exposing SQL, Host configuration, or stored emails beyond the
  submitted validation error.
- Workspace list failures do not fall back to membership-scoped data.

## Deployment and compatibility

The migration default is Open, `KANLEAF_HOST_EMAIL` is optional, and old clients
ignore the additive `is_host` field. Existing accounts and sessions therefore
continue working after an automatic image update.

The Pi update timer pulls only the published image; it does not update the
checked-out Compose file. This release consequently needs one manual deployment
refresh:

1. pull the `dev` branch so Compose passes `KANLEAF_HOST_EMAIL`;
2. add the Host email to the ignored self-host `.env`;
3. recreate the Kanleaf service;
4. sign in with that account and configure `/host`.

Later image-only updates continue through the existing timer.

Rolling back to a binary that predates this feature while Restricted access is
enabled makes the old binary ignore the policy tables and reopen access. The
self-host documentation must call out this security-sensitive rollback rule.

If the Host email is removed from the environment after a Restricted policy was
saved, allowlisted users remain eligible but nobody can open Host Console until
the deployment restores a valid Host email.

## Bootstrap limitation

Kanleaf does not verify ownership of email addresses. The configured Host email
is always eligible to register, so an operator must create the Host account on a
trusted network before exposing the server. This matches the current LAN-only
self-host posture. Email verification or a one-time bootstrap secret is a later
security capability if public deployment becomes supported.

## Verification

### Rust and PostgreSQL

- configuration tests cover missing, blank, normalized, and invalid Host email;
- schema tests cover the singleton default, email normalization constraint, and
  unique allowlist;
- Open mode preserves current registration, login, and session behavior;
- Restricted mode permits allowlisted and Host emails and rejects other
  registrations without creating user, Workspace, membership, or session rows;
- correct credentials for a disallowed account return `403`, while invalid
  credentials retain generic `401` behavior;
- enabling restriction or removing an email invalidates its sessions;
- one invalid submitted email rolls back the entire policy update;
- unauthenticated and non-Host callers cannot use any Host endpoint;
- the Host workspace query returns all and only the intended Owner metadata;
- Host access does not authorize Workspace, Task, Library, or vault operations.

### React and Vitest

- Host Console navigation appears only for a Host session;
- `/host` restores authentication and rejects a non-Host account;
- Workspace loading, empty, failure, retry, and populated states render with
  semantic table markup;
- Access policy loading, editing, confirmation, canonical payload, success,
  failure, and preserved-draft behavior are covered;
- a policy-invalid `401` follows the existing account-session cleanup flow;
- controls have labels, visible focus, keyboard operation, `role="alert"` for
  failures, and `role="status"` for success.

### End to end and visual review

The self-host workflow verifies that a Host can open `/host`, see Workspaces,
enable Restricted access, reject an unlisted registration and login, admit an
allowed account, and sign out an active account after its email is removed.
The policy is restored at the end of the isolated test.

Host Console is visually reviewed at representative wide and minimum desktop
sizes in both light and dark themes. The review checks dense rows, long
Workspace names, long Owner emails, empty/error states, keyboard focus, and the
confirmation flow.

## Acceptance criteria

- Only the deployment-configured Host can retrieve or change instance data.
- The Host can see every Workspace name and Owner identity without gaining
  Workspace content access.
- Restricted access gates registration, login, and subsequent authenticated
  requests using exact normalized emails.
- Saving a stricter policy signs disallowed sessions out after commit.
- Open access exactly preserves existing authentication behavior.
- Host Console matches the restrained existing Settings visual language and is
  usable by keyboard in both themes.
- Existing self-host deployments continue starting before they opt into a Host
  email.
- Documentation explains configuration, one-time Pi rollout, invitation
  interaction, bootstrap risk, and rollback behavior.
