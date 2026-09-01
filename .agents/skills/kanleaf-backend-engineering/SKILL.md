---
name: kanleaf-backend-engineering
description: Implement, fix, migrate, secure, or review Kanleaf Rust server work in apps/server, including Axum routes, authentication and authorization, SQLx/PostgreSQL persistence, migrations, Task or Library Markdown vault operations, portability, recovery, and backend tests. Use for any server or cross-store change; do not use for frontend-only behavior or generic Rust guidance.
---

# Kanleaf backend engineering

Use this skill for behavior under `apps/server`, database migrations, server
configuration, or deployment changes that affect the server's data boundary.
Read root `AGENTS.md` and `docs/architecture.md`, then inspect the owning
feature, its route wiring, and adjacent tests before editing.

Do not use it for:

- frontend-only routing, React state, or CSS work;
- generic Rust refactoring without a concrete Kanleaf behavior;
- inventing a repository/application layer, service, or crate for future reuse;
- changing self-host deployment independently of the server invariants it must
  preserve.

## Know the boundary

```text
HTTP request
  -> http.rs composition and feature handler
  -> transport parsing and authenticated actor
  -> Workspace/Project authorization
  -> owning feature use case and SQLx transaction
  -> PostgreSQL and/or typed vault operation
  -> structured response or AppError
```

Relevant paths:

- `apps/server/src/http.rs`: top-level router, request IDs, tracing, CORS, body
  limits, API fallback, and optional SPA assets.
- `apps/server/src/auth.rs`: registration, login, bearer sessions, and actor
  extraction.
- `apps/server/src/config.rs`, `state.rs`, and `main.rs`: configuration, shared
  resources, startup migrations/recovery/workers, and listener lifecycle.
- `apps/server/src/error.rs`: public structured error boundary.
- `apps/server/src/domain`: framework-independent values and validation.
- Root feature files such as `workspace.rs`, `project.rs`, `task.rs`,
  `document.rs`, `saved_view.rs`, `collaboration.rs`, and `host.rs`, plus their
  sibling feature directories: feature-owned handlers, SQL, rules, and tests.
- `apps/server/src/task_config`: Workspace vocabulary features.
- `apps/server/src/vault`: typed layout, Markdown IO, structural operations,
  manifests, trash, migration, and recovery.
- `apps/server/src/portability`: export, import, archive validation, projections,
  operation storage, and Vault Sync.
- `apps/server/migrations`: ordered PostgreSQL schema history.
- `apps/server/tests`: cross-feature and SQLx integration behavior.
- `apps/server/Dockerfile`, `apps/server/docker-entrypoint.sh`, and
  `infra/self-host/compose.yaml`: production image and deployment boundary.

The `domain` directory must remain independent of Axum, SQLx, and filesystem
implementations. Feature modules may deliberately coordinate SQLx and use-case
rules; do not force working feature logic into a hypothetical pure layer.

## Work in this order

1. Trace the existing route through handler, authorization helper, SQL, domain
   values, vault calls, response DTO, and negative tests.
2. State the tenant, actor, transaction, and filesystem invariants before
   changing code. If the change crosses PostgreSQL and the vault, identify the
   failure point and recovery/compensation path.
3. Add a failing test for the behavior and at least one relevant denial,
   conflict, concurrency, or recovery case.
4. Implement the smallest change in the owning feature. Reuse existing domain
   values, access helpers, error codes, and typed paths.
5. Add a new migration only when the schema must change. Review constraints,
   indexes, foreign keys, rollback behavior in application code, and portable
   projections.
6. Review the complete diff for information disclosure, tenant crossing,
   transaction gaps, path construction, secrets, and startup recovery.
7. Run fresh focused tests, then all applicable locked workspace checks.

For review or diagnosis only, stop after tracing the boundary and reporting
evidence-ranked findings. Do not add tests, implementation, or migrations unless
the user also requested a change.

## Authentication and authorization

- Authenticate on the server for every protected route. A frontend check is
  presentation only and never sufficient.
- Authorize every Workspace-scoped operation. Project operations also resolve
  effective Project access before disclosing a private resource or touching its
  Tasks/Library tree.
- Workspace Guests cannot access Inbox or Workspace Library content. Project
  roles separately govern read, comment, edit, and management capabilities;
  check the exact capability required by the use case.
- Prefer non-disclosing lookups already used by the feature. Do not reveal
  whether an inaccessible private Project, Task, document, member, or path exists.
- Host identity comes from normalized `KANLEAF_HOST_EMAIL` and is rechecked by
  Host handlers. It may administer instance access policy and see only the
  explicit cross-Workspace name/Owner metadata; it is not a Workspace role and
  must never bypass Task, Library, or vault access.
- Restricted instance access applies to registration, valid-credential login,
  and bearer-session extraction. Workspace invitations do not bypass it.
- Never serialize password hashes, session digests, bearer tokens from storage,
  internal operation IDs beyond their public contract, or filesystem paths.
- Test unauthenticated, wrong-Workspace, insufficient-role, and stale/revoked
  session behavior relevant to the route.

## SQLx, migrations, and transactions

- Keep SQL in the feature that owns the record and invariant. Do not add a
  generic repository or query abstraction merely to hide SQL.
- Let the use case own its transaction. Perform membership/access checks and
  concurrency-sensitive reads inside the transaction when a concurrent change
  could invalidate them.
- Preserve composite tenant foreign keys, partial uniqueness, check constraints,
  and Workspace-row coordination patterns. Application checks complement rather
  than replace database constraints.
- Append one ordered migration and keep it tracked with the capability change.
  Never edit an existing committed migration or depend on an untracked local
  schema. Create a Git commit only when the task/workflow authorizes it.
- Consider every schema change's effect on startup migrations, DTOs, projections,
  export/import, recovery, test fixtures, and self-host upgrades.
- Use `#[sqlx::test]` for database integration. Tests receive isolated
  databases; do not point destructive or mutation-heavy tests at user data.

## Vault and cross-store safety

- PostgreSQL owns structured metadata. Task and Library bodies are ordinary
  Markdown under typed Workspace/Project paths.
- Construct paths through the established `TaskPath`, `LibraryPath`,
  `ProjectPath`, typed IDs, and validated stable storage names. Never join an
  untrusted request string directly into a filesystem path.
- Preserve traversal, symlink, special-file, archive-inventory, decompression,
  checksum, and revision defenses. Export only database-known managed paths.
- Authorize and, where established, lock the owning scope before vault access.
  A Task or Library item belongs to its Workspace/Project scope, not an
  individual user.
- Markdown reads/writes use revisions. A mismatch must leave external and local
  authored content intact and return the existing stable conflict response.
- Structural moves and deletion are not atomic with PostgreSQL. Distinguish
  synchronous returned-error compensation from restart recovery. Library
  structural operations use durable manifests; current Task/Workspace trash
  handles are in-memory compensation and do not recover every crash window. Do
  not copy the latter when restart recovery is required.
- Live vaults, `KANLEAF_DATA_DIR/operations`, staging, and trash must share a
  filesystem topology that supports the expected atomic renames. The current
  Compose file bind-mounts only `/data/vaults`, so import/trash renames can cross
  into the container filesystem and fail with `EXDEV`; it is already
  incompatible with that assumption. Do not claim Compose safety from a config
  parse or local one-directory tests. Fixing it requires a migration-compatible
  persistence decision plus a real container mount/recreation test.
- Do not casually reorder body writes and database commits. Current body-write
  rollback/retry semantics are not a blanket guarantee; changes need an explicit
  failure design and human review.
- Startup recovery must fail safely when committed data and required vault state
  disagree. Do not silently accept data loss or leak internal recovery paths.

## HTTP and async behavior

- Keep top-level middleware and SPA/API fallback behavior in `http.rs`. Unknown
  `/api` routes remain structured JSON 404s; only non-API navigation may use
  the SPA fallback.
- Parse and validate request DTOs at the boundary, use domain types internally,
  and map failures through the existing structured error codes.
- Keep blocking or heavy filesystem/archive work off inappropriate async hot
  paths using the established patterns. Retain request cancellation and cleanup
  behavior where operations are staged.
- Background projection, cleanup, and recovery workers must be bounded,
  idempotent, observable, and safe to retry.
- Do not broaden CORS, body limits, Tauri origins, or static serving as a
  side-effect of an unrelated route.

## Tests and verification

Start with the nearest unit test:

```bash
cargo test -p kanleaf-server --locked \
  domain::tests::normalizes_valid_email_addresses
cargo fmt --all --check
```

Replace the example filter with the nearest unit test.

Every file in `apps/server/tests` is feature-gated. Run a focused SQLx target
with the feature and a disposable PostgreSQL server, for example:

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test -p kanleaf-server --features postgres-tests --locked \
  --test auth restricted_access
```

Then run the server quality group:

```bash
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --locked
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test --workspace --all-features --locked
```

The PostgreSQL role must be able to create isolated test databases. Use a
disposable local server, never a deployment database. For HTTP/browser-facing
contract changes, also run the relevant frontend tests and select the suite that
proves the behavior:

```bash
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_e2e \
  pnpm test:e2e
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_e2e \
  pnpm test:e2e:self-host
```

The normal suite covers core Task, Library, account, portability, and tenant
flows. Add self-host for static/SPA fallback, same-origin, Host, Restricted
access, and deep-link behavior. Playwright retains records in the supplied
database, so create `kanleaf_e2e` as disposable state first.

For self-host or configuration changes, validate the example and build context:

```bash
docker compose --env-file infra/self-host/.env.example \
  -f infra/self-host/compose.yaml config --quiet
docker build -f apps/server/Dockerfile -t kanleaf:local .
```

## Common failures

- A handler authenticates but never authorizes the owning Workspace or Project.
- A lookup discloses an inaccessible private record through different 403/404
  behavior.
- SQL is moved into a generic abstraction and its tenant or transaction context
  becomes invisible.
- A migration is edited in place or omits a required tenant constraint.
- A database commit and filesystem rename have no compensation for the second
  failure.
- User-controlled names reach path joins, ZIP entries, or error messages as
  internal paths.
- A vault test uses one filesystem while the deployment splits rename endpoints
  across mounts.
- Unit tests pass without the `postgres-tests` feature, leaving the changed SQL
  unexecuted.
- A Host check is treated as global Workspace authorization.

## Definition of done

The changed boundary has typed input/output where applicable and structured
errors; every scoped path is authorized without disclosure; transaction and
cross-store failure behavior is explicit; migrations are append-only; negative
and recovery tests exist; all applicable locked checks have fresh output; and
the final diff contains no secrets, generated state, or unrelated refactor.
