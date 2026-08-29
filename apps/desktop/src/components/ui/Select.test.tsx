import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';

const options = [
  { value: 'todo', label: 'Todo' },
  { value: 'started', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

describe('Select', () => {
  it('selects an option and closes the listbox', () => {
    const onValueChange = vi.fn();
    render(
      <Select
        ariaLabel="State"
        value="todo"
        options={options}
        onValueChange={onValueChange}
      />,
    );

    fireEvent.click(screen.getByRole('combobox', { name: 'State' }));
    fireEvent.click(screen.getByRole('option', { name: 'In progress' }));

    expect(onValueChange).toHaveBeenCalledWith('started');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'State' })).toHaveFocus();
  });

  it('supports arrow keys and Escape', () => {
    render(
      <Select
        ariaLabel="State"
        value="todo"
        options={options}
        onValueChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'State' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'Todo' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: 'In progress' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes after a pointer press outside', () => {
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

    fireEvent.click(screen.getByRole('combobox', { name: 'State' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes when keyboard focus leaves the listbox', () => {
    render(
      <div>
        <Select
          ariaLabel="State"
          value="todo"
          options={options}
          onValueChange={vi.fn()}
        />
        <button type="button">Next control</button>
      </div>,
    );

    fireEvent.click(screen.getByRole('combobox', { name: 'State' }));
    fireEvent.blur(screen.getByRole('option', { name: 'Todo' }), {
      relatedTarget: screen.getByRole('button', { name: 'Next control' }),
    });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('keeps its popover inside a top-layer dialog', () => {
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

    fireEvent.click(screen.getByRole('combobox', { name: 'State' }));
    expect(screen.getByRole('listbox').closest('dialog')).not.toBeNull();
  });
});
