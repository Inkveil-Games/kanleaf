import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Popover } from '../../components/ui/Popover';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Select } from '../../components/ui/Select';
import type {
  TaskRecurrence,
  TaskRecurrenceAction,
  TaskRecurrenceFrequency,
  TaskRecurrenceMode,
  TaskRecurrenceRule,
} from '../workspace/types';
import {
  RECURRENCE_WEEKDAYS,
  defaultRecurrenceRule,
  describeNextRun,
  describeRecurrence,
  recurrenceRule,
} from './taskRecurrence';

const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
] as const satisfies ReadonlyArray<{
  value: TaskRecurrenceFrequency;
  label: string;
}>;

const MODE_OPTIONS: { value: TaskRecurrenceMode; label: string }[] = [
  { value: 'schedule', label: 'On each date' },
  { value: 'after_completion', label: 'When this is done' },
];

const ACTION_OPTIONS = [
  { value: 'duplicate', label: 'New copy' },
  { value: 'reset', label: 'Reset task' },
] as const satisfies ReadonlyArray<{
  value: TaskRecurrenceAction;
  label: string;
}>;

const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const value = `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`;
  return { value, label: value };
});

export function TaskRepeatControl({
  recurrence,
  readOnly,
  saving,
  onChange,
}: {
  recurrence: TaskRecurrence | null | undefined;
  readOnly: boolean;
  saving: boolean;
  onChange: (rule: TaskRecurrenceRule | null) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TaskRecurrenceRule>(() =>
    recurrence ? recurrenceRule(recurrence) : defaultRecurrenceRule(new Date()),
  );
  const summary = recurrence ? describeRecurrence(recurrence) : 'No repeat';
  const next = recurrence ? describeNextRun(recurrence) : null;

  if (readOnly) {
    return (
      <span className="property-readonly-value">
        {summary}
        {next ? ` · ${next}` : ''}
      </span>
    );
  }

  function openChange(nextOpen: boolean) {
    if (nextOpen) {
      setDraft(
        recurrence
          ? recurrenceRule(recurrence)
          : defaultRecurrenceRule(new Date()),
      );
    }
    setOpen(nextOpen);
  }

  function changeFrequency(frequency: TaskRecurrenceFrequency) {
    setDraft((current) => ({
      ...current,
      frequency,
      weekdays:
        frequency === 'weekly'
          ? current.weekdays.length > 0
            ? current.weekdays
            : defaultRecurrenceRule(new Date()).weekdays
          : [],
      month_day:
        frequency === 'monthly'
          ? (current.month_day ?? new Date().getDate())
          : null,
    }));
  }

  function toggleWeekday(day: number) {
    setDraft((current) => ({
      ...current,
      weekdays: current.weekdays.includes(day)
        ? current.weekdays.filter((value) => value !== day)
        : [...current.weekdays, day].sort((left, right) => left - right),
    }));
  }

  async function save(rule: TaskRecurrenceRule | null) {
    if (await onChange(rule)) setOpen(false);
  }

  const monthDayValid =
    draft.frequency !== 'monthly' ||
    (draft.month_day !== null &&
      Number.isInteger(draft.month_day) &&
      draft.month_day >= 1 &&
      draft.month_day <= 31);
  const valid =
    /^\d{2}:\d{2}$/.test(draft.time) &&
    (draft.frequency !== 'weekly' || draft.weekdays.length > 0) &&
    monthDayValid;

  const timeOptions = TIME_OPTIONS.some(({ value }) => value === draft.time)
    ? TIME_OPTIONS
    : [{ value: draft.time, label: draft.time }, ...TIME_OPTIONS];

  return (
    <Popover
      label="Edit repeat"
      className="task-repeat-picker"
      align="start"
      disabled={saving}
      open={open}
      onOpenChange={openChange}
      trigger={
        <span className="task-repeat-summary">
          <span>{summary}</span>
          {next ? <span className="task-repeat-next">{next}</span> : null}
        </span>
      }
    >
      <div className="task-repeat-editor">
        <p className="task-repeat-preview" aria-live="polite">
          {valid
            ? describeRecurrence(draft)
            : monthDayValid
              ? 'Choose at least one day'
              : 'Choose a day from 1 to 31'}
        </p>
        <div className="task-repeat-fields">
          <div className="task-repeat-field">
            <span aria-hidden="true">Repeat</span>
            <SegmentedControl
              aria-label="Repeat frequency"
              value={draft.frequency}
              options={FREQUENCY_OPTIONS}
              onValueChange={changeFrequency}
            />
          </div>
          {draft.frequency === 'weekly' ? (
            <div className="task-repeat-field">
              <span aria-hidden="true">On</span>
              <div
                className="task-repeat-weekdays"
                role="group"
                aria-label="Repeat on"
              >
                {RECURRENCE_WEEKDAYS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    aria-label={day.label}
                    aria-pressed={draft.weekdays.includes(day.value)}
                    onClick={() => toggleWeekday(day.value)}
                  >
                    {day.short.charAt(0)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {draft.frequency === 'monthly' ? (
            <label className="task-repeat-field">
              <span>Day</span>
              <span className="task-repeat-month-day">
                <Input
                  aria-label="Day of month"
                  type="number"
                  min={1}
                  max={31}
                  value={draft.month_day ?? ''}
                  aria-invalid={!monthDayValid || undefined}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      month_day: event.target.value
                        ? Number(event.target.value)
                        : null,
                    }))
                  }
                />
                <span>of each month</span>
              </span>
            </label>
          ) : null}
          <div className="task-repeat-field">
            <span>At</span>
            <Select
              ariaLabel="Repeat time"
              value={draft.time}
              options={timeOptions}
              onValueChange={(time) =>
                setDraft((current) => ({ ...current, time }))
              }
            />
          </div>
          <div className="task-repeat-field">
            <span>When</span>
            <Select
              ariaLabel="Repeat when"
              value={draft.mode}
              options={MODE_OPTIONS}
              onValueChange={(value) => {
                const mode = MODE_OPTIONS.find(
                  (option) => option.value === value,
                )?.value;
                if (mode) setDraft((current) => ({ ...current, mode }));
              }}
            />
          </div>
          <div className="task-repeat-field">
            <span aria-hidden="true">Then</span>
            <SegmentedControl
              aria-label="Repeat action"
              value={draft.action}
              options={ACTION_OPTIONS}
              onValueChange={(action) =>
                setDraft((current) => ({ ...current, action }))
              }
            />
          </div>
        </div>
        <p className="task-repeat-hint">
          {draft.action === 'reset'
            ? 'This Task reopens with its checklists unchecked and its dates moved forward.'
            : 'Each copy is a new Task that starts with its checklists unchecked.'}
        </p>
        <div className="task-repeat-actions">
          {recurrence ? (
            <Button
              variant="text"
              size="sm"
              disabled={saving}
              onClick={() => void save(null)}
            >
              Remove repeat
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            disabled={!valid}
            loading={saving}
            loadingLabel="Saving…"
            onClick={() => void save(draft)}
          >
            Save
          </Button>
        </div>
      </div>
    </Popover>
  );
}
