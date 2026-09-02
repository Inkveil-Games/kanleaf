import { Select as BaseSelect } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface SelectProps {
  ariaLabel: string;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export function Select({
  ariaLabel,
  value,
  options,
  onValueChange,
  disabled = false,
  className,
}: SelectProps) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const selected = options.find((option) => option.value === value);

  return (
    <div className={`kanleaf-select${className ? ` ${className}` : ''}`}>
      <BaseSelect.Root
        value={value}
        disabled={disabled}
        modal={false}
        items={options}
        onValueChange={(nextValue) => {
          if (nextValue !== null) onValueChange(nextValue);
        }}
      >
        <BaseSelect.Trigger
          ref={(element) => {
            setPortalContainer(
              element?.closest<HTMLElement>('dialog') ?? document.body,
            );
          }}
          className="select-trigger"
          aria-label={ariaLabel}
          data-value={value}
        >
          <BaseSelect.Value className="select-value">
            {selected?.label ?? ''}
          </BaseSelect.Value>
          <BaseSelect.Icon className="select-chevron">
            <ChevronDown aria-hidden="true" size={14} />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal container={portalContainer}>
          <BaseSelect.Positioner
            className="select-positioner"
            align="start"
            alignItemWithTrigger={false}
            collisionPadding={8}
            sideOffset={4}
          >
            <BaseSelect.Popup className="select-popover">
              <BaseSelect.List>
                {options.map((option) => (
                  <SelectOptionItem key={option.value} option={option} />
                ))}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
    </div>
  );
}

function SelectOptionItem({ option }: { option: SelectOption }) {
  const descriptionId = useId();

  return (
    <BaseSelect.Item
      className="select-option"
      value={option.value}
      aria-label={option.label}
      aria-describedby={option.description ? descriptionId : undefined}
      disabled={option.disabled}
      nativeButton
      render={<button type="button" />}
    >
      <BaseSelect.ItemText className="select-option-copy">
        <span>{option.label}</span>
        {option.description ? (
          <small id={descriptionId}>{option.description}</small>
        ) : null}
      </BaseSelect.ItemText>
      <BaseSelect.ItemIndicator>
        <Check aria-hidden="true" size={14} />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  );
}
