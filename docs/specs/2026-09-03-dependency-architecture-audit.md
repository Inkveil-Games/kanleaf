# Dependency and architecture audit

Date: 2026-09-03

## Objective

Reduce maintenance cost by using mature libraries for generic infrastructure
while retaining Kanleaf-specific domain, persistence, routing, and interaction
logic. Preserve current product behavior and visual design unless an existing
implementation has a concrete accessibility or reliability gap.

## Current architecture

Kanleaf is a pnpm/Cargo workspace. The React 19 desktop/web client uses React
Router, TanStack Query, CodeMirror, and `react-markdown`. The thin Tauri v2 shell
has no native commands or plugins. The Axum server owns authentication,
authorization, PostgreSQL metadata, and typed Markdown vault operations.

The established dependency direction remains unchanged:

```text
React route/UI -> feature API -> shared HTTP client
  -> Axum transport -> owning feature/use case
  -> domain values + PostgreSQL and/or typed vault operations
```

## Audit decisions

### Replace

- Replace the custom Select positioning, focus, dismissal, and keyboard engine
  with Base UI Select while preserving Kanleaf's component API and CSS.
- Replace the misleading `ContextMenu` primitive with separate Base UI-backed
  dropdown-menu and popover primitives. Action lists use Menu semantics;
  interactive panels use Popover semantics.

Base UI is the only new runtime dependency. It supports the current React/Vite
stack, is unstyled, and consolidates the generic accessibility and floating
positioning behavior without adding a second visual system. Testing Library
`user-event` is added as a test-only dependency so keyboard, pointer, focus, and
dismissal behavior is exercised through realistic event sequences.

### Update

- Refresh compatible Rust transitive patch/minor versions in `Cargo.lock`.
- The compatible refresh updates flate2, hyper, indexmap, libredox, mio,
  smallvec, toml, and UUID, and adds the new miniz_oxide transitive package.
- Do not upgrade Rust major-version dependency lines in this batch. SQLx 0.9,
  tower-http 0.7, Argon2 0.6, SHA-2 0.11, and related changes require separate
  migration value and compatibility analysis.

### Keep

- TanStack Query and the shared authenticated HTTP client already provide the
  correct server-state boundary. Do not add another client/store.
- Keep local component state in React; the repository has no shared client-state
  problem that warrants Zustand.
- Keep small forms as controlled React forms. React Hook Form and Zod would not
  currently remove enough validation duplication to offset another frontend
  validation architecture beside the Rust boundary.
- Keep native dialogs. Their repeated lifecycle code is small, and the browser
  already supplies modal focus/inert behavior.
- Keep the command palette's domain-specific remote/local result coordination.
  Reconsider its generic combobox mechanics after the shared primitive migration
  has settled.
- Keep the project-specific pane resize logic and HTML drag/drop behavior. A
  dnd-kit migration across Board, Calendar, and Timeline is behaviorally broad;
  undertake it only with a concrete touch/keyboard reordering requirement.
- Keep native `Date`/`Intl`, small local debounce calls, and simple filtering.
  Dedicated utility, date, table, virtual-list, or fuzzy-search dependencies do
  not reduce current total complexity.
- Keep the CodeMirror Markdown editor and `react-markdown`/remark-GFM preview.
  Markdown is canonical, no custom Markdown parser exists, and raw HTML is not
  enabled. Milkdown, another parser, Shiki, or a sanitizer adds cost without a
  current behavior need.
- Keep Tauri plugin-free until Kanleaf actually needs a native capability.
- Keep the current Axum/SQLx/tracing/thiserror/Argon2 implementation. Server code
  is already typed and feature-owned; the substantial custom code is Kanleaf
  authorization, cross-store, and vault domain behavior rather than generic
  infrastructure.

## Security findings

- Passwords use Argon2 with random salts; session credentials are randomly
  generated and stored as hashes.
- SQL is parameterized through SQLx, and authorization precedes scoped data and
  vault access.
- Vault/import boundaries validate paths, symlinks, special files, archive
  entries, and revisions.
- Markdown preview does not enable raw HTML.
- Tauri exposes only core default capabilities and no shell/filesystem command.
- Browser account sessions persist bearer tokens to support multi-account web
  use. This remains intentionally XSS-sensitive and reinforces the existing CSP,
  raw-HTML prohibition, and dependency-minimization rules.

No security primitive is replaced in this change.

## Dependency inventory result

- All direct production frontend dependencies have current imports and distinct
  responsibilities; no unused or duplicate direct dependency is removed.
- `pnpm outdated` reported no available updates under the current manifest, and
  `pnpm audit --audit-level moderate` reported no advisory.
- Rust duplicate versions are transitive compatibility requirements of Tauri,
  SQLx, or the platform stack rather than duplicate direct infrastructure.
- `cargo-audit` is not installed in this environment, so the Rust security check
  is limited to source review, lock refresh, and the repository's Cargo checks.

## Bundle impact

Against a clean build of the pre-migration commit, production JavaScript grows
from 2,425,104 to 2,582,238 bytes minified and from 816,749 to 868,312 bytes when
each chunk is gzip-compressed. The 51,563-byte gzip increase (6.3% of total JS)
is accepted for the 52 Select and 17 menu/popover call sites now sharing tested
keyboard, focus, dismissal, ARIA, collision, and portal behavior.

## Implementation batches

1. Add behavior-focused tests for Select, Menu, and Popover keyboard/focus/
   dismissal behavior.
2. Add Base UI and migrate Select without changing feature call sites.
3. Add focused Menu and Popover primitives, migrate all `ContextMenu` call
   sites according to semantics, then delete the old primitive.
4. Measure the production bundle and review rendered styles and accessibility.
5. Refresh compatible Rust lockfile versions.
6. Add a durable conditional library-first rule to repository guidance.
7. Run frontend, Rust, Tauri, Compose, security, diff, and status verification.

## Definition of done

- All old primitive call sites use the correct Select, Menu, or Popover
  semantics with unchanged user-facing layout and actions.
- Keyboard navigation, focus return, dismissal, disabled states, and accessible
  names have regression coverage.
- There is only one headless primitive system and no obsolete custom primitive.
- Bundle impact is measured and justified.
- Dependency manifests and lockfiles contain no accidental or unused additions.
- Relevant full verification passes with fresh output and changes are split into
  focused Conventional Commits.
