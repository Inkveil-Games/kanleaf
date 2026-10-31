import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { chooseSelectOption } from '../../test/select';
import { TaskRepeatControl } from './TaskRepeatControl';

const recurrence = {
  frequency: 'weekly' as const,
  weekdays: [1],
  month_day: null,
  time: '07:00',
  mode: 'schedule' as const,
  action: 'duplicate' as const,
  timezone: 'UTC',
  next_run_at: '2026-11-09T07:00:00Z',
  paused_at: null,
};

describe('TaskRepeatControl', () => {
  it('edits weekdays, time and mode, then saves one rule', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockResolvedValue(true);
    render(
      <TaskRepeatControl
        recurrence={recurrence}
        readOnly={false}
        saving={false}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Edit repeat' });
    expect(trigger).toHaveTextContent('Every Monday at 07:00');
    expect(trigger).toHaveTextContent('Next Mon, Nov 9');
    await user.click(trigger);

    const days = await screen.findByRole('group', { name: 'Repeat on' });
    expect(
      within(days).getByRole('button', { name: 'Monday' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(days).getByRole('button', { name: 'Friday' }));
    await user.click(within(days).getByRole('button', { name: 'Monday' }));
    await user.click(within(days).getByRole('button', { name: 'Friday' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText('Choose at least one day')).toBeInTheDocument();
    await user.click(within(days).getByRole('button', { name: 'Wednesday' }));

    expect(screen.getByText('Every Wednesday at 07:00')).toBeInTheDocument();
    await chooseSelectOption('Repeat time', '18:30');
    await chooseSelectOption('Repeat when', 'When this is done');
    await user.click(screen.getByRole('button', { name: 'Reset task' }));
    expect(
      screen.getByText(/This Task reopens with its checklists unchecked/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onChange).toHaveBeenCalledWith({
      frequency: 'weekly',
      weekdays: [3],
      month_day: null,
      time: '18:30',
      mode: 'after_completion',
      action: 'reset',
    });
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Repeat on' })).toBeNull(),
    );
  });

  it('switches frequency without leaking incompatible fields and removes repeats', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockResolvedValue(true);
    render(
      <TaskRepeatControl
        recurrence={recurrence}
        readOnly={false}
        saving={false}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Edit repeat' }));
    await user.click(await screen.findByRole('button', { name: 'Monthly' }));
    const day = screen.getByLabelText('Day of month');
    await user.clear(day);
    await user.type(day, '31');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onChange).toHaveBeenLastCalledWith({
      frequency: 'monthly',
      weekdays: [],
      month_day: 31,
      time: '07:00',
      mode: 'schedule',
      action: 'duplicate',
    });

    await user.click(screen.getByRole('button', { name: 'Edit repeat' }));
    await user.click(
      await screen.findByRole('button', { name: 'Remove repeat' }),
    );
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('keeps the editor open when saving fails and is read-only without edit access', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockResolvedValue(false);
    const { rerender } = render(
      <TaskRepeatControl
        recurrence={null}
        readOnly={false}
        saving={false}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Edit repeat' });
    expect(trigger).toHaveTextContent('No repeat');
    await user.click(trigger);
    expect(screen.queryByRole('button', { name: 'Remove repeat' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('group', { name: 'Repeat on' }),
    ).toBeInTheDocument();

    rerender(
      <TaskRepeatControl
        recurrence={{ ...recurrence, paused_at: '2026-11-02T00:00:00Z' }}
        readOnly
        saving={false}
        onChange={onChange}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Edit repeat' })).toBeNull();
    expect(
      screen.getByText('Every Monday at 07:00 · Paused'),
    ).toBeInTheDocument();
  });
});
