import { Select as BaseSelect } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useFormFieldControl } from './FormField/FormFieldContext';
import { popupPortalContainer } from './popupPortal';
import { Tooltip } from './Tooltip';

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
  description?: string;
  disabled?: boolean;
}

interface SelectProps {
  ariaLabel: string;
  id?: string;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  startIcon?: ReactNode;
  triggerTooltip?: string;
}

export function Select({
  ariaLabel,
  id,
  value,
  options,
  onValueChange,
  disabled = false,
  invalid = false,
  className,
  startIcon,
  triggerTooltip,
}: SelectProps) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const selected = options.find((option) => option.value === value);
  const field = useFormFieldControl({ id, invalid });
  const trigger = (
    <BaseSelect.Trigger
      ref={(element) => {
        setPortalContainer(popupPortalContainer(element));
      }}
      className="select-trigger"
      id={field.id}
      aria-label={ariaLabel}
      aria-describedby={field.describedBy}
      aria-invalid={field.ariaInvalid}
      data-value={value}
    >
      {startIcon ? (
        <span className="select-start-icon" aria-hidden="true">
          {startIcon}
        </span>
      ) : null}
      <BaseSelect.Value className="select-value">
        {selected?.label ?? ''}
      </BaseSelect.Value>
      <BaseSelect.Icon className="select-chevron">
        <ChevronDown aria-hidden="true" size={14} />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );

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
        {triggerTooltip ? (
          <Tooltip label={triggerTooltip} trigger={trigger} />
        ) : (
          trigger
        )}
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
      {option.icon ? (
        <span className="select-option-icon" aria-hidden="true">
          {option.icon}
        </span>
      ) : null}
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
