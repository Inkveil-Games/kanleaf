# Kanleaf Agent Guidelines

## Product and UI

Kanleaf combines structured task management with durable Markdown documents.
Keep metadata in PostgreSQL and Task/Page bodies in normal vault `.md` files. Preserve
the restrained desktop UI: panes, rows, lists, subtle separators, compact
metadata, visible focus, and keyboard operation. Do not turn it into a card-heavy
SaaS dashboard or move task detail into modal-first flows.

## Repository responsibilities

- `apps/desktop`: React/TypeScript features and the thin Tauri shell.
- `apps/server`: domain rules, Axum API, SQLx persistence, and typed vault access.
- `infra/self-host`: the supported server/PostgreSQL deployment.
- `docs`: current architecture and development guidance.

Dependencies flow from UI/HTTP boundaries toward domain rules. Domain code must
not depend on Axum, SQLx, Tauri, React, or a filesystem implementation. Keep HTTP
handlers thin enough to expose the use case clearly, and keep SQL in the owning
server feature rather than scattering it through unrelated handlers.

Do not add placeholder crates, generic repositories, microservices, or shared
packages for hypothetical reuse. Prefer module, then mature module, then crate.
See `docs/architecture.md` before changing a data boundary.

## Security and data

Authorize every workspace-scoped server operation. Check membership and
Task/Document ownership before vault access, construct paths only from parsed IDs, and never
return password/session hashes or filesystem paths. Keep Markdown preview raw
HTML disabled unless an equally strong sanitization design replaces it.

Migrations are ordered and committed. `Cargo.lock`, `pnpm-lock.yaml`, migrations,
and intentional shared configuration stay tracked; secrets, vaults, databases,
build output, and machine state do not.

## Change workflow

Implement coherent vertical behavior and avoid speculative abstractions. Add
tests with behavior: domain and authorization tests in Rust, user interaction in
Vitest/Testing Library, and essential real workflows in Playwright. PostgreSQL
tests must remain isolated and filesystem tests must use temporary directories.

Before a capability commit:

1. inspect status and diff;
2. format and lint without warnings;
3. run relevant tests and builds;
4. remove stale comments, generated demo content, and unrelated changes;
5. use a focused Conventional Commit message.

Comments should explain security invariants, tradeoffs, or platform behavior—not
obvious statements. Do not over-engineer. Update concise docs when commands,
configuration, architecture, or supported behavior changes.
