# Workspace Quick Links Implementation Plan

> **For agentic workers:** Implement the independent API and frontend tasks in parallel; the primary agent owns portability, integration, and final review.

**Goal:** Ship shared Workspace Quick links on Home, matching the approved demo.

**Architecture:** PostgreSQL owns ordered links. Owner/Admin manages them; server filters internal targets by current access. `.kanleaf/workspace.json` projects their configuration through the existing queued snapshot mechanism and export/import remaps internal identities.

**Tech Stack:** Existing Rust/Axum/SQLx/PostgreSQL and React/TypeScript/TanStack Query/Base UI.

**Spec:** User-approved Home demo and shared Workspace ownership in this conversation.

## Constraints and review focus

- Preserve pending Markdown saves, typed routing, current identity/access gating, and the previous shell-color changes.
- Page and Project links store UUIDs, not routes or names. External links accept only HTTP(S), no embedded credentials. Favicon failures fall back to Globe.
- No private target disclosure to Members/Guests. Archived targets remain manageable by admins and unavailable for opening; permanently deleted targets cascade away.
- Reorder and mutation authorization run under Workspace coordination. Failures remain visible and drafts remain recoverable.
- Old archives remain importable; new archives preserve links and remap their target IDs. No direct filesystem writes from API handlers.

## Interface

`GET/POST /api/workspaces/:workspace_id/quick-links`; `PUT/DELETE .../quick-links/:id`; `PUT .../quick-links/order` with `{ ids: UUID[] }`.

Input: `{ kind: 'page' | 'project' | 'external', document_id?, project_id?, title?, url? }`. Only external targets store a title and URL; internal titles resolve from the current target. Output: `{ id, kind, title, url: string|null, project_id: UUID|null, project_identifier: string|null, document_id: UUID|null, document_number: number|null, position: number, available: boolean }`.

Canonical table `workspace_quick_links`: `id`, `workspace_id`, `kind`, nullable `title`, `url`, `project_id` (Project target only), `document_id` (Page target only), `position`. Composite tenant FKs and tagged-target checks. Config snapshot rows contain the canonical fields except `workspace_id`; API enrichment is not persisted.

## Tasks

- [x] API + migration: authorization, CRUD/order, URL and target validation, access filtering, stale/archive handling; SQLx negative and roundtrip tests.
- [x] Portability: workspace config v3, legacy compatibility, strict target validation, UUID remapping, projection trigger and export/import regression coverage.
- [x] Frontend: typed Home route, shared links CRUD and keyboard ordering, Page/Project picker, favicon/domain treatment, owner/admin management, empty/loading/error/access states, save-coordinated navigation.
- [x] Integration: full relevant frontend/server checks, real browser workflow with disposable data, rendered light/dark/narrow inspection, current architecture docs and complete diff review.
