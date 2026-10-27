import { describe, expect, it } from 'vitest';
import { buildSections, descendantIds, visibleSections } from './tree';
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

describe('Library tree', () => {
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
