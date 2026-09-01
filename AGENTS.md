# Kanleaf Agent Guidelines

## Project identity

Kanleaf is a self-hosted task and project manager that combines structured work
with durable Markdown. PostgreSQL owns structured metadata; Task and Library
bodies remain normal `.md` files in a Workspace vault.

Preserve the restrained desktop product: panes, rows, lists, subtle separators,
compact metadata, visible focus, and keyboard operation. Do not turn it into a
card-heavy SaaS dashboard or move task detail into modal-first flows.

## Current technical decisions

- Frontend: React 19, strict TypeScript, Vite 8, React Router 7, TanStack Query,
  CodeMirror 6, and CSS design tokens.
- Desktop shell: Tauri v2. The native boundary is intentionally thin and has no
  application commands or native filesystem API today.
- Server: Rust 2024, Axum 0.8, Tokio, SQLx 0.8, and PostgreSQL 17.
- Package management: pnpm 11.24.0 with Node.js 22 or newer; Cargo lockfile for
  Rust dependencies.
- Tests: Vitest and Testing Library, Playwright, Rust unit tests, and isolated
  `#[sqlx::test]` PostgreSQL integration tests.
- Deployment: one Axum process serves the API and optional Vite assets; the
  supported self-host stack is Docker Compose plus PostgreSQL.

Do not add placeholder crates, generic repositories, microservices, shared
packages, or native commands for hypothetical reuse. Prefer a module, then a
mature module, then a crate.

## Source of truth

Resolve conflicts in this order: current code, manifests/configuration, tests,
CI/build scripts, current architecture/development docs, then historical notes.
`docs/specs/**` and `docs/superpowers/**` are dated rationale, not current
contracts; recheck them against the tree before using them.

Update stale documentation instead of changing working code to match it. Do not
turn a temporary implementation detail into a permanent rule.

## Architecture and directory responsibilities

The current dependency flow is:

```text
React route/UI -> frontend feature API -> shared HTTP client
  -> Axum transport -> owning server feature/use case
  -> domain values + SQLx/PostgreSQL and/or typed vault operations
```

- `apps/desktop/src/app`: providers, application startup, and routing boundary.
- `apps/desktop/src/features`: feature UI, state coordination, and feature API
  adapters. Keep remote calls out of generic UI primitives.
- `apps/desktop/src/components/ui`: reusable product primitives.
- `apps/desktop/src/lib`: shared API/configuration infrastructure, not domain
  dumping ground.
- `apps/desktop/src-tauri`: the thin Tauri shell and capabilities.
- `apps/server/src/http.rs`: cross-cutting HTTP composition and SPA serving.
- `apps/server/src/<feature>`: handlers, DTOs, authorization coordination, SQL,
  and use-case behavior owned by that feature.
- `apps/server/src/domain`: framework-independent value types and validation; it
  must not depend on Axum, SQLx, Tauri, React, or filesystem implementations.
- `apps/server/src/vault`: typed paths, Markdown storage, manifests, trash, and
  recovery boundaries.
- `apps/server/migrations`: ordered, immutable schema history.
- `infra/self-host`: the supported server/PostgreSQL deployment.
- `docs`: current architecture and development guidance plus clearly dated
  historical designs.

Read `docs/architecture.md` before changing a data or authorization boundary.
Keep handlers thin enough that the use case is visible, and keep SQL in the
owning feature instead of scattering it through unrelated handlers.

## Frontend principles

- React Router owns durable application location. Use the typed builders and
  adapters under `apps/desktop/src/app/routing` and
  `apps/desktop/src/features/workspace`; do not hand-assemble paths.
- A URL-selected Workspace is authoritative after membership validation.
  `active_workspace_id` is a persistence side effect, not a redirect source
  that may overwrite a valid deep link.
- TanStack Query owns remote cache state, React owns transient interaction
  state, and local storage is limited to the account registry and device
  preferences. Do not duplicate those sources of truth.
- Route and identity transitions must respect `DocumentSaveCoordinator` so
  pending Markdown is flushed or the transition is visibly blocked.
- Cached scoped data must not render or issue child queries until the owning
  Workspace/Project access query has completed at least once for the current
  identity. Preserve UI during later background refetches; hide stale surfaces
  on an access error.
- Use feature `api.ts` modules and the shared authenticated client. Keep Tauri
  out of normal feature code unless a real native capability is required.
- Reuse existing components, tokens, interaction patterns, and explicit
  loading/error/empty states. Preserve keyboard access, focus, and ARIA names.
- Keep TypeScript strict. Avoid `any`, non-null assertions that hide lifecycle
  bugs, and abstractions with only one speculative caller.

## Backend principles

- The server is the authorization boundary. Authenticate and authorize before
  database detail, vault access, or non-disclosing resource lookup.
- Every Workspace-scoped operation checks membership. Project-scoped behavior
  additionally checks effective Project access. Host status is not Workspace
  membership: it may administer instance access policy and see only the explicit
  cross-Workspace name/Owner metadata, never Workspace content.
- Validate transport input at the handler boundary, keep domain values typed,
  return the existing structured errors, and never expose internal paths,
  password hashes, or session hashes.
- Let the owning use case control its SQLx transaction. Do not hide transactions
  behind a generic repository or split one invariant across unrelated modules.
- Preserve tenant constraints in SQL and application checks. Concurrency-
  sensitive configuration and task changes use the established Workspace locks.
- Treat Markdown/body-write ordering as a deliberate cross-store decision. Do
  not change it casually: PostgreSQL and the filesystem cannot commit atomically.

## Data, migrations, and vault safety

- Add a new ordered migration; never rewrite a committed migration. Keep
  migrations and both lockfiles tracked.
- Construct vault paths only through typed IDs or validated storage names.
  Reject traversal, symlinks, special files, unmanaged archive entries, and
  revision mismatches at the established boundary.
- Authorize the owning Workspace/Project scope before Task or Library access.
  Do not confuse scope ownership with individual user ownership.
- Structural vault changes use rename, recovery manifests, compensation, and
  trash-first deletion. Live vaults, internal `operations/`, and `trash/` must
  remain on a filesystem topology where the required renames are atomic; test
  deployment mount changes against that invariant.
- The current Compose mount splits `/data/vaults` from container-local
  `operations/` and `trash/`, so it does not establish that same-filesystem
  guarantee. Do not treat a successful Compose parse as recovery coverage or
  silently change the layout without a migration-compatible deployment decision.
- Filesystem tests use temporary directories. PostgreSQL tests use isolated
  databases and must not depend on developer data.
- Secrets, vaults, databases, build output, and machine state stay untracked.

Keep raw HTML disabled in Markdown preview unless an equally strong sanitation
design replaces it.

## Testing and definition of done

Write behavior with the change:

- Rust domain/authorization tests for server rules and negative access cases.
- Vitest/Testing Library tests for frontend behavior, accessibility, routing,
  loading, error, and cached-access states.
- Playwright only for essential real workflows and browser/server boundaries.
- `#[sqlx::test]` plus temporary vaults for PostgreSQL/filesystem integration.

Select checks proportional to the diff, then run the full relevant group with
fresh output before claiming completion. Canonical commands, from the repository
root, are:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --locked
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf \
  cargo test --workspace --all-features --locked

pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm tauri build --no-bundle

DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_e2e \
  pnpm test:e2e
DATABASE_URL=postgres://kanleaf:kanleaf_dev@127.0.0.1:5432/kanleaf_e2e \
  pnpm test:e2e:self-host

docker compose --env-file infra/self-host/.env.example \
  -f infra/self-host/compose.yaml config --quiet
```

Create the example `kanleaf_e2e` database as a disposable database before the
Playwright commands: their setup isolates the vault, not the supplied database.
Tauri checks require the documented platform packages. A task is done only when
the behavior, negative cases, formatting, tests/builds, status, and final diff
have been reviewed; code written alone is not completion.

## Comments, documentation, and dependencies

Comments explain security invariants, tradeoffs, or platform behavior—not
obvious syntax. Avoid narration and excessive generated commentary. Update
concise current docs when commands, configuration, architecture, or supported
behavior changes.

Prefer existing dependencies and standard-library capabilities. A new
dependency needs a concrete current use, ownership location, and maintenance or
security justification. Keep lockfile changes intentional.

## Git

Inspect status and the complete diff before staging. Preserve unrelated user
changes, keep commits focused, and use the repository's established
Conventional Commit style. Do not mix product work with agent-infrastructure
changes, rewrite unrelated history, force-push, or commit generated demo data.

## Agent knowledge maintenance

`AGENTS.md` and project-local skills are living documentation. Future agents
may update them only when a task reveals knowledge that is durable, reusable,
Kanleaf-specific, supported by current code/configuration, and likely to prevent
recurring mistakes or rediscovery. Examples include a stable architecture or UI
rule, security boundary, migration invariant, required verification command, or
recurring integration failure.

Do not record task notes, temporary debugging, one-off decisions, speculation,
personal preferences, or facts already documented adequately elsewhere. Never
modify user/global skills during normal project work. Prefer updating this file
or an existing project skill; add a skill only for a distinct recurring workflow
with a clear trigger.

Any change to `AGENTS.md`, `.agents/skills/**`, or agent configuration must be
included in final diff review and called out explicitly in the completion
summary. Agent guidance must never self-modify silently.
