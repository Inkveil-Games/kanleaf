import { CircleHelp } from 'lucide-react';
import { FormField } from '../../components/ui/FormField';
import { IconButton } from '../../components/ui/IconButton';
import { Input } from '../../components/ui/Input';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Select } from '../../components/ui/Select';
import { Tooltip } from '../../components/ui/Tooltip';
import type { DateDefault } from '../workspace/types';

const MODES = [
  { value: 'none', label: 'None' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'dynamic', label: 'Dynamic' },
];
const OFFSETS = [
  { value: 'day-after', label: 'Days after', unit: 'day', direction: 'after' },
  {
    value: 'week-after',
    label: 'Weeks after',
    unit: 'week',
    direction: 'after',
  },
  {
    value: 'month-after',
    label: 'Months after',
    unit: 'month',
    direction: 'after',
  },
  {
    value: 'year-after',
    label: 'Years after',
    unit: 'year',
    direction: 'after',
  },
  {
    value: 'day-before',
    label: 'Days before',
    unit: 'day',
    direction: 'before',
  },
  {
    value: 'week-before',
    label: 'Weeks before',
    unit: 'week',
    direction: 'before',
  },
  {
    value: 'month-before',
    label: 'Months before',
    unit: 'month',
    direction: 'before',
  },
  {
    value: 'year-before',
    label: 'Years before',
    unit: 'year',
    direction: 'before',
  },
] as const;

export function DateDefaultEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: DateDefault | null;
  onChange: (value: DateDefault | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="date-default-editor">
      <div className="date-default-mode">
        <span className="ui-form-field-label">Default value</span>
        <SegmentedControl
          aria-label="Default value"
          value={value?.mode ?? 'none'}
          options={MODES}
          disabled={disabled}
          onValueChange={(mode) => {
            if (mode === (value?.mode ?? 'none')) return;
            onChange(
              mode === 'fixed'
                ? { mode: 'fixed', date: '' }
                : mode === 'dynamic'
                  ? {
                      mode: 'dynamic',
                      amount: 0,
                      unit: 'day',
                      direction: 'after',
                    }
                  : null,
            );
          }}
        />
      </div>
      {value?.mode === 'fixed' ? (
        <FormField label="Fixed date" required className="date-default-fixed">
          <Input
            type="date"
            value={value.date}
            disabled={disabled}
            onChange={(event) =>
              onChange({ mode: 'fixed', date: event.target.value })
            }
          />
        </FormField>
      ) : null}
      {value?.mode === 'dynamic' ? (
        <div className="date-default-offset">
          <FormField label="Offset amount" required>
            <Input
              type="number"
              min={0}
              max={4_294_967_295}
              step={1}
              value={Number.isFinite(value.amount) ? value.amount : ''}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...value, amount: event.target.valueAsNumber })
              }
            />
          </FormField>
          <FormField label="Offset">
            <Select
              ariaLabel="Offset"
              value={`${value.unit}-${value.direction}`}
              options={[...OFFSETS]}
              disabled={disabled}
              onValueChange={(offset) => {
                const next = OFFSETS.find(({ value }) => value === offset);
                if (next)
                  onChange({
                    ...value,
                    unit: next.unit,
                    direction: next.direction,
                  });
              }}
            />
          </FormField>
        </div>
      ) : null}
      <div className="date-default-help">
        <p className="settings-muted date-default-hint">
          {value?.mode === 'dynamic'
            ? 'Relative to the Task creation date.'
            : value?.mode === 'fixed'
              ? 'New Tasks start with this date.'
              : 'New Tasks start without a date.'}
        </p>
        <Tooltip
          label="Dynamic dates use the Task creation date in the creator’s time zone. Zero uses that day; short months use their last day."
          closeOnClick={false}
          trigger={
            <IconButton aria-label="How date defaults work" type="button">
              <CircleHelp aria-hidden="true" size={15} />
            </IconButton>
          }
        />
      </div>
    </div>
  );
}
