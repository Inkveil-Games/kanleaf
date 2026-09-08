import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Check, Minus } from 'lucide-react';
import { forwardRef } from 'react';
import './Checkbox.css';

export interface CheckboxProps extends Omit<
  BaseCheckbox.Root.Props,
  'children' | 'className' | 'nativeButton' | 'render'
> {
  className?: string;
}

export const Checkbox = forwardRef<HTMLElement, CheckboxProps>(
  function Checkbox({ className, indeterminate = false, ...rootProps }, ref) {
    const IndicatorIcon = indeterminate ? Minus : Check;

    return (
      <BaseCheckbox.Root
        {...rootProps}
        ref={ref}
        className={`ui-checkbox${className ? ` ${className}` : ''}`}
        indeterminate={indeterminate}
        nativeButton
        render={<button type="button" />}
      >
        <BaseCheckbox.Indicator className="ui-checkbox-indicator" keepMounted>
          <IndicatorIcon aria-hidden="true" size={13} strokeWidth={2.5} />
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
    );
  },
);
