import { describe, expect, it } from 'vitest';
import {
  defaultRecurrenceRule,
  describeNextRun,
  describeRecurrence,
} from './taskRecurrence';

const weekly = {
  frequency: 'weekly' as const,
  weekdays: [1],
  month_day: null,
  time: '07:00',
  mode: 'schedule' as const,
  action: 'duplicate' as const,
};

describe('task recurrence presentation', () => {
  it('describes cadence and timing compactly', () => {
    expect(describeRecurrence(weekly)).toBe('Every Monday at 07:00');
    expect(describeRecurrence({ ...weekly, weekdays: [1, 3, 5] })).toBe(
      'Every Mon, Wed, Fri at 07:00',
    );
    expect(describeRecurrence({ ...weekly, weekdays: [5, 4, 3, 2, 1] })).toBe(
      'Weekdays at 07:00',
    );
    expect(
      describeRecurrence({ ...weekly, weekdays: [1, 2, 3, 4, 5, 6, 7] }),
    ).toBe('Every day at 07:00');
    expect(
      describeRecurrence({ ...weekly, frequency: 'daily', weekdays: [] }),
    ).toBe('Every day at 07:00');
    expect(
      describeRecurrence({
        ...weekly,
        frequency: 'monthly',
        weekdays: [],
        month_day: 31,
        mode: 'after_completion',
      }),
    ).toBe('Monthly on day 31 after completion');
  });

  it('shows the next run in the rule timezone, or why there is none', () => {
    const recurrence = {
      ...weekly,
      timezone: 'Asia/Ho_Chi_Minh',
      next_run_at: '2026-11-08T23:30:00Z',
      paused_at: null,
    };
    expect(describeNextRun(recurrence, 'en-US')).toBe('Next Mon, Nov 9');
    expect(
      describeNextRun({ ...recurrence, paused_at: '2026-11-01T00:00:00Z' }),
    ).toBe('Paused');
    expect(describeNextRun({ ...recurrence, mode: 'after_completion' })).toBe(
      'Next Task when done',
    );
    expect(describeNextRun({ ...recurrence, action: 'reset' }, 'en-US')).toBe(
      'Resets Mon, Nov 9',
    );
    expect(
      describeNextRun({
        ...recurrence,
        action: 'reset',
        mode: 'after_completion',
      }),
    ).toBe('Resets when done');
  });

  it('defaults to a weekly repeat on the current weekday', () => {
    expect(defaultRecurrenceRule(new Date(2026, 10, 1)).weekdays).toEqual([7]);
    expect(defaultRecurrenceRule(new Date(2026, 10, 2)).weekdays).toEqual([1]);
  });
});
