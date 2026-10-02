import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '../Button';
import { Tooltip } from '../Tooltip';
import './SegmentedControl.css';

export interface SegmentedControlOption<Value extends string> {
  value: Value;
  label: ReactNode;
  disabled?: boolean;
  tooltip?: string;
}

export interface SegmentedControlProps<Value extends string> {
  value: Value;
  options: readonly SegmentedControlOption<Value>[];
  onValueChange: (value: Value) => void;
  'aria-label': string;
  disabled?: boolean;
  className?: string;
}

export function SegmentedControl<Value extends string>({
  value,
  options,
  onValueChange,
  'aria-label': ariaLabel,
  disabled = false,
  className,
}: SegmentedControlProps<Value>) {
  const buttons = useRef(new Map<Value, HTMLButtonElement>());
  const enabled = options.filter((option) => !disabled && !option.disabled);
  const tabValue =
    enabled.find((option) => option.value === value)?.value ??
    enabled[0]?.value;

  function move(event: KeyboardEvent<HTMLButtonElement>, current: Value) {
    if (
      ![
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    const index = enabled.findIndex((option) => option.value === current);
    const direction =
      event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? enabled.length - 1
          : (index + direction + enabled.length) % enabled.length;
    const next = enabled[nextIndex];
    if (!next) return;
    onValueChange(next.value);
    buttons.current.get(next.value)?.focus();
  }

  return (
    <div
      className={`ui-segmented-control${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const button = (
          <Button
            key={option.value}
            ref={(button) => {
              if (button) buttons.current.set(option.value, button);
              else buttons.current.delete(option.value);
            }}
            variant="ghost"
            size="sm"
            disabled={disabled || option.disabled}
            aria-pressed={value === option.value}
            tabIndex={tabValue === option.value ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => move(event, option.value)}
          >
            {option.label}
          </Button>
        );
        return option.tooltip ? (
          <Tooltip key={option.value} label={option.tooltip} trigger={button} />
        ) : (
          button
        );
      })}
    </div>
  );
}
