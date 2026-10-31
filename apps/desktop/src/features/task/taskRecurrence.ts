import type { TaskRecurrence, TaskRecurrenceRule } from '../workspace/types';

export const RECURRENCE_WEEKDAYS = [
  { value: 1, short: 'Mon', label: 'Monday' },
  { value: 2, short: 'Tue', label: 'Tuesday' },
  { value: 3, short: 'Wed', label: 'Wednesday' },
  { value: 4, short: 'Thu', label: 'Thursday' },
  { value: 5, short: 'Fri', label: 'Friday' },
  { value: 6, short: 'Sat', label: 'Saturday' },
  { value: 7, short: 'Sun', label: 'Sunday' },
] as const;

export function defaultRecurrenceRule(today: Date): TaskRecurrenceRule {
  return {
    frequency: 'weekly',
    weekdays: [isoWeekday(today)],
    month_day: null,
    time: '09:00',
    mode: 'schedule',
    action: 'duplicate',
  };
}

export function recurrenceRule(
  recurrence: TaskRecurrenceRule,
): TaskRecurrenceRule {
  return {
    frequency: recurrence.frequency,
    weekdays: [...recurrence.weekdays],
    month_day: recurrence.month_day,
    time: recurrence.time,
    mode: recurrence.mode,
    action: recurrence.action,
  };
}

export function describeRecurrence(rule: TaskRecurrenceRule) {
  const cadence = describeCadence(rule);
  const timing =
    rule.mode === 'after_completion' ? 'after completion' : `at ${rule.time}`;
  return `${cadence} ${timing}`;
}

export function describeNextRun(recurrence: TaskRecurrence, locale?: string) {
  if (recurrence.paused_at) return 'Paused';
  const reset = recurrence.action === 'reset';
  if (recurrence.mode === 'after_completion') {
    return reset ? 'Resets when done' : 'Next Task when done';
  }
  const formatter = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: recurrence.timezone,
  });
  const date = formatter.format(new Date(recurrence.next_run_at));
  return reset ? `Resets ${date}` : `Next ${date}`;
}

function describeCadence(rule: TaskRecurrenceRule) {
  if (rule.frequency === 'daily') return 'Every day';
  if (rule.frequency === 'monthly') return `Monthly on day ${rule.month_day}`;
  const days = [...rule.weekdays].sort((left, right) => left - right);
  if (days.length === 7) return 'Every day';
  if (days.join() === '1,2,3,4,5') return 'Weekdays';
  if (days.length === 1) {
    const day = RECURRENCE_WEEKDAYS.find(({ value }) => value === days[0]);
    return `Every ${day?.label ?? 'week'}`;
  }
  return `Every ${days
    .map(
      (value) =>
        RECURRENCE_WEEKDAYS.find((day) => day.value === value)?.short ?? '',
    )
    .join(', ')}`;
}

function isoWeekday(date: Date) {
  return ((date.getDay() + 6) % 7) + 1;
}
