import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentTree } from './DocumentTree';
import { buildSections } from './tree';
import type { WorkspaceDocument } from './types';

const note: WorkspaceDocument = {
  id: 'note-1',
  document_number: 1,
  workspace_id: 'workspace-1',
  project_id: null,
  parent_id: null,
  title: 'Research',
  storage_name: 'note-1',
  library_path: 'Wiki/note-1.md',
  position: 0,
  can_edit: true,
  archived_at: null,
  created_at: '2026-10-03T00:00:00Z',
  updated_at: '2026-10-03T00:00:00Z',
};

function renderTree(
  overrides: Partial<ComponentProps<typeof DocumentTree>> = {},
) {
  const props: ComponentProps<typeof DocumentTree> = {
    sections: buildSections([note], [], null),
    documents: [note],
    projectId: null,
    selectedId: note.id,
    collapsedIds: new Set(),
    creatingParentId: undefined,
    renamingId: note.id,
    canCreate: true,
    loading: false,
    error: null,
    actionError: null,
    busyIds: new Set(),
    onSelect: vi.fn(),
    onToggleCollapsed: vi.fn(),
    onStartCreate: vi.fn(),
    onCancelCreate: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onStartRename: vi.fn(),
    onCancelRename: vi.fn(),
    onRename: vi.fn().mockResolvedValue(undefined),
    onMove: vi.fn().mockResolvedValue(undefined),
    onKeepExpanded: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<DocumentTree {...props} />);
  return props;
}

describe('DocumentTree inline forms', () => {
  it('keeps a failed rename draft and blocks pending cancellation', async () => {
    let rejectRename: (error: Error) => void = () => undefined;
    const onRename = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectRename = reject;
        }),
    );
    const props = renderTree({ onRename });
    const input = screen.getByRole('textbox', { name: 'Note title' });
    fireEvent.change(input, { target: { value: 'Research notes' } });
    const form = input.closest('form');
    if (!form) throw new Error('Expected note form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onRename).toHaveBeenCalledExactlyOnceWith(
      'note-1',
      'Research notes',
    );
    expect(props.onCancelRename).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('readonly');
    await act(async () => rejectRename(new Error('Note name already exists')));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Note name already exists',
    );
    expect(input).toHaveValue('Research notes');
    expect(input).not.toHaveAttribute('readonly');
  });

  it('keeps text-editing keys from moving the selected tree note', () => {
    const props = renderTree();
    const input = screen.getByRole('textbox', { name: 'Note title' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'F2' });
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onStartRename).not.toHaveBeenCalled();
  });
});
