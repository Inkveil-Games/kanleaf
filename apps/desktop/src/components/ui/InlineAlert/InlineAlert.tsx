import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { Button } from '../Button';
import { IconButton } from '../IconButton';
import './InlineAlert.css';

export type InlineAlertVariant = 'info' | 'success' | 'warning' | 'danger';

export interface InlineAlertProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'title'
> {
  variant?: InlineAlertVariant;
  title?: ReactNode;
  action?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
  };
  onDismiss?: () => void;
  dismissLabel?: string;
}

const icons = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

export function InlineAlert({
  variant = 'info',
  title,
  children,
  action,
  onDismiss,
  dismissLabel = 'Dismiss alert',
  className,
  role,
  ...props
}: InlineAlertProps) {
  const Icon = icons[variant];

  return (
    <div
      aria-atomic="true"
      {...props}
      className={`ui-inline-alert${className ? ` ${className}` : ''}`}
      data-variant={variant}
      role={role ?? (variant === 'danger' ? 'alert' : 'status')}
    >
      <Icon className="ui-inline-alert-icon" size={16} aria-hidden="true" />
      <div className="ui-inline-alert-copy">
        {title ? (
          <strong className="ui-inline-alert-title">{title}</strong>
        ) : null}
        {children ? (
          <div className="ui-inline-alert-description">{children}</div>
        ) : null}
        {action ? (
          <Button
            className="ui-inline-alert-action"
            variant="ghost"
            size="sm"
            onClick={action.onClick}
            disabled={action.disabled}
            loading={action.loading}
          >
            {action.label}
            <ArrowRight size={12} aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {onDismiss ? (
        <IconButton
          className="ui-inline-alert-dismiss"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <X size={14} aria-hidden="true" />
        </IconButton>
      ) : null}
    </div>
  );
}
