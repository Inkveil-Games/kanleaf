import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { forwardRef } from 'react';
import './Switch.css';

export interface SwitchProps extends Omit<
  BaseSwitch.Root.Props,
  'children' | 'className' | 'nativeButton' | 'render'
> {
  className?: string;
}

export const Switch = forwardRef<HTMLElement, SwitchProps>(function Switch(
  { className, ...rootProps },
  ref,
) {
  return (
    <BaseSwitch.Root
      {...rootProps}
      ref={ref}
      className={`ui-switch${className ? ` ${className}` : ''}`}
      nativeButton
      render={<button type="button" />}
    >
      <BaseSwitch.Thumb className="ui-switch-thumb" />
    </BaseSwitch.Root>
  );
});
