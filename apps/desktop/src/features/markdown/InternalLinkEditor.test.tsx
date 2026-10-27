import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InternalLinkEditor } from './InternalLinkEditor';
import type { InternalLinkEdit } from './internalLinkController';
import { createInternalLinkIndex } from './internalLinks';

const index = createInternalLinkIndex([
  {
    kind: 'page',
    id: 'source',
    title: 'Source test',
    path: 'library/source_test',
    hint: 'Library',
    projectId: null,
  },
  {
    kind: 'task',
    id: 'task-42',
    title: 'Đổi tên vault',
    path: 'tasks/42',
    hint: '#42',
    projectId: null,
  },
]);

function renderEditor(raw: string) {
  const edit: InternalLinkEdit = {
    raw,
    rect: { left: 10, top: 10, bottom: 30 },
    setRaw: vi.fn(),
    dismiss: vi.fn(),
  };
  const onOpen = vi.fn();
  const onClose = vi.fn();
  render(
    <InternalLinkEditor
      edit={edit}
      index={index}
      onOpen={onOpen}
      onClose={onClose}
    />,
  );
  return { edit, onOpen, onClose };
}

describe('InternalLinkEditor', () => {
  it('edits the display text and keeps the Obsidian target', () => {
    const { edit, onClose } = renderEditor('[[source_test|ghi chú Source]]');
    const input = screen.getByLabelText('Display text');
    expect(input).toHaveFocus();
    expect(input).toHaveValue('ghi chú Source');

    fireEvent.change(input, { target: { value: 'Ghi chú cho Source' } });
    fireEvent.submit(input);

    expect(edit.setRaw).toHaveBeenCalledWith(
      '[[source_test|Ghi chú cho Source]]',
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('drops the alias when the display text is cleared', () => {
    const { edit } = renderEditor('[[source_test|old]]');
    const input = screen.getByLabelText('Display text');
    expect(input).toHaveAttribute('placeholder', 'Source test');

    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.submit(input);

    expect(edit.setRaw).toHaveBeenCalledWith('[[source_test]]');
  });

  it('retargets the link from suggestions and drops the old heading', () => {
    const { edit } = renderEditor('[[source_test#Plan|notes]]');
    const target = screen.getByRole('combobox', { name: 'Link to' });
    expect(target).toHaveValue('Source test');

    fireEvent.change(target, { target: { value: 'doi ten' } });
    expect(
      screen.getByRole('option', { name: /Đổi tên vault/ }),
    ).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(target, { key: 'Enter' });
    expect(edit.setRaw).not.toHaveBeenCalled();
    expect(target).toHaveValue('Đổi tên vault');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.submit(target);
    expect(edit.setRaw).toHaveBeenCalledWith('[[42|notes]]');
  });

  it('closes only the suggestion list on the first Escape', () => {
    const { onClose } = renderEditor('[[source_test]]');
    const target = screen.getByRole('combobox', { name: 'Link to' });

    fireEvent.keyDown(target, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(target, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('opens, unlinks and cancels without changing the link', () => {
    const { edit, onOpen, onClose } = renderEditor('[[source_test]]');

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith('[[source_test]]');

    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    expect(edit.setRaw).toHaveBeenCalledWith(null);

    fireEvent.keyDown(screen.getByLabelText('Display text'), {
      key: 'Escape',
    });
    expect(edit.dismiss).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
