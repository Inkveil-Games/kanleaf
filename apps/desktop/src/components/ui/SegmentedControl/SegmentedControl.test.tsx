import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

const options = [
  { value: 'all', label: 'All' },
  { value: 'paused', label: 'Paused', disabled: true },
  { value: 'unread', label: 'Unread' },
  { value: 'mentions', label: 'Mentions' },
] as const;

describe('SegmentedControl', () => {
  it('keeps keyboard selection and tooltips on icon choices', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="Task layout"
        value="list"
        options={[
          {
            value: 'list',
            label: <span>List view</span>,
            tooltip: 'List view',
          },
          {
            value: 'board',
            label: <span>Board view</span>,
            tooltip: 'Board view',
          },
        ]}
        onValueChange={onValueChange}
      />,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'List view' })).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('List view');
    await user.keyboard('{ArrowRight}');
    expect(onValueChange).toHaveBeenLastCalledWith('board');
    expect(screen.getByRole('button', { name: 'Board view' })).toHaveFocus();
  });

  it('uses one tab stop and selects enabled options with arrows, Home and End', async () => {
    const user = userEvent.setup();
    function Example() {
      const [value, setValue] =
        useState<(typeof options)[number]['value']>('all');
      return (
        <SegmentedControl
          aria-label="Notifications"
          value={value}
          options={options}
          onValueChange={setValue}
        />
      );
    }
    render(<Example />);
    const group = screen.getByRole('group', { name: 'Notifications' });
    const all = within(group).getByRole('button', { name: 'All' });
    const unread = within(group).getByRole('button', { name: 'Unread' });
    const mentions = within(group).getByRole('button', { name: 'Mentions' });
    expect(
      within(group).getByRole('button', { name: 'Paused' }),
    ).toBeDisabled();
    await user.tab();
    expect(all).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(unread).toHaveFocus();
    expect(unread).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('tabindex', '-1');
    await user.keyboard('{End}');
    expect(mentions).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(all).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(mentions).toHaveFocus();
    await user.keyboard('{Home}');
    expect(all).toHaveFocus();
    await user.click(unread);
    expect(unread).toHaveAttribute('aria-pressed', 'true');
  });

  it('disables the entire choice group while pending', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="Notifications"
        value="all"
        options={options}
        onValueChange={onValueChange}
        disabled
      />,
    );
    for (const button of screen.getAllByRole('button'))
      expect(button).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Unread' }));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
