import type { HTMLAttributes } from 'react';
import './Badge.css';

export type BadgeVariant =
  'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  appearance?: 'soft' | 'outline';
  dot?: boolean;
}

export function Badge({
  variant = 'neutral',
  size = 'sm',
  appearance = 'soft',
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      {...props}
      className={`ui-badge${className ? ` ${className}` : ''}`}
      data-variant={variant}
      data-size={size}
      data-appearance={appearance}
    >
      {dot ? <span className="ui-badge-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
