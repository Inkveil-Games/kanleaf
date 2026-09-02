import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';

const options = [
  { value: 'todo', label: 'Todo' },
  { value: 'started', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

describe('Select', () => {
  it('selects an option and closes the listbox', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Select
        ariaLabel="State"
        value="todo"
        options={options}
        onValueChange={onValueChange}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'State' }));
    await user.click(screen.getByRole('option', { name: 'In progress' }));

    expect(onValueChange).toHaveBeenCalledWith('started');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'State' })).toHaveFocus();
  });

  it('supports arrow keys and Escape', async () => {
    const user = userEvent.setup();
    render(
      <Select
        ariaLabel="State"
        value="todo"
        options={options}
        onValueChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'State' });
    trigger.focus();
    await user.keyboard('[ArrowDown]');
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Todo' })).toHaveFocus(),
    );

    await user.keyboard('[ArrowDown]');
    expect(screen.getByRole('option', { name: 'In progress' })).toHaveFocus();

    await user.keyboard('[Escape]');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('supports typeahead selection without custom feature logic', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Select
        ariaLabel="State"
        value="todo"
        options={options}
        onValueChange={onValueChange}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'State' });
    trigger.focus();
    await user.keyboard('[ArrowDown]d[Enter]');

    expect(onValueChange).toHaveBeenCalledWith('done');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes after a pointer press outside', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Select
          ariaLabel="State"
          value="todo"
          options={options}
          onValueChange={vi.fn()}
        />
        <button type="button">Outside</button>
      </div>,
    );

    await user.click(screen.getByRole('combobox', { name: 'State' }));
    const outside = screen.getByRole('button', { name: 'Outside' });
    fireEvent.pointerDown(outside);
    fireEvent.mouseDown(outside);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('keeps its popover inside a top-layer dialog', async () => {
    const user = userEvent.setup();
    render(
      <dialog open>
        <Select
          ariaLabel="State"
          value="todo"
          options={options}
          onValueChange={vi.fn()}
        />
      </dialog>,
    );

    await user.click(screen.getByRole('combobox', { name: 'State' }));
    expect(screen.getByRole('listbox').closest('dialog')).not.toBeNull();
  });

  it('exposes option descriptions to assistive technology', async () => {
    const user = userEvent.setup();
    render(
      <Select
        ariaLabel="Visibility"
        value="private"
        options={[
          {
            value: 'private',
            label: 'Private',
            description: 'Only invited members can open this Project.',
          },
          {
            value: 'public',
            label: 'Public',
            description: 'Every Workspace member can open this Project.',
          },
        ]}
        onValueChange={vi.fn()}
      />,
    );

    screen.getByRole('combobox', { name: 'Visibility' }).focus();
    await user.keyboard('[ArrowDown]');
    expect(
      screen.getByRole('option', { name: 'Private' }),
    ).toHaveAccessibleDescription(
      'Only invited members can open this Project.',
    );
  });
});
