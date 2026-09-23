import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SelectValueEditor, type SelectValueDraft } from './SelectValueEditor';

const todo: SelectValueDraft = {
  key: 'todo',
  id: 'todo',
  name: 'Todo',
  color: '#64748B',
  description: 'Ready to be worked on.',
};

describe('SelectValueEditor', () => {
  it('keeps values readable in the list and applies edits from the popover', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EditorHarness initialValues={[todo]} onChange={onChange} />);

    expect(screen.getByText('Todo')).toBeVisible();
    expect(screen.getByText('Ready to be worked on.')).toBeVisible();
    expect(screen.queryByText('Icon')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /icon/i })).toBeNull();
    expect(
      screen.queryByRole('textbox', { name: 'Value name' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit Todo' }));
    const editor = screen.getByRole('dialog', { name: 'Edit Todo' });
    const name = within(editor).getByRole('textbox', { name: 'Value name' });
    await user.clear(name);
    await user.type(name, 'Next up');

    expect(screen.getByText('Todo')).toBeVisible();
    await user.click(
      within(editor).getByRole('button', { name: 'Save value' }),
    );

    expect(screen.getByText('Next up')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'Edit Todo' })).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ key: 'todo', name: 'Next up' }),
    ]);
  });

  it('adds a value only after the popover is saved', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EditorHarness initialValues={[todo]} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Add value' }));
    let editor = screen.getByRole('dialog', { name: 'Add value' });
    await user.type(
      within(editor).getByRole('textbox', { name: 'Value name' }),
      'In progress',
    );
    await user.click(within(editor).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('In progress')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Add value' })).toBeNull(),
    );

    await user.click(screen.getByRole('button', { name: 'Add value' }));
    editor = screen.getByRole('dialog', { name: 'Add value' });
    await user.type(
      within(editor).getByRole('textbox', { name: 'Value name' }),
      'In progress',
    );
    await user.type(
      within(editor).getByRole('textbox', { name: 'Value description' }),
      'Work underway.',
    );
    await user.click(within(editor).getByRole('button', { name: 'Add value' }));

    const values = screen.getByRole('list');
    expect(within(values).getByText('In progress')).toBeVisible();
    expect(within(values).getByText('Work underway.')).toBeVisible();
    expect(onChange).toHaveBeenCalledOnce();
  });
});

function EditorHarness({
  initialValues,
  onChange,
}: {
  initialValues: SelectValueDraft[];
  onChange: (values: SelectValueDraft[]) => void;
}) {
  const [values, setValues] = useState(initialValues);

  return (
    <SelectValueEditor
      disabled={false}
      values={values}
      onChange={(nextValues) => {
        onChange(nextValues);
        setValues(nextValues);
      }}
    />
  );
}
