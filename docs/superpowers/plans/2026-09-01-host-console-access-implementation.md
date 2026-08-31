# Host Console and Restricted Access Implementation Plan

Design source:
`docs/superpowers/specs/2026-09-01-host-console-access-design.md`

## Delivery strategy

Deliver the feature in four focused commits. Keep the instance policy in its
own server feature, preserve the existing membership-scoped Workspace API, and
do not let Host authorization enter Task, Library, or vault code. Each commit
must pass its focused checks before it is created; the final commit must pass
the complete Rust, frontend, Playwright, and self-host configuration checks.

## 1. Persist and enforce the instance access policy

Files:

- Add `apps/server/migrations/0017_instance_access.sql`.
- Add `apps/server/src/host.rs` with the policy read/lock helpers used by auth.
- Update `apps/server/src/lib.rs`.
- Update `apps/server/src/config.rs` and its unit tests.
- Update `apps/server/src/state.rs` and `apps/server/src/main.rs`.
- Update `apps/server/src/error.rs`.
- Update `apps/server/src/auth.rs`.
- Extend `apps/server/tests/postgres_schema.rs` and
  `apps/server/tests/auth.rs`.

Behavior:

- Create the singleton Open policy and normalized exact-email allowlist with
  additive PostgreSQL constraints.
- Parse optional `KANLEAF_HOST_EMAIL` through `NormalizedEmail`; blank disables
  Host identity and invalid non-empty values fail startup.
- Keep `AppState::new` compatible with existing tests and add the configured
  Host through a narrow builder or optional constructor path.
- Add `access_restricted` as a dedicated `403` error without changing generic
  authentication failures.
- Add `is_host` to every registration, login, session, and refreshed account
  user response, deriving it from configuration instead of persisting a role.
- Lock the settings singleton in the registration and post-password login
  transactions before creating users or sessions.
- Preserve the missing-user/password timing path, return generic `401` for bad
  credentials, and return `403 access_restricted` only after valid credentials.
- Apply the current policy during bearer extraction so disallowed retained
  sessions receive `401` on every authenticated API boundary. Always exempt the
  configured Host from the allowlist.
- Verify Open compatibility, Host bootstrap, exact normalized allowlisting,
  registration rollback, denied login, current-session denial, and migration
  constraints with isolated PostgreSQL tests.

Focused verification:

```text
cargo fmt --all --check
cargo clippy --locked -p kanleaf-server --all-targets --all-features -- -D warnings
cargo test --locked -p kanleaf-server config::
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test --locked -p kanleaf-server --features postgres-tests \
  --test postgres_schema --test auth
```

Commit: `feat(auth): enforce host access policy`

## 2. Add the protected Host administration API

Files:

- Extend `apps/server/src/host.rs` with Host authorization, request/response
  models, handlers, and owned SQL.
- Update `apps/server/src/http.rs` to merge `/api/host` routes before the API
  fallback.
- Add `apps/server/tests/host.rs`.

Behavior:

- Implement a `HostUser` extractor on top of `AuthenticatedUser`: invalid or
  policy-invalid tokens return `401`, valid non-Host users return `403`, and a
  configured Host continues.
- Implement `GET /api/host/workspaces` as a metadata-only cross-Workspace query
  returning each Workspace and its single Owner identity in stable order.
- Implement `GET /api/host/access` with one consistent canonical snapshot and
  sorted email output.
- Implement `PUT /api/host/access` as one complete replacement: validate and
  normalize every email before writes, lock the settings row, replace the
  allowlist, update the mode, revoke disallowed sessions when Restricted, and
  return the canonical saved policy after commit.
- Keep the Host implicitly eligible without inserting the Host email into the
  stored list. Preserve the stored list while the policy is Open.
- Test all three endpoints without a token, with a non-Host token, and with the
  Host token. Cover validation rollback, canonicalization, session revocation,
  all-Workspace Owner metadata, and the absence of content/path/credential
  fields.
- Add a concurrency regression showing registration or login cannot cross a
  committed policy transition with a surviving disallowed session.

Focused verification:

```text
cargo fmt --all --check
cargo clippy --locked -p kanleaf-server --all-targets --all-features -- -D warnings
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test --locked -p kanleaf-server --features postgres-tests \
  --test host --test auth
```

Commit: `feat(server): add host administration API`

## 3. Build the restrained Host Console client

Files:

- Update `apps/desktop/src/lib/api/types.ts` and affected user fixtures.
- Update `apps/desktop/src/lib/api/client.ts` and add its focused test.
- Add `apps/desktop/src/features/host/api.ts`.
- Add `apps/desktop/src/features/host/HostConsole.tsx`,
  `HostWorkspaces.tsx`, `HostAccessSettings.tsx`, and their focused tests.
- Export the existing frame/navigation primitives from
  `apps/desktop/src/features/settings/SettingsShell.tsx` and extend its focused
  tests only where their public behavior changes.
- Update `apps/desktop/src/features/account/AccountSwitcher.tsx` and
  `AccountSwitcher.test.tsx`.
- Update `apps/desktop/src/features/workspace/WorkspaceShell.tsx` and its
  focused test fixtures.
- Update `apps/desktop/src/app/App.tsx` and `App.test.tsx`.
- Update `apps/desktop/src/styles/global.css`.

Behavior:

- Add a minimal History API pathname boundary for `/host` without adding a
  routing package; preserve all existing paths as the Workspace shell and
  respond to Back/Forward navigation.
- Keep health and session restoration ahead of route authorization. Show normal
  authentication to an anonymous `/host` visitor and a focused denied state to
  an authenticated non-Host.
- Emit one token-scoped unauthorized signal from the shared API client whenever
  an authenticated request receives `401`; have `ConfiguredApp` discard that
  exact retained session. Keep the direct `/api/session` error path as a safe
  startup fallback and do not react to public login failures without a token.
- Add `Host Console` to the existing account menu only when `user.is_host` and
  return to `/` through the reused Settings back control.
- Build a full-height two-column Settings surface with `Workspaces` and
  `Access`, reusing `SettingsFrame`, `SettingsArticle`, `SettingsLink`,
  `FormActions`, `LoadError`, `ContextMenu`, `apiRequest`, and TanStack Query.
- Render Workspace/Owner data as a compact semantic table with row-shaped
  loading, empty, retry, and long-content states; add no actions or links into
  Workspace content.
- Render Restricted access as a native labeled checkbox, visible text state,
  one-email-per-line textarea, Host exemption note, explicit save action, and
  accessible status/error messages.
- Confirm every Restricted save before sending. Submit trimmed non-empty lines,
  accept the server's normalized response as the new draft, preserve drafts on
  failure, and rely on the shared token-scoped `401` cleanup after revocation.
- Apply the signed-in user's theme on the full-page Host surface and cover both
  sections, routing, menu visibility, authorization states, confirmation,
  canonical payloads, retry, and preserved drafts with Vitest/Testing Library.

Focused verification:

```text
pnpm --filter @kanleaf/desktop exec vitest run \
  src/lib/api/client.test.ts \
  src/features/host \
  src/features/account/AccountSwitcher.test.tsx \
  src/app/App.test.tsx
pnpm typecheck
pnpm lint
pnpm format:check
```

Commit: `feat(ui): add host console`

## 4. Wire self-host configuration and verify the real workflow

Files:

- Update `.env.example` and `infra/self-host/.env.example`.
- Update `infra/self-host/compose.yaml`.
- Update `apps/desktop/e2e/environment.ts`, `global-setup.ts`, and
  `self-host-global-setup.ts` with an explicit deterministic Host identity.
- Extend `apps/desktop/e2e/self-host-smoke.spec.ts` with the complete Host flow
  and direct `/host` SPA route.
- Update `README.md`, `docs/architecture.md`, and `docs/development.md`.

Behavior:

- Pass optional `KANLEAF_HOST_EMAIL` into the application container while
  keeping existing deployments valid when it is blank.
- Spawn ordinary Playwright servers with an explicit blank Host variable so a
  developer's root `.env` cannot accidentally alter tests; enable a stable
  test Host only for the isolated self-host workflow.
- Document Host bootstrap on a trusted LAN, the Open default, exact-email
  semantics, invitation interaction, immediate session revocation, and the
  security-sensitive behavior of rolling back to an older binary.
- Document the Pi's one-time `git pull` plus `.env` edit and service recreate;
  make clear that the existing hourly timer updates the image but not Compose.
- Exercise a real Host account that opens `/host`, sees Workspace Owner
  metadata, enables restriction, rejects unlisted registration and valid login,
  admits an approved account, revokes an active removed account, and restores
  the exact pre-test policy in cleanup.
- Verify direct browser loading of `/host` through the Axum SPA fallback and
  separately verify unauthenticated Host APIs return JSON `401`.

Final verification:

```text
git diff --check
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test --workspace --all-features --locked
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  pnpm test:e2e
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  pnpm test:e2e:self-host
docker compose --env-file infra/self-host/.env.example \
  -f infra/self-host/compose.yaml config --quiet
docker build -f apps/server/Dockerfile -t kanleaf:host-console .
```

Visually inspect `/host` at wide and 960-pixel desktop widths in light and dark
themes. Review populated, empty, loading, error, long-name/email, confirmation,
saved, and denied states; verify keyboard focus and table/checkbox/textarea
labels. Finally inspect the diff for leaked Host configuration, Workspace
content queries, stale open-access documentation, debug output, generated data,
and unrelated changes.

Commit: `feat(self-host): configure host console`
