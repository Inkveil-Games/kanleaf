import { LoaderCircle } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import './Button.css';

export type ButtonVariant =
  'primary' | 'secondary' | 'ghost' | 'text' | 'danger';

export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'secondary',
      size = 'md',
      loading = false,
      loadingLabel,
      disabled,
      className,
      children,
      type = 'button',
      'aria-label': ariaLabel,
      ...buttonProps
    },
    ref,
  ) {
    return (
      <button
        {...buttonProps}
        ref={ref}
        className={`ui-button${className ? ` ${className}` : ''}`}
        type={type}
        data-variant={variant}
        data-size={size}
        data-loading={loading || undefined}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        aria-label={loading && loadingLabel ? loadingLabel : ariaLabel}
      >
        <span className="ui-button-content">{children}</span>
        {loading ? (
          <LoaderCircle
            className="ui-button-spinner"
            aria-hidden="true"
            size={size === 'sm' ? 14 : 16}
          />
        ) : null}
      </button>
    );
  },
);
