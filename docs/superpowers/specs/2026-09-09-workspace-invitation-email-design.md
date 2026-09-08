# Workspace invitation email design

## Scope

Add optional SMTP delivery and a direct browser acceptance flow only for
Workspace invitations. Existing invitation persistence, SHA-256 token digests,
in-app notifications, token acceptance, renewal, revocation, and manual token
sharing remain authoritative. This change does not add task email, preferences,
a queue, or another service.

## Mail boundary and configuration

The Rust server owns SMTP. A small `mail` module builds Workspace invitation
messages behind a transport trait. Production uses Lettre's asynchronous Tokio
SMTP transport with Rustls; tests use capturing and failing transports; disabled
mail has no transport and performs no network work.

`KANLEAF_PUBLIC_URL` is optional while mail is disabled. A missing or blank
`KANLEAF_SMTP_HOST` disables SMTP even if other SMTP variables are present. Once
the host is non-empty, startup requires a valid public HTTP(S) URL, port,
security mode, sender address, and either both SMTP username/password or neither.
`starttls` is the default, `tls` enables implicit TLS, and explicit `none` is
available only for trusted local development without credentials. Invalid
enabled configuration fails before the listener binds without including secrets
in the error.

Invitation creation and renewal return an additive delivery status (`sent`,
`failed`, or `disabled`) plus an optional full invitation URL. A public URL can
therefore improve manual sharing even when SMTP is disabled.

## Invitation lifecycle

Creation continues to authenticate and authorize the Workspace administrator,
validate input, generate a raw token and digest, insert the invitation, add the
existing in-app notification when an account exists, and commit. Only after the
commit does the handler build and send email. Runtime delivery failure is logged
using invitation and Workspace IDs only and does not invalidate or delete the
invitation.

Renewal rotates the digest transactionally, commits it, and then sends the new
raw token. The old token remains invalid even if SMTP fails. Revocation never
sends mail. PostgreSQL continues to store only the digest; the raw token appears
only in the one-time API response, acceptance request, and URL fragment.

Messages are multipart plain text and escaped HTML. Their configured sender,
recipient, inviter name, Workspace name, role, expiry, and direct URL are built
before the SMTP adapter converts them to a Lettre message. The link is
`${KANLEAF_PUBLIC_URL}/invite#token=<raw-token>`.

## Preview and browser flow

`POST /api/invitations/resolve` accepts a token without consuming it. It returns
only the invitation status, Workspace display name and public identifier,
inviter display name, role, expiry, a masked target-email hint, and whether an
optional authenticated account matches. Invalid tokens reveal no invitation
metadata. Acceptance reuses the existing authenticated token endpoint and exact
email check.

The exact `/invite` browser route is handled before setup and legacy Workspace
routes. It reads `token` from the fragment, resolves metadata, and never accepts
on load. Anonymous users explicitly choose sign-in or registration inside the
same route, so the fragment survives authentication without local storage or a
query string. A new account must preserve Kanleaf's existing account-details
invariant: it temporarily visits `/setup/account` with a strictly validated
router-state return target, then returns to the invitation. Joining remains an
explicit button action and redirects to the canonical Workspace route after the
session and Workspace caches refresh.

The page distinguishes loading, invalid, expired, revoked, already-resolved,
anonymous, correct-account, wrong-account, acceptance-pending, failure, and
success states. The invitation token is not rendered in generic errors.

The explicit route does not require reserving `invite` as a Workspace
identifier. Canonical Workspace URLs are namespaced under `/w`, so `/w/invite`
does not collide with `/invite`; the invitation route is declared before the
legacy top-level compatibility matcher. Existing identifier validation and
database constraints remain unchanged.

## Verification

Backend unit and PostgreSQL tests cover configuration, templates, preview,
authorization, post-commit delivery, disabled/failing transports, create and
renew semantics, and token persistence. Frontend tests cover the page states,
fragment parsing, explicit acceptance, account matching, manual link fallback,
and authentication return. Playwright covers the real registration/login route
boundary. Full Rust, frontend, Compose, Tauri where supported, and both E2E
groups run before final review and push.
