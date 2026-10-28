import { describe, expect, it } from 'vitest';
import {
  buildSections,
  destinationForRow,
  descendantIds,
  dropRegion,
  moveTreeNode,
  visibleSections,
  type TreeDestination,
} from './tree';
import type { WorkspaceDocument } from './types';

function document(
  id: string,
  parentId: string | null,
  position: number,
  input: Partial<WorkspaceDocument> = {},
): WorkspaceDocument {
  return {
    id,
    document_number: position + 1,
    workspace_id: 'workspace-1',
    project_id: null,
    parent_id: parentId,
    title: id,
    storage_name: id,
    library_path: `Wiki/${id}.md`,
    position,
    can_edit: true,
    archived_at: null,
    created_at: '2026-09-13T00:00:00Z',
    updated_at: '2026-09-13T00:00:00Z',
    ...input,
  };
}

function order(documents: WorkspaceDocument[], parentId: string | null) {
  return documents
    .filter(({ parent_id }) => parent_id === parentId)
    .sort((left, right) => left.position - right.position)
    .map(({ id, position }) => `${id}:${position}`);
}

function move(
  documents: WorkspaceDocument[],
  documentId: string,
  destination: TreeDestination | null,
) {
  if (!destination) throw new Error('Expected a valid destination');
  const result = moveTreeNode(documents, { documentId, destination });
  if (!result) throw new Error('Expected a valid tree projection');
  return result;
}

describe('Library tree moves', () => {
  it('reorders siblings before and after with contiguous positions', () => {
    const documents = [
      document('a', null, 0),
      document('b', null, 4),
      document('c', null, 9),
    ];

    const firstToLast = move(documents, 'a', { parentId: null, index: 2 });
    expect(order(firstToLast.documents, null)).toEqual(['b:0', 'c:1', 'a:2']);

    const lastToFirst = move(firstToLast.documents, 'a', {
      parentId: null,
      index: 0,
    });
    expect(order(lastToFirst.documents, null)).toEqual(['a:0', 'b:1', 'c:2']);
  });

  it('nests a leaf, appends inside an existing parent, and reparents a child', () => {
    const documents = [
      document('a', null, 0),
      document('a1', 'a', 0),
      document('b', null, 1),
      document('b1', 'b', 0),
      document('leaf', null, 2),
    ];

    const nested = move(
      documents,
      'leaf',
      destinationForRow(documents, 'leaf', 'b', 'inside'),
    );
    expect(order(nested.documents, 'b')).toEqual(['b1:0', 'leaf:1']);

    const reparented = move(
      nested.documents,
      'a1',
      destinationForRow(nested.documents, 'a1', 'b1', 'after'),
    );
    expect(order(reparented.documents, 'a')).toEqual([]);
    expect(order(reparented.documents, 'b')).toEqual([
      'b1:0',
      'a1:1',
      'leaf:2',
    ]);
  });

  it('unnests a child at a root insertion point', () => {
    const documents = [
      document('a', null, 0),
      document('b', 'a', 0),
      document('c', 'a', 1),
      document('d', null, 1),
    ];

    const result = move(
      documents,
      'b',
      destinationForRow(documents, 'b', 'd', 'before'),
    );
    expect(order(result.documents, 'a')).toEqual(['c:0']);
    expect(order(result.documents, null)).toEqual(['a:0', 'b:1', 'd:2']);
  });

  it('moves a parent with every descendant as one logical subtree', () => {
    const documents = [
      document('a', null, 0),
      document('a1', 'a', 0),
      document('a1a', 'a1', 0),
      document('a2', 'a', 1),
      document('b', null, 1),
    ];

    const result = move(documents, 'a', { parentId: null, index: 1 });
    expect(order(result.documents, null)).toEqual(['b:0', 'a:1']);
    expect(result.documents.find(({ id }) => id === 'a1')?.parent_id).toBe('a');
    expect(result.documents.find(({ id }) => id === 'a1a')?.parent_id).toBe(
      'a1',
    );
    expect(result.movedIds).toEqual(new Set(['a', 'a1', 'a1a', 'a2']));
  });

  it('rejects self, descendant, invalid index, scope, and permission drops', () => {
    const documents = [
      document('a', null, 0),
      document('a1', 'a', 0),
      document('project', null, 0, { project_id: 'project-1' }),
      document('readonly', null, 1, { can_edit: false }),
    ];

    expect(destinationForRow(documents, 'a', 'a', 'inside')).toBeNull();
    expect(destinationForRow(documents, 'a', 'a1', 'inside')).toBeNull();
    expect(destinationForRow(documents, 'a', 'project', 'before')).toBeNull();
    expect(destinationForRow(documents, 'a', 'readonly', 'after')).toBeNull();
    expect(
      moveTreeNode(documents, {
        documentId: 'a',
        destination: { parentId: 'a1', index: 0 },
      }),
    ).toBeNull();
    expect(
      moveTreeNode(documents, {
        documentId: 'a',
        destination: { parentId: null, index: 99 },
      }),
    ).toBeNull();
    expect(
      moveTreeNode(documents, {
        documentId: 'readonly',
        destination: { parentId: null, index: 0 },
      }),
    ).toBeNull();
  });

  it('keeps full descendants available while collapsed rendering hides them', () => {
    const documents = [
      document('a', null, 0),
      document('a1', 'a', 0),
      document('a1a', 'a1', 0),
      document('b', null, 1),
    ];
    const sections = buildSections(documents, [], null);
    const visible = visibleSections(sections, new Set(['a']));

    expect(descendantIds(documents, 'a')).toEqual(new Set(['a1', 'a1a']));
    expect(visible[0]?.entries.map(({ document }) => document.id)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('Library drop destination calculation', () => {
  it('resolves before, after, and inside to destination sibling indices', () => {
    const documents = [
      document('a', null, 0),
      document('a1', 'a', 0),
      document('a2', 'a', 1),
      document('b', null, 1),
    ];

    expect(destinationForRow(documents, 'b', 'a', 'before')).toEqual({
      parentId: null,
      index: 0,
    });
    expect(destinationForRow(documents, 'a', 'b', 'after')).toEqual({
      parentId: null,
      index: 1,
    });
    expect(destinationForRow(documents, 'b', 'a', 'inside')).toEqual({
      parentId: 'a',
      index: 2,
    });
    expect(destinationForRow(documents, 'a2', 'a1', 'after')).toEqual({
      parentId: 'a',
      index: 1,
    });
  });

  it('uses narrow immediate edges and a small directional hysteresis', () => {
    expect(dropRegion(100, 32, 101)).toEqual({
      kind: 'edge',
      intent: 'before',
    });
    expect(dropRegion(100, 32, 131)).toEqual({ kind: 'edge', intent: 'after' });
    expect(dropRegion(100, 32, 110)).toEqual({ kind: 'middle' });
    expect(dropRegion(100, 32, 122)).toEqual({ kind: 'middle' });

    const middle = { kind: 'middle' } as const;
    expect(dropRegion(100, 32, 107, middle)).toEqual(middle);
    expect(dropRegion(100, 32, 106, middle)).toEqual({
      kind: 'edge',
      intent: 'before',
    });

    const before = { kind: 'edge', intent: 'before' } as const;
    expect(dropRegion(100, 32, 109, before)).toEqual(before);
    expect(dropRegion(100, 32, 111, before)).toEqual(middle);
  });
});
