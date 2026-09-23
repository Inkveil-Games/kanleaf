import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  SelectValueEditor,
  type SelectValueDraft,
} from '../settings/SelectValueEditor';

const option: SelectValueDraft = {
  key: 'option-high',
  id: 'option-high',
  name: 'High',
  color: '#EF4444',
  description: '',
};

describe('custom property SelectValueEditor', () => {
  it('edits and adds options through the shared option surface', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onOuterSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const { rerender } = render(
      <form onSubmit={onOuterSubmit}>
        <SelectValueEditor
          disabled={false}
          itemLabel="option"
          addLabel="Add option"
          values={[option]}
          onChange={onChange}
        />
      </form>,
    );

    await user.click(screen.getByRole('button', { name: 'Edit High' }));
    let editor = screen.getByRole('dialog', { name: 'Edit High' });
    fireEvent.change(
      within(editor).getByRole('textbox', { name: 'Option name' }),
      {
        target: { value: 'Urgent' },
      },
    );
    fireEvent.click(within(editor).getByRole('button', { name: 'Save value' }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'option-high', name: 'Urgent' }),
    ]);
    expect(within(editor).queryByText('Icon')).toBeNull();
    expect(within(editor).queryByRole('button', { name: /icon/i })).toBeNull();

    onChange.mockClear();
    rerender(
      <form onSubmit={onOuterSubmit}>
        <SelectValueEditor
          disabled={false}
          itemLabel="option"
          addLabel="Add option"
          values={[]}
          onChange={onChange}
        />
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add option' }));
    editor = screen.getByRole('dialog', { name: 'Add option' });
    fireEvent.change(
      within(editor).getByRole('textbox', { name: 'Option name' }),
      {
        target: { value: 'Medium' },
      },
    );
    fireEvent.click(within(editor).getByRole('button', { name: 'Add option' }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'Medium',
        color: '#64748B',
        description: '',
      }),
    ]);
    expect(onOuterSubmit).not.toHaveBeenCalled();
  });

  it('archives, restores, and confirms deletion of a persisted option', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <SelectValueEditor
        disabled={false}
        itemLabel="option"
        values={[option]}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit High' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Edit High' })).getByRole(
        'button',
        { name: 'Archive' },
      ),
    );
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'option-high', archived: true }),
    ]);

    onChange.mockClear();
    rerender(
      <SelectValueEditor
        disabled={false}
        itemLabel="option"
        values={[{ ...option, archived: true }]}
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
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for High' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Delete permanently' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete option' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
