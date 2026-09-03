import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Blocks, Bug, CircleDot, Star } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { IconPicker, type IconPickerOption } from './IconPicker';

const options: IconPickerOption[] = [
  { key: 'circle-dot', label: 'Task', group: 'Work', icon: CircleDot },
  { key: 'bug', label: 'Bug', group: 'Work', icon: Bug },
  { key: 'star', label: 'Star', group: 'General', icon: Star },
];

describe('IconPicker', () => {
  it('searches and selects a stable icon key', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <IconPicker
        ariaLabel="Change icon for Task"
        dialogLabel="Task type icons"
        fallbackIcon={Blocks}
        options={options}
        value="circle-dot"
        onChange={onChange}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Change icon for Task' }),
    );
    await user.type(screen.getByRole('searchbox', { name: 'Search icons' }), 'bug');
    await user.click(screen.getByRole('button', { name: 'Bug' }));

    expect(onChange).toHaveBeenCalledWith('bug');
  });

  it('supports grid keyboard movement and restores focus on Escape', async () => {
    const user = userEvent.setup();
    render(
      <IconPicker
        ariaLabel="Choose icon"
        dialogLabel="Available icons"
        fallbackIcon={Blocks}
        options={options}
        value="circle-dot"
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Choose icon' });
    await user.click(trigger);
    const search = screen.getByRole('searchbox', { name: 'Search icons' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: 'Task' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Bug' })).toHaveFocus();
    await user.keyboard('[Escape]');

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Available icons' }),
      ).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it('renders the fallback for an unknown key and respects disabled', () => {
    render(
      <IconPicker
        ariaLabel="Choose icon"
        dialogLabel="Available icons"
        disabled
        fallbackIcon={Blocks}
        options={options}
        value="legacy-unknown"
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Choose icon' });
    expect(trigger).toBeDisabled();
    expect(trigger.querySelector('.lucide-blocks')).not.toBeNull();
  });
});
