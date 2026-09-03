import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  SelectOptionEditor,
  type SelectOptionDraft,
} from './SelectOptionEditor';

const option: SelectOptionDraft = {
  key: 'option-high',
  id: 'option-high',
  name: 'High',
  color: '#EF4444',
};

describe('SelectOptionEditor', () => {
  it('edits and adds options through the shared option surface', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SelectOptionEditor
        disabled={false}
        options={[option]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Option name' }), {
      target: { value: 'Urgent' },
    });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'option-high', name: 'Urgent' }),
    ]);

    onChange.mockClear();
    rerender(
      <SelectOptionEditor disabled={false} options={[]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add option' }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ name: '', color: '#64748B' }),
    ]);
  });

  it('archives, restores, and confirms deletion of a persisted option', () => {
    const onChange = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    const { rerender } = render(
      <SelectOptionEditor
        disabled={false}
        options={[option]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actions for High' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'option-high', archived: true }),
    ]);

    onChange.mockClear();
    rerender(
      <SelectOptionEditor
        disabled={false}
        options={[{ ...option, archived: true }]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Actions for High' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'option-high', archived: false }),
    ]);

    onChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for High' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Delete permanently' }),
    );
    expect(onChange).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for High' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Delete permanently' }),
    );
    expect(onChange).toHaveBeenCalledWith([]);
    expect(confirm).toHaveBeenLastCalledWith(
      'Delete High? It will be removed from every Task when you save.',
    );
  });
});
