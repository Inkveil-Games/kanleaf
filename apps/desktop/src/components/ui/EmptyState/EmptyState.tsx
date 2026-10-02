import type { HTMLAttributes, ReactNode } from 'react';
import './EmptyState.css';

export interface EmptyStateProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'title' | 'children'
> {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
  role = 'status',
  ...props
}: EmptyStateProps) {
  return (
    <div
      aria-atomic="true"
      {...props}
      className={`ui-empty-state${className ? ` ${className}` : ''}`}
      role={role}
    >
      {icon ? (
        <span className="ui-empty-state-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <strong className="ui-empty-state-title">{title}</strong>
      {description ? (
        <p className="ui-empty-state-description">{description}</p>
      ) : null}
      {action}
    </div>
  );
}
