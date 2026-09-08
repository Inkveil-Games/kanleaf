import { forwardRef } from 'react';
import { Button, type ButtonProps, type ButtonVariant } from '../Button';
import './IconButton.css';

export interface IconButtonProps extends Omit<
  ButtonProps,
  'aria-label' | 'variant'
> {
  'aria-label': string;
  variant?: ButtonVariant;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { variant = 'ghost', size = 'sm', className, ...buttonProps },
    ref,
  ) {
    return (
      <Button
        {...buttonProps}
        ref={ref}
        className={`ui-icon-button${className ? ` ${className}` : ''}`}
        variant={variant}
        size={size}
      />
    );
  },
);
