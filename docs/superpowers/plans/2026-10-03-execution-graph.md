# Execution Graph implementation plan

**Goal:** Ship the requested read-oriented Graph task layout without a second task or relation model.

**Spec:** The supplied Phase 1 Execution Graph specification (2026-10-03).

**Architecture:** Canonical TaskQuery results feed a pure projection, a Dagre adapter, then React Flow with Kanleaf nodes and controls. Existing task relation mutations serialize on the Workspace lock and reject dependency cycles. Saved Views own Graph presentation JSON; positions remain ephemeral.

**Tech stack:** React 19, TypeScript, @xyflow/react 12.12.0, @dagrejs/dagre 3.1.1, Axum/SQLx/PostgreSQL.

## Constraints and review focus

- No implicit child prerequisites, editing tools, Task coordinates, or additional graph API/socket.
- Readable out-of-query blockers must still affect execution state without adding nodes or requests; inaccessible Project work must not leak through readiness.
- Independently acyclic hierarchy/dependency graphs can conflict when combined; layout must tolerate this without changing semantics.
- Concurrent relation mutations, archive imports, and legacy cycles must not bypass new cycle validation or disclose private task paths.
- Detail selection, unchanged refetches, and relation visibility must preserve coordinates and viewport.
- Saved-view settings must round-trip through API, migration, export/import, and routing; query completion filtering stays independent.

## Execution

1. Add failing task-workflow tests for DAG direction, cycles, duplicates, concurrency, authorization, and rollback. Implement Workspace-serialized reachability validation in the existing relation path, validate imports, and hydrate related task completion roles in bulk. Preserve activity and extend existing realtime invalidations only as needed.
2. Add failing Saved View Graph/settings round-trip tests. Append migration 0034 for layout and presentation JSON; extend typed DTOs and portability. Verify old layouts and upgrade constraints.
3. Add projection/execution/layout tests. Implement one-node-per-task projection, stable role-based execution state, independent edges, bottom-up Dagre layout and completed zoning. Test filtered inputs, hidden blockers, mixed relation cycles, and a synthetic large graph.
4. Add component tests, then the dedicated execution-graph renderer, compact tokenized nodes/edges/frontier and accessible toolbar. Disable editing/dragging, retain viewport, and isolate layout from selection/title/visibility updates.
5. Integrate Graph into existing layout selector, view draft/settings save, TaskListPane delegation and existing detail selection. Test restored Saved Views, cyclic relation errors in Task Detail, and real browser interaction/reload/toggles.
6. Run complete relevant quality groups and rendered light/dark/narrow checks. Review the full diff, commit/push dev, inspect final GitHub Actions, and leave a supported self-host preview with representative Graph data.

**Execution method:** Native implementation in the current requested dev branch; independent final review before delivery.
